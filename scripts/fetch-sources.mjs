/**
 * Downloads the two upstream inputs the corpus pipeline needs.
 *
 * Neither is committed: the layout data is 15 MB of JSON and the font set is
 * 48 MB. Both are deterministic given a pinned ref, so fetching them is cheaper
 * than carrying them in git — and it means a clean clone and a CI build take
 * exactly the same path.
 *
 * Everything is resumable: a file that already exists on disk is skipped, so
 * re-running after an interruption only fetches what is missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.cache');

// Pinned refs. Bump deliberately — build-corpus.mjs validates against them.
const LAYOUT = 'https://cdn.jsdelivr.net/gh/zonetecde/mushaf-layout@main/mushaf';
const FONTS_V1 = 'https://cdn.jsdelivr.net/gh/nuqayah/qpc-fonts@master/mushaf-woff2';
const FONTS_V1_FALLBACK = 'https://raw.githubusercontent.com/nuqayah/qpc-fonts/master/mushaf-woff2';
const TRANSLATIONS = [
  ['en', 'en.sahih', 'English'],
  ['ru', 'ru.kuliev', 'Russian'],
  ['it', 'it.piccardo', 'Italian'],
  ['fr', 'fr.hamidullah', 'French'],
  ['es', 'es.cortes', 'Spanish'],
];

const PAGES = 604;

// jsDelivr answers a burst with 403, not 429, and the 403 looks exactly like a
// missing file. Keep concurrency modest, back off hard, and sweep for stragglers
// afterwards — a silently missing font is a blank Mushaf page.
const CONCURRENCY = 6;
const SWEEPS = 12;

const pad = (n) => String(n).padStart(3, '0');
const pageNums = Array.from({ length: PAGES }, (_, i) => i + 1);

const layoutPath = (n) => path.join(CACHE, 'mushaf', `page-${pad(n)}.json`);
const fontPath = (n) => path.join(ROOT, 'public', 'fonts', 'v1', `p${n}.woff2`);

const present = (p) => fs.existsSync(p) && fs.statSync(p).size > 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTo(url, dest) {
  const res = await fetch(url);
  if (res.status === 403 || res.status === 429) throw new Error('rate-limited');
  if (!res.ok) throw new Error(`${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('empty body');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
}

async function pool(items, worker) {
  let i = 0;
  const next = async () => {
    while (i < items.length) await worker(items[i++]);
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, next));
}

/**
 * Fetch every missing item, then sweep repeatedly for whatever the rate limiter
 * refused, pausing longer each round. Throws only if a sweep makes no progress
 * twice running — that means genuinely unreachable, not throttled.
 */
async function fetchAll(label, urlOf, destOf, fallbackUrlOf) {
  let stalled = 0;

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const missing = pageNums.filter((n) => !present(destOf(n)));
    if (!missing.length) break;

    if (sweep === 0) process.stdout.write(`  ${label}: ${missing.length} to fetch`);
    else process.stdout.write(`\n  ${label}: retrying ${missing.length}`);

    const before = missing.length;
    await pool(missing, async (n) => {
      try {
        await fetchTo(urlOf(n), destOf(n));
        process.stdout.write('.');
      } catch {
        if (fallbackUrlOf) {
          try {
            await fetchTo(fallbackUrlOf(n), destOf(n));
            process.stdout.write('.');
          } catch {
            /* swept up next round */
          }
        }
      }
    });

    const after = pageNums.filter((n) => !present(destOf(n))).length;
    if (after === 0) break;
    stalled = after === before ? stalled + 1 : 0;
    if (stalled >= 2) {
      throw new Error(
        `${label}: ${after} file(s) could not be downloaded after repeated attempts. ` +
          `Check your connection and re-run \`npm run fetch\` — it resumes where it stopped.`
      );
    }
    await sleep(2000 * (sweep + 1));
  }

  const missing = pageNums.filter((n) => !present(destOf(n)));
  if (missing.length) {
    throw new Error(`${label}: still missing ${missing.length} file(s), e.g. page ${missing[0]}`);
  }
  process.stdout.write(`\n  ${label}: ${PAGES}/${PAGES} ✓\n`);
}

const mb = (dir) =>
  fs.existsSync(dir)
    ? (
        fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0) / 1e6
      ).toFixed(0)
    : '0';

await fetchAll('mushaf layout', (n) => `${LAYOUT}/page-${pad(n)}.json`, layoutPath);
await fetchAll(
  'QPC v1 fonts ',
  (n) => `${FONTS_V1}/QCF_P${pad(n)}.woff2`,
  fontPath,
  (n) => `${FONTS_V1_FALLBACK}/QCF_P${pad(n)}.woff2`
);

for (const [language, edition, label] of TRANSLATIONS) {
  const translationPath = path.join(CACHE, `translation-${language}.json`);
  if (!present(translationPath)) {
    process.stdout.write(`  ${label} translation: fetching`);
    await fetchTo(`https://api.alquran.cloud/v1/quran/${edition}`, translationPath);
    process.stdout.write(' ✓\n');
  }
}

console.log(
  `  cached: ${mb(path.join(CACHE, 'mushaf'))} MB layout, ` +
    `${mb(path.join(ROOT, 'public', 'fonts', 'v1'))} MB fonts`
);

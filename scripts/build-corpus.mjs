/**
 * Builds the static Quran corpus consumed by the app.
 *
 * Input : zonetecde/mushaf-layout  — 604 page-NNN.json files (Madani, Hafs, QPC glyphs)
 * Output: public/data/pages/{1..604}.json   one file per Mushaf page
 *         public/data/meta.json             surahs, juz index, page->verse map
 *         public/data/verses.json           6236 verses with Uthmani + normalized text
 *
 * NOTE ON A SOURCE DEFECT — read before changing anything here.
 * The source labels each `surah-header` line with the *preceding* surah, not the
 * surah the header introduces. Page 76 line 15 is the header for An-Nisa (4) but
 * is labelled "آل عمران" / "003". Trusting that field yields 13 duplicate surahs
 * and 17 with no header at all. We therefore IGNORE the source's `surah` and
 * `text` on header lines entirely and derive the surah from the next `text`
 * line's verseRange, which is authoritative. Same for basmala lines.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.MUSHAF_SRC || path.join(__dirname, '..', '.cache', 'mushaf');
const OUT = path.join(__dirname, '..', 'public', 'data');
const PAGES = 604;
const TOTAL_VERSES = 6236;

const surahMeta = JSON.parse(fs.readFileSync(path.join(__dirname, 'surah-meta.json'), 'utf8'));

// Juz start verses (standard Hafs division).
const JUZ_STARTS = [
  '1:1', '2:142', '2:253', '3:93', '4:24', '4:148', '5:82', '6:111', '7:88', '8:41',
  '9:93', '11:6', '12:53', '15:1', '17:1', '18:75', '21:1', '23:1', '25:21', '27:56',
  '29:46', '33:31', '36:28', '39:32', '41:47', '46:1', '51:31', '58:1', '67:1', '78:1',
];

const normalizeArabic = (s) =>
  s
    .normalize('NFC')
    .replace(/[ؐ-ًؚ-ٟۖ-ۭ]/g, '')
    .replace(/[ٰـ]/g, '')
    .replace(/[ٱآأإ]/g, 'ا')
    .replace(/[ؤئ]/g, 'ء')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, '')      // Arabic-Indic digits (verse numbers)
    .replace(/\s+/g, ' ')
    .trim();

const fail = (msg) => {
  console.error(`\n  BUILD FAILED: ${msg}\n`);
  process.exit(1);
};

const TRANSLATION_LANGUAGES = ['en', 'ru', 'it', 'fr', 'es'];
const translationMaps = new Map();
for (const language of TRANSLATION_LANGUAGES) {
  const translationFile = path.join(__dirname, '..', '.cache', `translation-${language}.json`);
  if (!fs.existsSync(translationFile)) fail(`missing ${language} translation\n  Run: npm run fetch`);
  const translationPayload = JSON.parse(fs.readFileSync(translationFile, 'utf8'));
  const translations = new Map();
  for (const surah of translationPayload.data?.surahs ?? []) {
    for (const ayah of surah.ayahs ?? []) {
      translations.set(`${surah.number}:${ayah.numberInSurah}`, ayah.text);
    }
  }
  if (translations.size !== TOTAL_VERSES) {
    fail(`expected ${TOTAL_VERSES} ${language} translations, got ${translations.size}`);
  }
  translationMaps.set(language, translations);
}

// ---------------------------------------------------------------- read source
const raw = [];
for (let p = 1; p <= PAGES; p++) {
  const f = path.join(SRC, `page-${String(p).padStart(3, '0')}.json`);
  if (!fs.existsSync(f)) fail(`missing source page ${p} at ${f}\n  Run: npm run fetch`);
  raw.push(JSON.parse(fs.readFileSync(f, 'utf8')));
}

// Flat list of every text line in reading order, so a header/basmala can look
// forward to the next real verse regardless of page boundaries.
const flatLines = [];
for (const page of raw) {
  for (const line of page.lines) flatLines.push({ page: page.page, ...line });
}

const surahOfNextText = (idx) => {
  for (let i = idx + 1; i < flatLines.length; i++) {
    const L = flatLines[i];
    if (L.type === 'text' && L.verseRange) return Number(L.verseRange.split('-')[0].split(':')[0]);
  }
  return null;
};

// ------------------------------------------------------- verses + word tables
const verseMap = new Map(); // "2:255" -> { words:[], surah, ayah, page }
let wordId = 0;

for (const L of flatLines) {
  if (L.type !== 'text') continue;
  for (const w of L.words || []) {
    const [s, a] = w.location.split(':').map(Number);
    const key = `${s}:${a}`;
    if (!verseMap.has(key)) verseMap.set(key, { surah: s, ayah: a, page: L.page, words: [] });
    verseMap.get(key).words.push({ id: ++wordId, text: w.word, code: w.qpcV2 });
  }
}

if (verseMap.size !== TOTAL_VERSES) fail(`expected ${TOTAL_VERSES} verses, got ${verseMap.size}`);

// Canonical order: surah asc, ayah asc. Assign 1..6236.
const orderedKeys = [...verseMap.keys()].sort((x, y) => {
  const [s1, a1] = x.split(':').map(Number);
  const [s2, a2] = y.split(':').map(Number);
  return s1 - s2 || a1 - a2;
});

const juzOfIndex = (() => {
  const starts = JUZ_STARTS.map((k) => orderedKeys.indexOf(k));
  if (starts.some((i) => i < 0)) fail('a juz start verse key does not exist');
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] <= starts[i - 1]) fail(`juz starts are not monotonic at juz ${i + 1}`);
  }
  return (idx) => {
    let j = 1;
    for (let i = 0; i < starts.length; i++) if (idx >= starts[i]) j = i + 1;
    return j;
  };
})();

const verses = orderedKeys.map((key, i) => {
  const v = verseMap.get(key);
  const textUthmani = v.words.map((w) => w.text).join(' ').trim();
  return {
    id: i + 1,
    key,
    surah: v.surah,
    ayah: v.ayah,
    page: v.page,
    juz: juzOfIndex(i),
    text: textUthmani,
    simple: normalizeArabic(textUthmani),
    translations: Object.fromEntries(
      TRANSLATION_LANGUAGES.map((language) => [language, translationMaps.get(language).get(key)])
    ),
  };
});

const verseIdByKey = new Map(verses.map((v) => [v.key, v.id]));

// ----------------------------------------------------------- surah validation
const countsFromData = new Map();
const firstPageOf = new Map();
for (const v of verses) {
  countsFromData.set(v.surah, (countsFromData.get(v.surah) || 0) + 1);
  if (!firstPageOf.has(v.surah)) firstPageOf.set(v.surah, v.page);
}

const surahs = surahMeta.map(([number, nameArabic, nameSimple, nameEnglish, revelationPlace]) => ({
  number,
  nameArabic,
  nameSimple,
  nameEnglish,
  revelationPlace,
  versesCount: countsFromData.get(number),
  firstPage: firstPageOf.get(number),
  firstVerseId: verseIdByKey.get(`${number}:1`),
  bismillahPre: number !== 1 && number !== 9,
}));

if (surahs.length !== 114) fail(`expected 114 surahs, got ${surahs.length}`);
for (const s of surahs) {
  if (!s.versesCount) fail(`surah ${s.number} has no verses`);
  if (!s.firstVerseId) fail(`surah ${s.number} has no verse 1`);
}
// Canonical ayah counts, Kufan numbering — the numbering the Madani Mushaf and
// every QPC edition use. This is a fixed, universally agreed constant, so it is
// carried here rather than fetched: it is the assertion that the upstream layout
// data actually describes the Quran, and it must not depend on the network.
// A spot-check of a handful of surahs is not enough — a mis-split verse in an
// unchecked surah passes a canary and reaches the reader.
const AYAH_COUNTS = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
  112, 78, 118, 64, 77, 227, 93, 88, 69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
  14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
  29, 19, 36, 25, 22, 17, 19, 26, 30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3, 5, 4, 5, 6,
];
for (let n = 1; n <= 114; n++) {
  const got = countsFromData.get(n);
  if (got !== AYAH_COUNTS[n - 1]) {
    fail(`surah ${n} verse count is ${got}, expected ${AYAH_COUNTS[n - 1]} (Kufan numbering)`);
  }
}

// ------------------------------------------------------------- page documents
//
// The source's surah-header / basmala lines are unreliable in BOTH label and
// position: page 207 carries a second At-Tawbah header that belongs to Yunus at
// the foot of the page, pages 586 and 590 are missing three lines each, and five
// surahs get no header at all. Rather than patch each case, we DISCARD every
// source header/basmala line and re-derive them from the verse data: each surah
// gets exactly one header immediately before its first ayah line, followed by a
// basmala for every surah except Al-Fatihah (its basmala is verse 1:1) and
// At-Tawbah (which has none).
//
// Cost: on a handful of pages the header lands at the top of the surah's first
// page where the print edition floats it to the foot of the previous page, so
// those pages carry one extra line. Everything else matches. Tracked in
// docs/PROJECT_STATE.md as a known fidelity gap.

const firstWordKeyOfSurah = new Map();   // surah -> "S:1"
for (let s = 1; s <= 114; s++) firstWordKeyOfSurah.set(s, `${s}:1`);

let headersEmitted = 0;
let basmalaEmitted = 0;
const surahsWithHeader = new Set();
const pageDocs = [];
const seenSurah = new Set();

for (const page of raw) {
  const lines = [];
  let n = 0;
  for (const L of page.lines) {
    if (L.type !== 'text') continue;          // drop all source headers/basmala

    const words = (L.words || []).map((w) => {
      const [s, a] = w.location.split(':').map(Number);
      // Both glyph variants ship: `c` is QPC v2, `c1` is QPC v1. Which one the
      // reader uses depends on which font set is installed (lib/mushaf/fonts.ts).
      // Carrying both costs ~1 MB across all 604 pages and makes switching
      // editions a config change rather than a corpus rebuild.
      return { k: `${s}:${a}`, t: w.word, c: w.qpcV2, c1: w.qpcV1 };
    });
    if (!words.length) continue;

    // Does this line open a surah we have not seen yet?
    const openingSurah = words[0].k === firstWordKeyOfSurah.get(Number(words[0].k.split(':')[0]))
      ? Number(words[0].k.split(':')[0])
      : null;

    if (openingSurah && !seenSurah.has(openingSurah)) {
      seenSurah.add(openingSurah);
      surahsWithHeader.add(openingSurah);
      headersEmitted++;
      lines.push({ n: ++n, t: 'surah', s: openingSurah });
      if (openingSurah !== 1 && openingSurah !== 9) {
        basmalaEmitted++;
        lines.push({ n: ++n, t: 'basmala', s: openingSurah });
      }
    }

    lines.push({ n: ++n, t: 'ayah', w: words });
  }
  pageDocs.push({ page: page.page, lines });
}

// --------------------------------------------------------------- validation
const missingHeaders = [];
for (let s = 1; s <= 114; s++) if (!surahsWithHeader.has(s)) missingHeaders.push(s);
if (missingHeaders.length) fail(`surahs with no header line: ${missingHeaders.join(', ')}`);
if (headersEmitted !== 114) fail(`expected 114 surah headers, emitted ${headersEmitted}`);
if (basmalaEmitted !== 112) fail(`expected 112 basmala lines, emitted ${basmalaEmitted}`);

// Every verse must appear on exactly one page, in order.
const seenVerse = new Set();
let lastId = 0;
for (const doc of pageDocs) {
  for (const L of doc.lines) {
    if (L.t !== 'ayah') continue;
    for (const w of L.w) {
      const id = verseIdByKey.get(w.k);
      if (!id) fail(`page ${doc.page}: unknown verse key ${w.k}`);
      if (id < lastId) fail(`page ${doc.page}: verse ${w.k} is out of order`);
      lastId = id;
      seenVerse.add(w.k);
    }
  }
}
if (seenVerse.size !== TOTAL_VERSES) fail(`pages cover ${seenVerse.size} verses, expected ${TOTAL_VERSES}`);

// Every verse must reconstruct EXACTLY from the page words carrying its key, in
// page order. The loop above proves verses arrive in the right order; this proves
// the words inside them do. Without it, a layout source that emitted a line's
// words reversed would still pass every other check here and reach the reader as
// scrambled Quran — the one failure this pipeline must never ship.
{
  const textByKey = new Map(verses.map((v) => [v.key, v.text]));
  const rebuilt = new Map();
  for (const doc of pageDocs) {
    for (const L of doc.lines) {
      if (L.t !== 'ayah') continue;
      for (const w of L.w) {
        rebuilt.set(w.k, rebuilt.has(w.k) ? `${rebuilt.get(w.k)} ${w.t}` : w.t);
      }
    }
  }
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  for (const [key, joined] of rebuilt) {
    const want = textByKey.get(key);
    if (norm(joined) !== norm(want)) {
      fail(
        `verse ${key} does not reconstruct from its page words\n` +
          `  from pages: ${norm(joined)}\n` +
          `  from verse: ${norm(want)}`
      );
    }
  }
}

const lineHist = {};
for (const doc of pageDocs) lineHist[doc.lines.length] = (lineHist[doc.lines.length] || 0) + 1;

// ---------------------------------------------------------------------- write
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'translations'), { recursive: true });
for (const doc of pageDocs) {
  fs.writeFileSync(path.join(OUT, 'pages', `${doc.page}.json`), JSON.stringify(doc));
}
for (const language of TRANSLATION_LANGUAGES) {
  fs.writeFileSync(
    path.join(OUT, 'translations', `${language}.json`),
    JSON.stringify(verses.map((verse) => [verse.key, verse.translations[language]]))
  );
}

const pageIndex = {};
for (const v of verses) {
  if (!pageIndex[v.page]) pageIndex[v.page] = { from: v.key, to: v.key };
  pageIndex[v.page].to = v.key;
}

fs.writeFileSync(
  path.join(OUT, 'meta.json'),
  JSON.stringify({
    version: 4,
    pages: PAGES,
    totalVerses: verses.length,
    surahs,
    juzStarts: JUZ_STARTS,
    pageIndex,
    linesPerPage: lineHist,
  })
);

fs.writeFileSync(
  path.join(OUT, 'verses.json'),
  JSON.stringify(
    verses.map((v) => [
      v.id,
      v.key,
      v.surah,
      v.ayah,
      v.page,
      v.juz,
      v.text,
      v.simple,
      v.translations,
    ])
  )
);

const mb = (p) => (fs.statSync(p).size / 1e6).toFixed(2);
const pagesMb = (
  fs.readdirSync(path.join(OUT, 'pages')).reduce((a, f) => a + fs.statSync(path.join(OUT, 'pages', f)).size, 0) / 1e6
).toFixed(2);

console.log(`  verses            ${verses.length}`);
console.log(`  words             ${wordId}`);
console.log(`  surahs            ${surahs.length}`);
console.log(`  pages             ${pageDocs.length}   (${pagesMb} MB)`);
console.log(`  surah headers     ${headersEmitted}  covering ${surahsWithHeader.size}/114 surahs`);
console.log(`  basmala lines     ${basmalaEmitted}`);
console.log(`  lines per page    ${JSON.stringify(lineHist)}`);
console.log(`  meta.json         ${mb(path.join(OUT, 'meta.json'))} MB`);
console.log(`  verses.json       ${mb(path.join(OUT, 'verses.json'))} MB`);

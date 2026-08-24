import { db, CORPUS_VERSION } from './schema';
import type { Meta, Verse } from '@/lib/types';

/**
 * First-run corpus load.
 *
 * verses.json is a packed array-of-arrays rather than objects — it saves ~1.4 MB
 * over the object form and this file is downloaded by every new user.
 */
type PackedVerse = [
  id: number,
  key: string,
  surah: number,
  ayah: number,
  page: number,
  juz: number,
  text: string,
  simple: string,
];

let metaCache: Meta | null = null;
let metaPromise: Promise<Meta> | null = null;

export function loadMeta(): Promise<Meta> {
  if (metaCache) return Promise.resolve(metaCache);
  if (!metaPromise) {
    metaPromise = fetch('/data/meta.json')
      .then((r) => {
        if (!r.ok) throw new Error(`meta.json ${r.status}`);
        return r.json() as Promise<Meta>;
      })
      .then((m) => {
        metaCache = m;
        return m;
      });
  }
  return metaPromise;
}

export function getMetaSync(): Meta | null {
  return metaCache;
}

export type BootstrapPhase = 'idle' | 'loading' | 'ready' | 'error';

export async function ensureCorpus(onProgress?: (pct: number, label: string) => void) {
  const d = db();
  const stamp = await d.kv.get('corpusVersion');
  const count = await d.verses.count();

  if (stamp?.value === CORPUS_VERSION && count === 6236) {
    onProgress?.(1, 'ready');
    await loadMeta();
    return;
  }

  onProgress?.(0.05, 'Downloading the Quran text…');
  const meta = await loadMeta();

  const res = await fetch('/data/verses.json');
  if (!res.ok) throw new Error(`verses.json ${res.status}`);
  const packed = (await res.json()) as PackedVerse[];

  onProgress?.(0.5, 'Preparing your library…');

  const verses: Verse[] = packed.map(([id, key, surah, ayah, page, juz, text, simple]) => ({
    id,
    key,
    surah,
    ayah,
    page,
    juz,
    text,
    simple,
  }));

  await d.transaction('rw', d.verses, d.surahs, d.kv, async () => {
    await d.verses.clear();
    await d.surahs.clear();
    await d.verses.bulkAdd(verses);
    await d.surahs.bulkAdd(meta.surahs);
    await d.kv.put({ key: 'corpusVersion', value: CORPUS_VERSION });
  });

  onProgress?.(1, 'ready');
}

// ------------------------------------------------------------- page fetching

const pageCache = new Map<number, unknown>();
const pageInflight = new Map<number, Promise<unknown>>();

export function fetchPage<T>(page: number): Promise<T> {
  if (pageCache.has(page)) return Promise.resolve(pageCache.get(page) as T);
  let p = pageInflight.get(page);
  if (!p) {
    p = fetch(`/data/pages/${page}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`page ${page}: ${r.status}`);
        return r.json();
      })
      .then((doc) => {
        pageCache.set(page, doc);
        pageInflight.delete(page);
        // Keep memory bounded — a long scroll session would otherwise hold all 604.
        if (pageCache.size > 60) {
          const oldest = pageCache.keys().next().value;
          if (oldest !== undefined) pageCache.delete(oldest);
        }
        return doc;
      })
      .catch((e) => {
        pageInflight.delete(page);
        throw e;
      });
    pageInflight.set(page, p);
  }
  return p as Promise<T>;
}

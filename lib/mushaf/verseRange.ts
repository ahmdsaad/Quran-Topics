/**
 * Verse keys are `"surah:ayah"`, and Quran order is exactly (surah, ayah)
 * ascending. That means a range of verses can be tested against a key with
 * nothing but string parsing — no lookup, no verse ids, no database round trip.
 *
 * This matters because the reader asks "is this word inside the selection?"
 * once per word per render, ~200 times per page. Anything that touched Dexie
 * here would make selection cost a query per frame.
 */

export function parseVerseKey(key: string): [surah: number, ayah: number] {
  const i = key.indexOf(':');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

export function compareVerseKeys(a: string, b: string): number {
  const [as, aa] = parseVerseKey(a);
  const [bs, ba] = parseVerseKey(b);
  return as - bs || aa - ba;
}

/** Orders a pair so `from` is never after `to` — a range selected backwards is still a range. */
export function normalizeRange(a: string, b: string): [from: string, to: string] {
  return compareVerseKeys(a, b) <= 0 ? [a, b] : [b, a];
}

export function verseKeyInRange(key: string, from: string, to: string): boolean {
  return compareVerseKeys(key, from) >= 0 && compareVerseKeys(key, to) <= 0;
}

/** "Al-Baqarah 2:1 – 2:5" style label for a range, collapsing a single verse. */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return from;
  const [fs] = parseVerseKey(from);
  const [ts, ta] = parseVerseKey(to);
  return fs === ts ? `${from}–${ta}` : `${from} – ${to}`;
}

/**
 * Per-page Mushaf font loading.
 *
 * QPC fonts map whole WORDS to single glyphs and are cut one font per Mushaf
 * page — page 1's font contains only page 1's words. Rendering page N therefore
 * requires font `p{N}`, and there are 604 of them. Loading all of them up front
 * would be 48–116 MB depending on edition, so we load on demand, prefetch
 * neighbours, and evict pages that scrolled away.
 *
 * Two editions are supported, both page-perfect Madani Mushafs:
 *
 *   v1  King Fahd Complex 1405H — ~80 KB/page, fetched at build time from a
 *       public mirror. The default, because it needs nothing committed.
 *   v2  King Fahd Complex 1423H — ~193 KB/page, sharper and more modern, but
 *       only distributed as TTF, so it has to be converted locally
 *       (`npm run fonts:v2`) and cannot be fetched during a cloud build.
 *
 * The corpus ships glyph codes for both, so switching is a config change:
 * set NEXT_PUBLIC_MUSHAF_EDITION=v2 once public/fonts/v2 exists.
 */

export type MushafEdition = 'v1' | 'v2';

export const EDITION: MushafEdition =
  (process.env.NEXT_PUBLIC_MUSHAF_EDITION as MushafEdition) === 'v2' ? 'v2' : 'v1';

/** Which glyph field on a word this edition renders. */
export const glyphOf = (w: { c: string; c1: string }) => (EDITION === 'v2' ? w.c : w.c1);

const loaded = new Map<number, Promise<void>>();
const registered = new Set<number>();
const lastUsed = new Map<number, number>();

const MAX_RESIDENT = 24;
const FONT_URL = (p: number) => `/fonts/${EDITION}/p${p}.woff2`;

export const fontFamily = (page: number) => `qpc-${EDITION}-p${page}`;

export function loadPageFont(page: number): Promise<void> {
  if (typeof window === 'undefined' || typeof FontFace === 'undefined') {
    return Promise.resolve();
  }
  lastUsed.set(page, Date.now());

  const existing = loaded.get(page);
  if (existing) return existing;

  const face = new FontFace(fontFamily(page), `url(${FONT_URL(page)}) format('woff2')`, {
    display: 'block',
  });

  const p = face
    .load()
    .then((f) => {
      document.fonts.add(f);
      registered.add(page);
      evict();
    })
    .catch((err) => {
      // A failed font is not fatal — the page still renders in the Uthmani
      // unicode fallback. Drop the memo so a later scroll past can retry.
      loaded.delete(page);
      console.warn(`[mushaf] font for page ${page} failed`, err);
    });

  loaded.set(page, p);
  return p;
}

export const isFontReady = (page: number) => registered.has(page);

/** Warm the pages around `page` so scrolling does not stall on a font fetch. */
export function prefetchAround(page: number, radius = 2) {
  for (let p = page - radius; p <= page + radius; p++) {
    if (p >= 1 && p <= 604 && p !== page) loadPageFont(p);
  }
}

function evict() {
  if (registered.size <= MAX_RESIDENT) return;
  const byAge = [...registered].sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0));
  for (const p of byAge.slice(0, registered.size - MAX_RESIDENT)) {
    const fam = fontFamily(p);
    document.fonts.forEach((f) => {
      if (f.family === fam) document.fonts.delete(f);
    });
    registered.delete(p);
    loaded.delete(p);
    lastUsed.delete(p);
  }
}

// ---------------------------------------------------------------- corpus types

export interface Surah {
  number: number;
  nameArabic: string;
  nameSimple: string;
  nameEnglish: string;
  revelationPlace: 'makkah' | 'madinah';
  versesCount: number;
  firstPage: number;
  firstVerseId: number;
  bismillahPre: boolean;
}

export interface Meta {
  version: number;
  pages: number;
  totalVerses: number;
  surahs: Surah[];
  juzStarts: string[];
  pageIndex: Record<string, { from: string; to: string }>;
  linesPerPage: Record<string, number>;
}

/** A word as stored in the page documents. Keys are terse: the 604 files add up. */
export interface PageWord {
  /** verse key, e.g. "2:255" */
  k: string;
  /** Uthmani unicode text — used for copy, export, search, accessibility */
  t: string;
  /** QPC v2 glyph code(s). MUST be rendered with innerHTML, never textContent. */
  c: string;
  /** QPC v1 glyph code(s), same rules. Used when the v1 font set is installed. */
  c1: string;
}

export type PageLine =
  | { n: number; t: 'ayah'; w: PageWord[] }
  | { n: number; t: 'surah'; s: number }
  | { n: number; t: 'basmala'; s: number };

export interface PageDoc {
  page: number;
  lines: PageLine[];
}

export interface Verse {
  id: number;
  key: string;
  surah: number;
  ayah: number;
  page: number;
  juz: number;
  text: string;
  simple: string;
}

// ------------------------------------------------------------- user data types

/**
 * Present on every user-owned record from day one, even though this build is
 * local-only. Phase 7 sync drains `outbox` and pulls `updatedAt > since`; if
 * these fields are missing then, every call site has to change. See
 * docs/DATA_MODEL.md §3.
 */
export interface SyncEnvelope {
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  deviceId: string;
  rev: number;
}

export interface Category extends SyncEnvelope {
  id: string;
  parentId: string | null;
  name: string;
  description: string | null;
  color: string | null;
  /** fractional index among siblings — see lib/ordering.ts */
  sortKey: string;
  verseSortMode: 'quran' | 'manual';
  isExpanded: boolean;
}

export interface CategoryVerse extends SyncEnvelope {
  id: string;
  categoryId: string;
  verseKey: string;
  verseId: number;
  sortKey: string;
  note: string | null;
}

export interface Note extends SyncEnvelope {
  id: string;
  verseKey: string;
  /** Tiptap document JSON */
  contentJson: unknown;
  /** flattened plain text, regenerated on every save — search reads this */
  contentText: string;
}

export interface Bookmark extends SyncEnvelope {
  id: string;
  verseKey: string;
  verseId: number;
  label: string | null;
  color: string;
}

export interface ReadingState {
  id: 'current';
  page: number;
  verseKey: string;
  /** 0..1 within the page, so resume survives a change of screen size */
  scrollOffsetInPage: number;
  updatedAt: number;
}

export interface Settings {
  id: 'current';
  theme: 'light' | 'dark' | 'sepia';
  pageScale: number;
  layoutMode: 'auto' | 'single' | 'dual';
  updatedAt: number;
}

/** Derived, never synced. Rebuilt from notes/bookmarks/assignments. */
export interface VerseMarker {
  verseKey: string;
  hasNote: boolean;
  hasBookmark: boolean;
  categoryCount: number;
  bookmarkColor: string | null;
}

export interface OutboxEntry {
  seq?: number;
  table: string;
  recordId: string;
  op: 'put' | 'delete';
  payload: unknown;
  at: number;
}

export const BOOKMARK_COLORS = [
  { name: 'Amber', value: '#d9a441' },
  { name: 'Green', value: '#4f9d69' },
  { name: 'Blue', value: '#4a7fb5' },
  { name: 'Rose', value: '#c2647a' },
  { name: 'Violet', value: '#8b6bb1' },
] as const;

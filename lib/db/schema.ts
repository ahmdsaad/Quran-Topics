import Dexie, { type Table } from 'dexie';
import type {
  Bookmark,
  Category,
  CategoryVerse,
  Note,
  OutboxEntry,
  ReadingState,
  Settings,
  Surah,
  Verse,
  VerseMarker,
} from '@/lib/types';

/** Corpus rows, bulk-loaded once on first run and never written again. */
export interface CorpusVerse extends Verse {}

export interface KV {
  key: string;
  value: unknown;
}

export class QuranDB extends Dexie {
  verses!: Table<CorpusVerse, number>;
  surahs!: Table<Surah, number>;

  categories!: Table<Category, string>;
  categoryVerses!: Table<CategoryVerse, string>;
  notes!: Table<Note, string>;
  bookmarks!: Table<Bookmark, string>;
  readingState!: Table<ReadingState, string>;
  settings!: Table<Settings, string>;

  verseMarkers!: Table<VerseMarker, string>;
  outbox!: Table<OutboxEntry, number>;
  kv!: Table<KV, string>;

  constructor() {
    super('quran-classification');
    this.version(1).stores({
      // corpus
      verses: 'id, &key, page, juz, surah, [surah+ayah]',
      surahs: 'number, firstPage',

      // user data — every table indexed on updatedAt/deletedAt so a Phase 7
      // change feed is `where('updatedAt').above(since)` with no migration
      categories: 'id, parentId, [parentId+sortKey], updatedAt, deletedAt',
      categoryVerses:
        'id, categoryId, verseKey, &[categoryId+verseKey], [categoryId+sortKey], [categoryId+verseId], updatedAt, deletedAt',
      notes: 'id, &verseKey, updatedAt, deletedAt',
      bookmarks: 'id, verseKey, verseId, updatedAt, deletedAt',
      readingState: 'id',
      settings: 'id',

      // derived + machinery
      verseMarkers: 'verseKey',
      outbox: '++seq, table, recordId',
      kv: 'key',
    });
  }
}

let _db: QuranDB | null = null;

/** Lazily constructed so nothing touches IndexedDB during SSR. */
export function db(): QuranDB {
  if (!_db) _db = new QuranDB();
  return _db;
}

export const CORPUS_VERSION = 1;

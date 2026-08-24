# Data Model

> Status: proposed, not yet implemented. Last updated 2026-08-24.

Two clearly separated halves. Getting this separation right is what makes sync a
later *addition* rather than a later *rewrite*.

| Half | Source | Mutability | Synced? | Where it lives |
|---|---|---|---|---|
| **Corpus** — the Quran itself | Built at compile time from QUL | Read-only | Never | Static files in `/public/data`, loaded into Dexie on first run |
| **User data** — notes, categories, bookmarks | Created by the user | Read/write | Yes (Phase 7) | Dexie / IndexedDB, later mirrored to Postgres |

Nothing in the corpus half ever references the user half. Every table in the
user half carries the sync envelope described in §3.

---

## 1. Corpus tables (read-only)

### `surahs` — 114 rows

```ts
interface Surah {
  number: number;          // 1..114  (primary key)
  nameArabic: string;      // "البقرة"
  nameSimple: string;      // "Al-Baqarah"
  nameEnglish: string;     // "The Cow"
  revelationPlace: 'makkah' | 'madinah';
  revelationOrder: number;
  versesCount: number;
  firstVerseId: number;    // 1..6236
  firstPage: number;       // 1..604
  bismillahPre: boolean;   // false for At-Tawbah (9) — the only surah without it
}
```

### `verses` — 6,236 rows (Hafs)

```ts
interface Verse {
  id: number;              // 1..6236, canonical Quran order  (primary key)
  verseKey: string;        // "2:255"  — the stable key used by ALL user data
  surah: number;
  ayah: number;
  page: number;            // 1..604 (Madani Mushaf)
  juz: number;             // 1..30
  hizb: number;            // 1..60
  rubElHizb: number;       // 1..240
  sajdah: boolean;
  textUthmani: string;     // real Unicode — for search, copy, export, a11y
  textSimple: string;      // diacritics stripped — precomputed search index
  wordFrom: number;        // first word id
  wordTo: number;          // last word id
}
```

`id` doubles as the sort key for *"sort by position in the Quran"* — no join
needed, `ORDER BY verseId` is the Quran order by construction.

`verseKey` (not `id`) is what user data references. It is human-readable, shows
up legibly in Word/Excel exports and share URLs, and survives regenerating the
corpus from a different QUL release.

### `words` — 77,430 rows

```ts
interface Word {
  id: number;              // global word index  (primary key)
  verseKey: string;        // "2:255"
  position: number;        // position within the verse, 1-based
  page: number;
  lineNumber: number;      // 1..15 (1..8 on pages 1 and 2)
  charType: 'word' | 'end';// 'end' = the ۝ verse-number glyph
  textUthmani: string;
  codeV2: string;          // QPC v2 glyph — Arabic Presentation Forms-A codepoint,
                           // page-scoped; MUST be injected via innerHTML
}
```

### `pageLines` — ≈ 9,046 rows (604 × 15, less pages 1–2 at 8 lines each)

Mirrors the QUL mushaf-layout `pages` table. This is the rendering instruction set.

```ts
interface PageLine {
  page: number;
  lineNumber: number;      // 1..15 — but pages 1 and 2 have only 8
  lineType: 'ayah' | 'surah_name' | 'basmallah';
  isCentered: boolean;
  firstWordId: number | null;
  lastWordId: number | null;
  surahNumber: number | null;  // set when lineType === 'surah_name'
}
```

A page renders by walking its lines in order — never by walking verses. Verses
straddle lines and pages; lines are the unit of layout.

**Pages 1 and 2 carry 8 lines, not 15.** Derive the count from the rows; never
hard-code it.

**Basmallah caveat:** At-Tawbah (9) is the only surah that does not open with the
basmallah — but An-Naml contains one *inside* verse 27:30. A rule that strips or
special-cases "a leading basmallah" must key off `lineType === 'basmallah'` from
the layout table, never off matching the text.

**Indexes:** `verses` by `[page]`, `[surah+ayah]`, `[juz]`; `words` by
`[page+lineNumber]`, `[verseKey]`; `pageLines` by `[page+lineNumber]`.

---

## 2. User tables (read/write, sync-bound)

### `categories` — infinite nesting via adjacency list

```ts
interface Category {
  id: string;              // uuid v7 (time-sortable)  (primary key)
  parentId: string | null; // null = root. Unbounded depth.
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sortKey: string;         // fractional index among siblings — see §4
  verseSortMode: 'quran' | 'manual';
  isExpanded: boolean;     // accordion state, per the SRS
  ...SyncEnvelope
}
```

Adjacency list beats materialized path or nested sets here because the dominant
write is *move a subtree*, which is a single `parentId` + `sortKey` update.
Depth is unbounded, as required.

**Cycle safety:** a move must reject if the target is a descendant of the moved
node. Enforce in the repository layer, not the UI.

### `categoryVerses` — the many-to-many join

```ts
interface CategoryVerse {
  id: string;              // uuid v7  (primary key)
  categoryId: string;
  verseKey: string;        // "2:255"
  verseId: number;         // denormalized 1..6236, for cheap Quran-order sort
  sortKey: string;         // fractional index within this category
  note: string | null;     // short per-assignment note, distinct from the verse note
  ...SyncEnvelope
}
```

One verse ↔ many categories, one category ↔ many verses. Uniqueness on
`[categoryId + verseKey]` — adding the same verse twice to one category is a
no-op, not a duplicate row.

Both sort modes are always available with no data migration: `verseSortMode`
on the parent category picks whether the UI orders by `verseId` or `sortKey`.
Dragging a verse while in `quran` mode flips the category to `manual` and
seeds `sortKey` from the current visual order.

### `notes` — rich media annotations

```ts
interface Note {
  id: string;              // uuid v7  (primary key)
  verseKey: string;
  contentJson: object;     // Tiptap document JSON — text, links, YouTube embeds
  contentText: string;     // flattened plain text, kept in sync on every save
  ...SyncEnvelope
}
```

`contentText` exists so search never has to walk Tiptap JSON. Regenerate it on
every write; it is derived state, never edited directly.

YouTube and URL nodes live inside `contentJson` as Tiptap nodes
(`@tiptap/extension-youtube`, `@tiptap/extension-link`) — not as a separate
attachments table. Keeps the editor round-trip lossless.

### `bookmarks`

```ts
interface Bookmark {
  id: string;
  verseKey: string;
  verseId: number;
  label: string | null;
  color: string;           // drives the highlight tint in the reader
  ...SyncEnvelope
}
```

Multiple named bookmarks, per the SRS. Highlighting is derived: a verse renders
highlighted if it has a bookmark, a note, or ≥1 category assignment — three
visually distinct affordances, one lookup (see §5).

### `readingState` — singleton

```ts
interface ReadingState {
  id: 'current';
  page: number;
  verseKey: string;
  scrollOffsetInPage: number;  // 0..1, resolution-independent
  updatedAt: number;
}
```

Stored as a normal synced row so "resume where I left off" works *across*
devices in Phase 7, not just across sessions.

### `settings` — singleton

Theme, font scale, mushaf edition, layout mode (single/dual), reciter (future).
Synced, but last-write-wins with no merge — settings conflicts are not worth
resolving.

### `shares` — Phase 7 only

```ts
interface Share {
  id: string;
  categoryId: string;      // root of the shared subtree
  slug: string;            // public URL segment
  includeDescendants: boolean;
  includeNotes: boolean;
  revokedAt: number | null;
}
```

---

## 3. The sync envelope

Every user table carries these five fields **from day one**, even though Phase 1–6
is local-only. This is the whole insurance policy.

```ts
interface SyncEnvelope {
  createdAt: number;       // epoch ms
  updatedAt: number;       // epoch ms, bumped on every write
  deletedAt: number | null;// soft delete — tombstones survive to propagate
  deviceId: string;        // which device last wrote
  rev: number;             // monotonic per-record revision
}
```

Plus one global table:

```ts
interface OutboxEntry {
  seq: number;             // auto-increment  (primary key)
  table: string;
  recordId: string;
  op: 'put' | 'delete';
  payload: unknown;
  at: number;
}
```

Every mutation goes through a repository function that writes the record **and**
appends to `outbox` in one Dexie transaction. Locally the outbox is inert. When
sync arrives, it is already a complete, ordered change log — the server side
becomes "drain the outbox, apply the server's change feed," and no existing call
site changes.

**Hard delete is never used on user data.** A row is deleted by setting
`deletedAt`; all queries filter `deletedAt == null`. A local compaction job may
purge tombstones older than 90 days once sync confirms them.

---

## 4. Ordering: fractional indexing

Both category siblings and verses-within-a-category use **fractional index
strings** (`fractional-indexing@4`), not integer positions.

```
a0   a1   a2        →  drop between a0 and a1  →  a0   a0V   a1   a2
```

Why this matters more than it looks:

- **Drag = one write.** Integer positions require renumbering every sibling after
  the drop point. On a category with 300 verses, that is 300 writes per drag, on
  a tablet, inside IndexedDB.
- **Conflict tolerance.** Two devices reordering different parts of the same list
  produce non-conflicting keys. Integer positions collide constantly.
- **No coordination.** A new key is computed purely from its two neighbours —
  the client can do it offline with no server round-trip.

Sort is `ORDER BY sortKey ASC` — plain lexicographic string comparison.

Two trade-offs, both manageable:

- **Key growth.** Keys grow ~1 char per repeated insert at the same spot. Add a
  background rebalance that rewrites a list's keys when any key exceeds ~12
  chars. Rare in practice; cheap when it happens.
- **Concurrent collisions.** Fractional indexing is *conflict-tolerant*, not
  collision-free — the library's own README notes that two clients inserting at
  the same position concurrently can generate the same key. Append a stable
  tiebreaker to the sort (`ORDER BY sortKey, deviceId, id`) so identical keys
  still resolve deterministically on every device. Costs nothing now; prevents a
  class of Phase 7 bug that is miserable to debug.

---

## 5. The "verse has something attached" lookup

The reader must tint verses that carry a note, bookmark, or category assignment —
for the whole visible page, on every scroll frame. Three table scans per page is
not acceptable.

Maintain a derived table, written by the same repository functions that write
notes/bookmarks/assignments:

```ts
interface VerseMarker {
  verseKey: string;        // primary key
  hasNote: boolean;
  hasBookmark: boolean;
  categoryCount: number;
  bookmarkColor: string | null;
}
```

Rows are deleted when all three go empty. The reader does one `bulkGet` per page
(~15 keys) and holds the result in memory. Rebuildable from scratch at any time,
so it is derived state — **not synced**, recomputed after each sync pass.

---

## 6. Dexie schema declaration

```ts
db.version(1).stores({
  // corpus — bulk-loaded once, never written after
  surahs:      'number, firstPage',
  verses:      'id, &verseKey, page, juz, [surah+ayah]',
  words:       'id, verseKey, [page+lineNumber]',
  pageLines:   '[page+lineNumber], page',

  // user data
  categories:      'id, parentId, [parentId+sortKey], updatedAt, deletedAt',
  categoryVerses:  'id, categoryId, verseKey, &[categoryId+verseKey], [categoryId+sortKey], [categoryId+verseId], updatedAt, deletedAt',
  notes:           'id, verseKey, updatedAt, deletedAt',
  bookmarks:       'id, verseKey, verseId, updatedAt, deletedAt',
  readingState:    'id',
  settings:        'id',

  // derived + machinery
  verseMarkers: 'verseKey',
  outbox:       '++seq, table, recordId',
});
```

---

## 7. Mapping to Postgres in Phase 7

The schema is deliberately relational already. The Phase 7 migration is close to
mechanical:

- `id: string` → `uuid PRIMARY KEY`
- Add `user_id uuid NOT NULL` to every user table, with row-level security
  `user_id = auth.uid()`
- `sortKey` → `text` with `(parent_id, sort_key)` and `(category_id, sort_key)`
  b-tree indexes
- `contentJson` → `jsonb`
- Soft deletes and `updatedAt` are already present, so a change feed is
  `WHERE updated_at > $since ORDER BY updated_at` — no schema change

The corpus is **not** uploaded. It ships with every client and is identical
everywhere. Public share pages render corpus text from the same static files.

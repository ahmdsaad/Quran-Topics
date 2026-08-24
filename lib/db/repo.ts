import { db } from './schema';
import type {
  Bookmark,
  Category,
  CategoryVerse,
  Note,
  ReadingState,
  Settings,
  SyncEnvelope,
  VerseMarker,
} from '@/lib/types';
import { bySortKey, keyAtEnd, keyBetween } from '@/lib/ordering';

/**
 * THE ONE RULE: no component touches Dexie directly.
 *
 * Reads go through `useLiveQuery` on a function here; writes go through a
 * function here, which stamps the sync envelope AND appends to `outbox` inside
 * one transaction. Locally the outbox is inert — but it means Phase 7 sync is
 * "drain the outbox" rather than a rewrite of every call site.
 */

// ------------------------------------------------------------------ identity

const DEVICE_KEY = 'qc.deviceId';

export function deviceId(): string {
  if (typeof window === 'undefined') return 'ssr';
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export const newId = () => crypto.randomUUID();

function envelope(): SyncEnvelope {
  const now = Date.now();
  return { createdAt: now, updatedAt: now, deletedAt: null, deviceId: deviceId(), rev: 1 };
}

function touch<T extends SyncEnvelope>(rec: T): T {
  return { ...rec, updatedAt: Date.now(), deviceId: deviceId(), rev: rec.rev + 1 };
}

async function log(table: string, recordId: string, op: 'put' | 'delete', payload: unknown) {
  await db().outbox.add({ table, recordId, op, payload, at: Date.now() });
}

const alive = <T extends { deletedAt: number | null }>(rows: T[]) =>
  rows.filter((r) => r.deletedAt === null);

// ------------------------------------------------------------ verse markers
//
// Derived table so the reader can tint a whole page with one bulkGet instead of
// three table scans per page on every scroll frame. Rebuildable at any time.

async function refreshMarker(verseKey: string) {
  const d = db();
  const [note, bookmarks, assignments] = await Promise.all([
    d.notes.where('verseKey').equals(verseKey).first(),
    d.bookmarks.where('verseKey').equals(verseKey).toArray(),
    d.categoryVerses.where('verseKey').equals(verseKey).toArray(),
  ]);
  const liveBookmarks = alive(bookmarks);
  const liveAssignments = alive(assignments);
  const hasNote = !!note && note.deletedAt === null && note.contentText.trim().length > 0;

  const marker: VerseMarker = {
    verseKey,
    hasNote,
    hasBookmark: liveBookmarks.length > 0,
    categoryCount: liveAssignments.length,
    bookmarkColor: liveBookmarks[0]?.color ?? null,
  };

  if (!marker.hasNote && !marker.hasBookmark && marker.categoryCount === 0) {
    await d.verseMarkers.delete(verseKey);
  } else {
    await d.verseMarkers.put(marker);
  }
}

export async function markersForKeys(keys: string[]): Promise<Map<string, VerseMarker>> {
  const rows = await db().verseMarkers.bulkGet(keys);
  const m = new Map<string, VerseMarker>();
  rows.forEach((r) => r && m.set(r.verseKey, r));
  return m;
}

export const allMarkers = () => db().verseMarkers.toArray();

// ------------------------------------------------------------------ corpus

export const getVerseByKey = (key: string) => db().verses.where('key').equals(key).first();
export const getVersesByKeys = async (keys: string[]) => {
  const all = await db().verses.where('key').anyOf(keys).toArray();
  const byKey = new Map(all.map((v) => [v.key, v]));
  return keys.map((k) => byKey.get(k)).filter(Boolean) as NonNullable<
    Awaited<ReturnType<typeof getVerseByKey>>
  >[];
};
export const getSurahs = () => db().surahs.orderBy('number').toArray();
export const getSurah = (n: number) => db().surahs.get(n);

// -------------------------------------------------------------- categories

export async function listCategories(): Promise<Category[]> {
  const rows = await db().categories.toArray();
  return alive(rows).sort(bySortKey);
}

export async function childrenOf(parentId: string | null, all?: Category[]): Promise<Category[]> {
  const rows = all ?? (await listCategories());
  return rows.filter((c) => c.parentId === parentId).sort(bySortKey);
}

export async function createCategory(
  name: string,
  parentId: string | null = null,
  color: string | null = null
): Promise<Category> {
  const siblings = await childrenOf(parentId);
  const cat: Category = {
    id: newId(),
    parentId,
    name: name.trim() || 'Untitled',
    description: null,
    color,
    sortKey: keyAtEnd(siblings.at(-1)?.sortKey ?? null),
    verseSortMode: 'quran',
    isExpanded: true,
    ...envelope(),
  };
  await db().transaction('rw', db().categories, db().outbox, async () => {
    await db().categories.add(cat);
    await log('categories', cat.id, 'put', cat);
  });
  return cat;
}

export async function updateCategory(id: string, patch: Partial<Category>) {
  const d = db();
  await d.transaction('rw', d.categories, d.outbox, async () => {
    const cur = await d.categories.get(id);
    if (!cur) return;
    const next = touch({ ...cur, ...patch });
    await d.categories.put(next);
    await log('categories', id, 'put', next);
  });
}

/**
 * Expanded / collapsed, for one row or for the whole tree.
 *
 * This is the one deliberate exception to "every write stamps the envelope and
 * appends to the outbox", and it is worth stating why. Whether a row is twirled
 * open is view state, not user data: nobody wants their iPad collapsing a branch
 * because they collapsed it on a laptop, and a Phase 7 change feed built on
 * `where('updatedAt').above(since)` should not carry it. So this writer persists
 * the flag — it must survive a reload — while leaving `rev` and `updatedAt`
 * alone, which keeps these rows out of the feed entirely.
 *
 * It is also why this takes a list. "Expand all" used to call updateCategory
 * once per category, opening one read-write transaction per row and logging one
 * sync op each: six clicks on a 140-category tree produced 840 outbox entries.
 * One transaction, no log.
 */
export async function setCategoriesExpanded(ids: string[], isExpanded: boolean) {
  if (!ids.length) return;
  const d = db();
  await d.transaction('rw', d.categories, async () => {
    const rows = await d.categories.bulkGet(ids);
    const next = rows.filter((r): r is Category => !!r).map((r) => ({ ...r, isExpanded }));
    if (next.length) await d.categories.bulkPut(next);
  });
}

/** Soft delete: the category and its whole subtree, plus their verse assignments. */
export async function deleteCategory(id: string) {
  const d = db();
  const all = await listCategories();
  const doomed: string[] = [];
  const walk = (cid: string) => {
    doomed.push(cid);
    all.filter((c) => c.parentId === cid).forEach((c) => walk(c.id));
  };
  walk(id);

  await d.transaction('rw', d.categories, d.categoryVerses, d.verseMarkers, d.outbox, async () => {
    const now = Date.now();
    for (const cid of doomed) {
      const cur = await d.categories.get(cid);
      if (cur) {
        const next = { ...touch(cur), deletedAt: now };
        await d.categories.put(next);
        await log('categories', cid, 'delete', next);
      }
      const links = await d.categoryVerses.where('categoryId').equals(cid).toArray();
      for (const l of alive(links)) {
        const next = { ...touch(l), deletedAt: now };
        await d.categoryVerses.put(next);
        await log('categoryVerses', l.id, 'delete', next);
      }
    }
  });

  // Markers are derived; refresh the verses that were in the deleted subtree.
  const affected = new Set<string>();
  for (const cid of doomed) {
    const links = await d.categoryVerses.where('categoryId').equals(cid).toArray();
    links.forEach((l) => affected.add(l.verseKey));
  }
  for (const k of affected) await refreshMarker(k);
}

/** True when `targetId` sits inside the subtree rooted at `id` (or is `id`). */
export function isDescendant(all: Category[], id: string, targetId: string | null): boolean {
  if (!targetId) return false;
  let cur: string | null = targetId;
  const byId = new Map(all.map((c) => [c.id, c]));
  while (cur) {
    if (cur === id) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export async function moveCategory(id: string, newParentId: string | null, index: number) {
  const all = await listCategories();
  // Cycle guard lives here, not in the UI — a drop is not the only way to move.
  if (isDescendant(all, id, newParentId)) return;

  const siblings = all.filter((c) => c.parentId === newParentId && c.id !== id).sort(bySortKey);
  const before = index > 0 ? siblings[index - 1]?.sortKey ?? null : null;
  const after = siblings[index]?.sortKey ?? null;
  await updateCategory(id, { parentId: newParentId, sortKey: keyBetween(before, after) });
}

// ------------------------------------------------------- verses ↔ categories

export async function versesInCategory(categoryId: string): Promise<CategoryVerse[]> {
  const rows = await db().categoryVerses.where('categoryId').equals(categoryId).toArray();
  return alive(rows);
}

export async function orderedVersesInCategory(cat: Category): Promise<CategoryVerse[]> {
  const rows = await versesInCategory(cat.id);
  return cat.verseSortMode === 'quran'
    ? rows.sort((a, b) => a.verseId - b.verseId || (a.id < b.id ? -1 : 1))
    : rows.sort(bySortKey);
}

export async function categoriesForVerse(verseKey: string): Promise<string[]> {
  const rows = await db().categoryVerses.where('verseKey').equals(verseKey).toArray();
  return alive(rows).map((r) => r.categoryId);
}

export async function addVerseToCategory(
  categoryId: string,
  verseKey: string,
  verseId: number,
  atIndex?: number
): Promise<void> {
  const d = db();
  const existing = await d.categoryVerses
    .where('[categoryId+verseKey]')
    .equals([categoryId, verseKey])
    .first();

  if (existing) {
    // Re-adding a soft-deleted link revives it rather than creating a duplicate.
    if (existing.deletedAt !== null) {
      const next = { ...touch(existing), deletedAt: null };
      await d.transaction('rw', d.categoryVerses, d.outbox, async () => {
        await d.categoryVerses.put(next);
        await log('categoryVerses', next.id, 'put', next);
      });
      await refreshMarker(verseKey);
    }
    return;
  }

  const siblings = (await versesInCategory(categoryId)).sort(bySortKey);
  const idx = atIndex ?? siblings.length;
  const before = idx > 0 ? siblings[idx - 1]?.sortKey ?? null : null;
  const after = siblings[idx]?.sortKey ?? null;

  const link: CategoryVerse = {
    id: newId(),
    categoryId,
    verseKey,
    verseId,
    sortKey: keyBetween(before, after),
    note: null,
    ...envelope(),
  };

  await d.transaction('rw', d.categoryVerses, d.outbox, async () => {
    await d.categoryVerses.add(link);
    await log('categoryVerses', link.id, 'put', link);
  });
  await refreshMarker(verseKey);
}

/** Every verse from `fromKey` to `toKey` inclusive, in Quran order. */
export async function versesBetween(fromKey: string, toKey: string) {
  const [a, b] = await Promise.all([getVerseByKey(fromKey), getVerseByKey(toKey)]);
  if (!a || !b) return [];
  const [lo, hi] = a.id <= b.id ? [a.id, b.id] : [b.id, a.id];
  return db().verses.where('id').between(lo, hi, true, true).toArray();
}

/** Category ids that any of `verseKeys` belong to, mapped to how many of them. */
export async function categoriesForVerses(verseKeys: string[]): Promise<Map<string, number>> {
  if (!verseKeys.length) return new Map();
  const rows = await db().categoryVerses.where('verseKey').anyOf(verseKeys).toArray();
  const counts = new Map<string, number>();
  alive(rows).forEach((r) => counts.set(r.categoryId, (counts.get(r.categoryId) ?? 0) + 1));
  return counts;
}

/**
 * Files a whole selection into one category.
 *
 * Not a loop over addVerseToCategory: that reads the category's links, opens a
 * transaction and logs a sync op per verse, so filing a 30-verse passage would
 * be 30 round trips and 30 outbox rows written one at a time. This reads once,
 * writes once, and hands the range a contiguous run of sort keys so it keeps the
 * order it was selected in.
 *
 * Verses already in the category are skipped; ones whose link was soft-deleted
 * are revived rather than duplicated, matching addVerseToCategory.
 * Returns how many were actually added.
 */
export async function addVersesToCategory(
  categoryId: string,
  verses: { key: string; id: number }[]
): Promise<number> {
  if (!verses.length) return 0;
  const d = db();
  const existing = await d.categoryVerses.where('categoryId').equals(categoryId).toArray();
  const byKey = new Map(existing.map((r) => [r.verseKey, r]));
  let last = alive(existing).sort(bySortKey).at(-1)?.sortKey ?? null;

  const writes: CategoryVerse[] = [];
  for (const v of verses) {
    const cur = byKey.get(v.key);
    if (cur && cur.deletedAt === null) continue;
    if (cur) {
      writes.push({ ...touch(cur), deletedAt: null });
      continue;
    }
    last = keyAtEnd(last);
    writes.push({
      id: newId(),
      categoryId,
      verseKey: v.key,
      verseId: v.id,
      sortKey: last,
      note: null,
      ...envelope(),
    });
  }
  if (!writes.length) return 0;

  await d.transaction('rw', d.categoryVerses, d.outbox, async () => {
    await d.categoryVerses.bulkPut(writes);
    for (const r of writes) await log('categoryVerses', r.id, 'put', r);
  });
  for (const r of writes) await refreshMarker(r.verseKey);
  return writes.length;
}

/** Removes a whole selection from one category. Returns how many were removed. */
export async function removeVersesFromCategory(
  categoryId: string,
  verseKeys: string[]
): Promise<number> {
  if (!verseKeys.length) return 0;
  const d = db();
  const rows = await d.categoryVerses.where('categoryId').equals(categoryId).toArray();
  const wanted = new Set(verseKeys);
  const now = Date.now();
  const writes = alive(rows)
    .filter((r) => wanted.has(r.verseKey))
    .map((r) => ({ ...touch(r), deletedAt: now }));
  if (!writes.length) return 0;

  await d.transaction('rw', d.categoryVerses, d.outbox, async () => {
    await d.categoryVerses.bulkPut(writes);
    for (const r of writes) await log('categoryVerses', r.id, 'delete', r);
  });
  for (const r of writes) await refreshMarker(r.verseKey);
  return writes.length;
}

/** Bookmarks a whole selection in one colour. Returns how many were added. */
export async function addBookmarks(
  verses: { key: string; id: number }[],
  color: string
): Promise<number> {
  let n = 0;
  for (const v of verses) {
    const existing = await db().bookmarks.where('verseKey').equals(v.key).toArray();
    if (alive(existing).length) continue;
    await addBookmark(v.key, v.id, color);
    n++;
  }
  return n;
}

export async function removeVerseFromCategory(categoryId: string, verseKey: string) {
  const d = db();
  const link = await d.categoryVerses
    .where('[categoryId+verseKey]')
    .equals([categoryId, verseKey])
    .first();
  if (!link || link.deletedAt !== null) return;
  const next = { ...touch(link), deletedAt: Date.now() };
  await d.transaction('rw', d.categoryVerses, d.outbox, async () => {
    await d.categoryVerses.put(next);
    await log('categoryVerses', next.id, 'delete', next);
  });
  await refreshMarker(verseKey);
}

export async function reorderVerseInCategory(
  categoryId: string,
  linkId: string,
  toIndex: number
) {
  const d = db();
  const rows = (await versesInCategory(categoryId)).sort(bySortKey);
  const without = rows.filter((r) => r.id !== linkId);
  const before = toIndex > 0 ? without[toIndex - 1]?.sortKey ?? null : null;
  const after = without[toIndex]?.sortKey ?? null;
  const link = rows.find((r) => r.id === linkId);
  if (!link) return;
  const next = touch({ ...link, sortKey: keyBetween(before, after) });
  await d.transaction('rw', d.categoryVerses, d.outbox, async () => {
    await d.categoryVerses.put(next);
    await log('categoryVerses', next.id, 'put', next);
  });
}

// ------------------------------------------------------------------- notes

export const getNote = (verseKey: string) =>
  db().notes.where('verseKey').equals(verseKey).first();

export async function saveNote(verseKey: string, contentJson: unknown, contentText: string) {
  const d = db();
  await d.transaction('rw', d.notes, d.outbox, async () => {
    const cur = await d.notes.where('verseKey').equals(verseKey).first();
    const next: Note = cur
      ? { ...touch(cur), contentJson, contentText, deletedAt: null }
      : { id: newId(), verseKey, contentJson, contentText, ...envelope() };
    await d.notes.put(next);
    await log('notes', next.id, 'put', next);
  });
  await refreshMarker(verseKey);
}

export async function deleteNote(verseKey: string) {
  const d = db();
  const cur = await d.notes.where('verseKey').equals(verseKey).first();
  if (!cur) return;
  const next = { ...touch(cur), deletedAt: Date.now() };
  await d.transaction('rw', d.notes, d.outbox, async () => {
    await d.notes.put(next);
    await log('notes', next.id, 'delete', next);
  });
  await refreshMarker(verseKey);
}

export const listNotes = async () => alive(await db().notes.toArray());

// --------------------------------------------------------------- bookmarks

export const listBookmarks = async () =>
  (await db().bookmarks.toArray()).filter((b) => b.deletedAt === null).sort((a, b) => a.verseId - b.verseId);

export const bookmarksForVerse = async (verseKey: string) =>
  alive(await db().bookmarks.where('verseKey').equals(verseKey).toArray());

export async function addBookmark(
  verseKey: string,
  verseId: number,
  color: string,
  label: string | null = null
) {
  const d = db();
  const bm: Bookmark = { id: newId(), verseKey, verseId, label, color, ...envelope() };
  await d.transaction('rw', d.bookmarks, d.outbox, async () => {
    await d.bookmarks.add(bm);
    await log('bookmarks', bm.id, 'put', bm);
  });
  await refreshMarker(verseKey);
  return bm;
}

export async function removeBookmark(id: string) {
  const d = db();
  const cur = await d.bookmarks.get(id);
  if (!cur) return;
  const next = { ...touch(cur), deletedAt: Date.now() };
  await d.transaction('rw', d.bookmarks, d.outbox, async () => {
    await d.bookmarks.put(next);
    await log('bookmarks', next.id, 'delete', next);
  });
  await refreshMarker(cur.verseKey);
}

// ------------------------------------------------------- reading + settings

export const getReadingState = () => db().readingState.get('current');

export async function saveReadingState(page: number, verseKey: string, offset: number) {
  await db().readingState.put({
    id: 'current',
    page,
    verseKey,
    scrollOffsetInPage: offset,
    updatedAt: Date.now(),
  } satisfies ReadingState);
}

export const getSettings = () => db().settings.get('current');

export async function saveSettings(patch: Partial<Settings>) {
  const cur = (await getSettings()) ?? {
    id: 'current' as const,
    theme: 'light' as const,
    pageScale: 1,
    layoutMode: 'auto' as const,
    updatedAt: Date.now(),
  };
  await db().settings.put({ ...cur, ...patch, updatedAt: Date.now() });
}

// -------------------------------------------------------------- maintenance

/** Recompute every marker from scratch. Cheap enough to run after a sync pass. */
export async function rebuildMarkers() {
  const d = db();
  const keys = new Set<string>();
  (await d.notes.toArray()).forEach((n) => keys.add(n.verseKey));
  (await d.bookmarks.toArray()).forEach((b) => keys.add(b.verseKey));
  (await d.categoryVerses.toArray()).forEach((l) => keys.add(l.verseKey));
  await d.verseMarkers.clear();
  for (const k of keys) await refreshMarker(k);
}

export const outboxSize = () => db().outbox.count();

/** Whole-database export, so a local-only user is never trapped. */
export async function exportAll() {
  const d = db();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: await d.categories.toArray(),
    categoryVerses: await d.categoryVerses.toArray(),
    notes: await d.notes.toArray(),
    bookmarks: await d.bookmarks.toArray(),
    settings: await d.settings.toArray(),
  };
}

export async function importAll(dump: Awaited<ReturnType<typeof exportAll>>) {
  const d = db();
  await d.transaction(
    'rw',
    d.categories,
    d.categoryVerses,
    d.notes,
    d.bookmarks,
    d.settings,
    async () => {
      if (dump.categories) await d.categories.bulkPut(dump.categories);
      if (dump.categoryVerses) await d.categoryVerses.bulkPut(dump.categoryVerses);
      if (dump.notes) await d.notes.bulkPut(dump.notes);
      if (dump.bookmarks) await d.bookmarks.bulkPut(dump.bookmarks);
      if (dump.settings) await d.settings.bulkPut(dump.settings);
    }
  );
  await rebuildMarkers();
}

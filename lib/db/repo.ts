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
import { bySortKey, keyAtEnd, keyBetween, keysBetween } from '@/lib/ordering';

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
  const assignedCategories = await d.categories.bulkGet(liveAssignments.map((assignment) => assignment.categoryId));
  const qaCategoryIds = new Set(
    assignedCategories
      .filter((category) => category?.deletedAt === null && category.description === QA_CATEGORY_MARKER)
      .map((category) => category!.id)
  );
  const qaCount = liveAssignments.filter((assignment) => qaCategoryIds.has(assignment.categoryId)).length;
  const topicAssignments = liveAssignments.filter((assignment) => !qaCategoryIds.has(assignment.categoryId));
  const hasNote = !!note && note.deletedAt === null && note.contentText.trim().length > 0;

  const marker: VerseMarker = {
    verseKey,
    hasNote,
    hasBookmark: liveBookmarks.length > 0,
    categoryCount: liveAssignments.length - qaCount,
    categoryGroupKeys: topicAssignments
      .map((assignment) => `${assignment.categoryId}:${assignment.groupId ?? assignment.id}`)
      .sort(),
    qaCount,
    bookmarkColor: liveBookmarks[0]?.color ?? null,
  };

  if (!marker.hasNote && !marker.hasBookmark && marker.categoryCount === 0 && marker.qaCount === 0) {
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

export type CategorySpaceFilter = 'topics' | 'qa' | 'all';
export const QA_CATEGORY_MARKER = '__quran_categories_qa__';

export async function listCategories(space: CategorySpaceFilter = 'topics'): Promise<Category[]> {
  const rows = await db().categories.toArray();
  return alive(rows)
    .filter((category) => space === 'all' || (space === 'qa'
      ? category.description === QA_CATEGORY_MARKER
      : category.description !== QA_CATEGORY_MARKER))
    .sort(bySortKey);
}

export async function childrenOf(parentId: string | null, all?: Category[]): Promise<Category[]> {
  const rows = all ?? (await listCategories());
  return rows.filter((c) => c.parentId === parentId).sort(bySortKey);
}

export async function createCategory(
  nameArabic: string,
  parentId: string | null = null,
  color: string | null = null,
  nameEnglish: string = '',
  space: 'topics' | 'qa' = 'topics'
): Promise<Category> {
  const siblings = (await listCategories(space)).filter((category) => category.parentId === parentId);
  const cat: Category = {
    id: newId(),
    parentId,
    name: nameArabic.trim() || nameEnglish.trim() || 'Untitled',
    nameArabic: nameArabic.trim(),
    nameEnglish: nameEnglish.trim(),
    description: space === 'qa' ? QA_CATEGORY_MARKER : null,
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
  const all = await listCategories('all');
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
  const all = await listCategories('all');
  // Cycle guard lives here, not in the UI — a drop is not the only way to move.
  if (isDescendant(all, id, newParentId)) return;

  const siblings = all.filter((c) => c.parentId === newParentId && c.id !== id).sort(bySortKey);
  const before = index > 0 ? siblings[index - 1]?.sortKey ?? null : null;
  const after = siblings[index]?.sortKey ?? null;
  await updateCategory(id, { parentId: newParentId, sortKey: keyBetween(before, after) });
}

/**
 * Merge one topic into another while keeping the target topic's title.
 *
 * Direct verse assignments move to the target, existing target assignments
 * win over duplicates, ranges retain their group ids, and source subtopics are
 * re-parented instead of being deleted. Q/A items cannot be merged through
 * this operation.
 */
export async function mergeCategory(sourceId: string, targetId: string) {
  if (sourceId === targetId) throw new Error('A topic cannot be merged into itself');
  const d = db();
  const all = await listCategories('all');
  const source = all.find((category) => category.id === sourceId);
  const target = all.find((category) => category.id === targetId);
  if (!source || !target) throw new Error('One of the topics no longer exists');
  if (source.description === QA_CATEGORY_MARKER || target.description === QA_CATEGORY_MARKER) {
    throw new Error('Q/A items cannot be merged as topics');
  }
  if (isDescendant(all, sourceId, targetId)) {
    throw new Error('Choose a topic outside the topic being removed');
  }

  const [sourceRows, targetRows] = await Promise.all([
    d.categoryVerses.where('categoryId').equals(sourceId).toArray(),
    d.categoryVerses.where('categoryId').equals(targetId).toArray(),
  ]);
  const sourceLinks = alive(sourceRows).sort(bySortKey);
  const targetByVerse = new Map(targetRows.map((row) => [row.verseKey, row]));
  let lastVerseSortKey = alive(targetRows).sort(bySortKey).at(-1)?.sortKey ?? null;
  const children = all.filter((category) => category.parentId === sourceId).sort(bySortKey);
  let lastChildSortKey = all
    .filter((category) => category.parentId === targetId)
    .sort(bySortKey)
    .at(-1)?.sortKey ?? null;
  const affectedVerseKeys = new Set(sourceLinks.map((row) => row.verseKey));
  let moved = 0;
  let duplicates = 0;

  await d.transaction('rw', d.categories, d.categoryVerses, d.outbox, async () => {
    const now = Date.now();
    for (const sourceLink of sourceLinks) {
      const targetLink = targetByVerse.get(sourceLink.verseKey);
      if (targetLink?.deletedAt === null) {
        const removed = { ...touch(sourceLink), deletedAt: now };
        await d.categoryVerses.put(removed);
        await log('categoryVerses', removed.id, 'delete', removed);
        duplicates += 1;
        continue;
      }

      lastVerseSortKey = keyAtEnd(lastVerseSortKey);
      if (targetLink) {
        const revived = touch({
          ...targetLink,
          deletedAt: null,
          groupId: sourceLink.groupId ?? null,
          sortKey: lastVerseSortKey,
          note: sourceLink.note ?? targetLink.note,
        });
        const removed = { ...touch(sourceLink), deletedAt: now };
        await d.categoryVerses.put(revived);
        await log('categoryVerses', revived.id, 'put', revived);
        await d.categoryVerses.put(removed);
        await log('categoryVerses', removed.id, 'delete', removed);
      } else {
        const transferred = touch({
          ...sourceLink,
          categoryId: targetId,
          sortKey: lastVerseSortKey,
        });
        await d.categoryVerses.put(transferred);
        await log('categoryVerses', transferred.id, 'put', transferred);
      }
      moved += 1;
    }

    for (const child of children) {
      lastChildSortKey = keyAtEnd(lastChildSortKey);
      const reparented = touch({ ...child, parentId: targetId, sortKey: lastChildSortKey });
      await d.categories.put(reparented);
      await log('categories', reparented.id, 'put', reparented);
    }

    const removedSource = { ...touch(source), deletedAt: now };
    await d.categories.put(removedSource);
    await log('categories', removedSource.id, 'delete', removedSource);
  });

  for (const verseKey of affectedVerseKeys) await refreshMarker(verseKey);
  return { moved, duplicates, subtopicsMoved: children.length };
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
  const groupId = verses.length > 1 ? newId() : null;

  const writes: CategoryVerse[] = [];
  for (const v of verses) {
    const cur = byKey.get(v.key);
    if (cur && cur.deletedAt === null) {
      // A partly filed selection still becomes one complete visual unit.
      if (groupId) writes.push(touch({ ...cur, groupId }));
      continue;
    }
    if (cur) {
      writes.push({ ...touch(cur), deletedAt: null, groupId });
      continue;
    }
    last = keyAtEnd(last);
    writes.push({
      id: newId(),
      categoryId,
      verseKey: v.key,
      verseId: v.id,
      groupId,
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

/** Reorders a standalone verse or a whole filed range as one manual-order unit. */
export async function reorderVerseUnitInCategory(
  categoryId: string,
  linkId: string,
  groupId: string | null,
  toUnitIndex: number
) {
  const d = db();
  const rows = (await versesInCategory(categoryId)).sort(bySortKey);
  const units: CategoryVerse[][] = [];
  const grouped = new Map<string, CategoryVerse[]>();

  for (const row of rows) {
    if (!row.groupId) {
      units.push([row]);
      continue;
    }
    const unit = grouped.get(row.groupId);
    if (unit) unit.push(row);
    else {
      const next = [row];
      grouped.set(row.groupId, next);
      units.push(next);
    }
  }

  const movingIndex = units.findIndex((unit) =>
    groupId ? unit[0]?.groupId === groupId : unit.some((row) => row.id === linkId)
  );
  if (movingIndex < 0) return;

  const [moving] = units.splice(movingIndex, 1);
  // Drop indices describe the original list. Once an earlier unit is removed,
  // every target after it shifts left by one.
  const adjustedIndex = movingIndex < toUnitIndex ? toUnitIndex - 1 : toUnitIndex;
  const index = Math.max(0, Math.min(adjustedIndex, units.length));
  const before = index > 0 ? units[index - 1]?.at(-1)?.sortKey ?? null : null;
  const after = units[index]?.[0]?.sortKey ?? null;
  const sortKeys = keysBetween(before, after, moving.length);
  const writes = moving.map((row, i) => touch({ ...row, sortKey: sortKeys[i] }));

  await d.transaction('rw', d.categoryVerses, d.outbox, async () => {
    await d.categoryVerses.bulkPut(writes);
    for (const row of writes) await log('categoryVerses', row.id, 'put', row);
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
  const d = db();
  const current = await d.readingState.get('current');
  if (
    current?.page === page &&
    current.verseKey === verseKey &&
    Math.abs(current.scrollOffsetInPage - offset) < 0.01
  ) return;
  const readingState = {
    id: 'current',
    page,
    verseKey,
    scrollOffsetInPage: offset,
    updatedAt: Date.now(),
  } satisfies ReadingState;
  await d.transaction('rw', d.readingState, d.outbox, async () => {
    await d.readingState.put(readingState);
    await log('readingState', readingState.id, 'put', readingState);
  });
  window.dispatchEvent(new CustomEvent('quran-reading-state-saved'));
}

export const getSettings = () => db().settings.get('current');

export async function saveSettings(patch: Partial<Settings>) {
  const d = db();
  const cur = (await getSettings()) ?? {
    id: 'current' as const,
    theme: 'light' as const,
    pageScale: 1,
    layoutMode: 'auto' as const,
    translationLanguage: 'en' as const,
    categoryArabicFontSize: 22.5,
    categoryTranslationFontSize: 24,
    categoryTitleFontSize: 14,
    recentSearchFontSize: 11,
    updatedAt: Date.now(),
  };
  const settings = { ...cur, ...patch, updatedAt: Date.now() };
  // Settings are presentation preferences, not account content. Keep them in
  // this browser/app's IndexedDB so phone, tablet and desktop values can differ.
  await d.settings.put(settings);
}

// -------------------------------------------------------------- maintenance

/**
 * Recompute the derived marker table after a sync pass.
 *
 * Do not clear and refill it verse by verse: Dexie publishes every intermediate
 * state to live queries, which makes all Quran highlights briefly disappear and
 * reappear. Skip the write entirely when nothing changed, and otherwise replace
 * the snapshot in one transaction.
 */
export async function rebuildMarkers() {
  const d = db();
  const [categories, notes, bookmarks, assignments] = await Promise.all([
    d.categories.toArray(),
    d.notes.toArray(),
    d.bookmarks.toArray(),
    d.categoryVerses.toArray(),
  ]);
  const qaCategoryIds = new Set(
    alive(categories)
      .filter((category) => category.description === QA_CATEGORY_MARKER)
      .map((category) => category.id)
  );
  const keys = new Set<string>();
  notes.forEach((note) => keys.add(note.verseKey));
  bookmarks.forEach((bookmark) => keys.add(bookmark.verseKey));
  assignments.forEach((assignment) => keys.add(assignment.verseKey));

  const noteByVerse = new Map(notes.map((note) => [note.verseKey, note]));
  const bookmarksByVerse = new Map<string, Bookmark[]>();
  const assignmentsByVerse = new Map<string, CategoryVerse[]>();
  for (const bookmark of bookmarks) {
    const rows = bookmarksByVerse.get(bookmark.verseKey) ?? [];
    rows.push(bookmark);
    bookmarksByVerse.set(bookmark.verseKey, rows);
  }
  for (const assignment of assignments) {
    const rows = assignmentsByVerse.get(assignment.verseKey) ?? [];
    rows.push(assignment);
    assignmentsByVerse.set(assignment.verseKey, rows);
  }

  const next: VerseMarker[] = [];
  for (const verseKey of keys) {
    const note = noteByVerse.get(verseKey);
    const liveBookmarks = alive(bookmarksByVerse.get(verseKey) ?? []);
    const liveAssignments = alive(assignmentsByVerse.get(verseKey) ?? []);
    const qaCount = liveAssignments.filter((assignment) => qaCategoryIds.has(assignment.categoryId)).length;
    const topicAssignments = liveAssignments.filter((assignment) => !qaCategoryIds.has(assignment.categoryId));
    const marker: VerseMarker = {
      verseKey,
      hasNote: !!note && note.deletedAt === null && note.contentText.trim().length > 0,
      hasBookmark: liveBookmarks.length > 0,
      categoryCount: liveAssignments.length - qaCount,
      categoryGroupKeys: topicAssignments
        .map((assignment) => `${assignment.categoryId}:${assignment.groupId ?? assignment.id}`)
        .sort(),
      qaCount,
      bookmarkColor: liveBookmarks[0]?.color ?? null,
    };
    if (marker.hasNote || marker.hasBookmark || marker.categoryCount > 0 || marker.qaCount > 0) next.push(marker);
  }

  const byKey = (a: VerseMarker, b: VerseMarker) => a.verseKey.localeCompare(b.verseKey);
  const current = (await d.verseMarkers.toArray()).sort(byKey);
  next.sort(byKey);
  const unchanged = current.length === next.length && current.every((marker, index) => {
    const candidate = next[index];
    return marker.verseKey === candidate.verseKey
      && marker.hasNote === candidate.hasNote
      && marker.hasBookmark === candidate.hasBookmark
      && marker.categoryCount === candidate.categoryCount
      && JSON.stringify(marker.categoryGroupKeys ?? []) === JSON.stringify(candidate.categoryGroupKeys ?? [])
      && marker.qaCount === candidate.qaCount
      && marker.bookmarkColor === candidate.bookmarkColor;
  });
  if (unchanged) return;

  await d.transaction('rw', d.verseMarkers, async () => {
    await d.verseMarkers.clear();
    if (next.length) await d.verseMarkers.bulkPut(next);
  });
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

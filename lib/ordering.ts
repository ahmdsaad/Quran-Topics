import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Ordering keys for drag-and-drop lists.
 *
 * Why fractional indices and not integer positions: dropping an item between two
 * others is ONE write, not a renumbering of every sibling after the drop point.
 * On a category holding 300 verses that is the difference between 1 IndexedDB
 * write and 300, on a tablet, mid-gesture. See docs/DATA_MODEL.md §4.
 */

export const keyBetween = (a: string | null, b: string | null) => generateKeyBetween(a, b);

export const keysBetween = (a: string | null, b: string | null, n: number) =>
  generateNKeysBetween(a, b, n);

export const keyAtEnd = (last: string | null) => generateKeyBetween(last, null);

export const keyAtStart = (first: string | null) => generateKeyBetween(null, first);

/**
 * Sort comparator for anything ordered by sortKey.
 *
 * The `id` tiebreaker matters: fractional indexing is conflict-TOLERANT, not
 * collision-free — two devices inserting at the same position offline can
 * generate the same key. Without a stable tiebreaker those two rows would sort
 * differently on different devices, which is a miserable bug to find later.
 */
export const bySortKey = <T extends { sortKey: string; id: string }>(a: T, b: T) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1;

/** Keys grow ~1 char per repeated insert at the same spot. Past this, rebalance. */
export const REBALANCE_THRESHOLD = 12;

export const needsRebalance = (keys: string[]) =>
  keys.some((k) => k.length > REBALANCE_THRESHOLD);

/** Fresh evenly-spaced keys for a list whose order is already correct. */
export const rebalance = (count: number) => generateNKeysBetween(null, null, count);

/**
 * Compute the key for an item dropped at `index` in a list that currently has
 * `keys` (excluding the moved item itself).
 */
export function keyForDropAt(keys: string[], index: number): string {
  const before = index > 0 ? keys[index - 1] ?? null : null;
  const after = index < keys.length ? keys[index] ?? null : null;
  return generateKeyBetween(before, after);
}

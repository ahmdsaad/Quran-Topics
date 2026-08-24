'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Category, Meta, Verse } from '@/lib/types';
import {
  addVersesToCategory,
  categoriesForVerses,
  createCategory,
  getVersesByKeys,
  listCategories,
  removeVersesFromCategory,
} from '@/lib/db/repo';
import { useUI } from '@/lib/store';
import { rangeLabel } from '@/lib/mushaf/verseRange';

/** Flattens the category tree to rows with a depth, preserving sibling order. */
export function flattenTree(cats: Category[], parentId: string | null = null, depth = 0):
  { cat: Category; depth: number }[] {
  return cats
    .filter((c) => c.parentId === parentId)
    .flatMap((c) => [{ cat: c, depth }, ...flattenTree(cats, c.id, depth + 1)]);
}

export default function AssignSheet({ meta }: { meta: Meta }) {
  const { assignVerses, closeAssign, showToast, clearSelection } = useUI();
  const [verses, setVerses] = useState<Verse[]>([]);
  const [q, setQ] = useState('');
  const [newName, setNewName] = useState('');

  const keys = assignVerses;
  const keySig = keys.join(',');

  const cats = useLiveQuery(() => listCategories(), [], [] as Category[]);

  // How many of the selected verses each category already holds. A count rather
  // than a boolean: with a range selected, a category can hold some of it, and
  // the row has to say so instead of lying in either direction.
  const counts = useLiveQuery(
    () => (keys.length ? categoriesForVerses(keys) : Promise.resolve(new Map<string, number>())),
    [keySig],
    new Map<string, number>()
  );

  useEffect(() => {
    if (!keys.length) {
      setVerses([]);
      return;
    }
    let live = true;
    setQ('');
    setNewName('');
    getVersesByKeys(keys).then((v) => live && setVerses(v));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySig]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeAssign();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeAssign]);

  const rows = useMemo(() => {
    const flat = flattenTree(cats ?? []);
    if (!q.trim()) return flat;
    const needle = q.toLowerCase();
    return flat.filter((r) => r.cat.name.toLowerCase().includes(needle));
  }, [cats, q]);

  if (!keys.length) return null;

  const many = keys.length > 1;
  const first = verses[0];
  const surah = first ? meta.surahs.find((s) => s.number === first.surah) : null;
  const subtitle = many
    ? `${keys.length} verses · ${rangeLabel(keys[0], keys[keys.length - 1])}`
    : `${surah?.nameSimple ?? ''} ${first?.ayah ?? ''} · ${keys[0]}`;

  const payload = () => verses.map((v) => ({ key: v.key, id: v.id }));

  const toggle = async (cat: Category) => {
    if (!verses.length) return;
    const have = counts?.get(cat.id) ?? 0;
    if (have === keys.length) {
      const n = await removeVersesFromCategory(cat.id, keys);
      showToast(n === 1 ? 'Removed from category' : `Removed ${n} verses`);
    } else {
      // Partly-filed selection fills the rest rather than toggling off, so a
      // half-checked row always moves towards "all of it is in here".
      const n = await addVersesToCategory(cat.id, payload());
      showToast(n === 1 ? `Added to “${cat.name}”` : `Added ${n} verses to “${cat.name}”`);
    }
  };

  const addNew = async () => {
    if (!newName.trim() || !verses.length) return;
    const cat = await createCategory(newName.trim());
    const n = await addVersesToCategory(cat.id, payload());
    setNewName('');
    showToast(n === 1 ? `Added to “${cat.name}”` : `Added ${n} verses to “${cat.name}”`);
  };

  const done = () => {
    closeAssign();
    if (many) clearSelection();
  };

  return (
    <div className="fixed inset-0 z-[72] flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0" style={{ background: 'rgb(0 0 0 / 0.4)' }} onClick={done} />
      <div className="panel relative flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-b-none sm:rounded-b-[10px]">
        <header className="shrink-0 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                {many ? `Add ${keys.length} verses to categories` : 'Add to categories'}
              </h2>
              <p className="truncate text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                {subtitle}
              </p>
            </div>
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={done}>
              Done
            </button>
          </div>
          {(cats ?? []).length > 6 ? (
            <input
              className="field mt-2"
              dir="auto"
              placeholder="Filter categories…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          ) : null}
        </header>

        <div className="scroll-y flex-1">
          {rows.length ? (
            rows.map(({ cat, depth }) => {
              const have = counts?.get(cat.id) ?? 0;
              const all = have === keys.length;
              const some = have > 0 && !all;
              return (
                <button
                  key={cat.id}
                  className="flex w-full items-center gap-2 border-b px-4 py-2.5 text-left"
                  style={{ borderColor: 'var(--border)', paddingInlineStart: 16 + depth * 18 }}
                  onClick={() => toggle(cat)}
                  aria-pressed={all}
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px]"
                    style={{
                      borderColor: have ? 'var(--accent)' : 'var(--border)',
                      background: all ? 'var(--accent)' : 'transparent',
                      color: all ? '#fff' : 'var(--accent)',
                    }}
                  >
                    {all ? '✓' : some ? '–' : ''}
                  </span>
                  {cat.color ? (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: cat.color }}
                    />
                  ) : null}
                  <span dir="auto" className="min-w-0 flex-1 truncate text-sm">{cat.name}</span>
                  {some ? (
                    <span className="shrink-0 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                      {have} of {keys.length}
                    </span>
                  ) : null}
                </button>
              );
            })
          ) : (
            <p className="p-6 text-center text-sm" style={{ color: 'var(--ink-soft)' }}>
              {(cats ?? []).length
                ? `No category matches “${q}”.`
                : 'No categories yet. Create your first one below.'}
            </p>
          )}
        </div>

        <footer
          className="flex shrink-0 gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <input
            className="field"
            dir="auto"
            placeholder="New category name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addNew()}
          />
          <button className="btn btn-primary shrink-0" onClick={addNew} disabled={!newName.trim()}>
            Create
          </button>
        </footer>
      </div>
    </div>
  );
}

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
import { categoryTitles } from '@/lib/categories/titles';
import CategoryTitle from '@/components/categories/CategoryTitle';

/** Flattens the category tree to rows with a depth, preserving sibling order. */
export function flattenTree(cats: Category[], parentId: string | null = null, depth = 0):
  { cat: Category; depth: number }[] {
  return cats
    .filter((c) => c.parentId === parentId)
    .flatMap((c) => [{ cat: c, depth }, ...flattenTree(cats, c.id, depth + 1)]);
}

export default function AssignSheet({ meta }: { meta: Meta }) {
  const { assignVerses, assignSpace, closeAssign, showToast, clearSelection } = useUI();
  const [verses, setVerses] = useState<Verse[]>([]);
  const [q, setQ] = useState('');
  const [newArabic, setNewArabic] = useState('');
  const [newEnglish, setNewEnglish] = useState('');
  const [existingSelectionChanged, setExistingSelectionChanged] = useState(false);

  const keys = assignVerses;
  const keySig = keys.join(',');

  const cats = useLiveQuery(() => listCategories(assignSpace), [assignSpace], [] as Category[]);
  const collectionLabel = assignSpace === 'qa' ? 'Q/A' : 'topics';

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
    setNewArabic('');
    setNewEnglish('');
    setExistingSelectionChanged(false);
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
    return flat.filter((r) => {
      const titles = categoryTitles(r.cat);
      const searchableTitle = assignSpace === 'qa' ? titles.arabic : titles.combined;
      return searchableTitle.toLowerCase().includes(needle);
    });
  }, [assignSpace, cats, q]);

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
    showToast(n === 1 ? 'Removed from topic' : `Removed ${n} verses`);
    } else {
      // Partly-filed selection fills the rest rather than toggling off, so a
      // half-checked row always moves towards "all of it is in here".
      const n = await addVersesToCategory(cat.id, payload());
      const titles = categoryTitles(cat);
      const title = assignSpace === 'qa' ? (titles.arabic || cat.name) : titles.combined;
      showToast(n === 1 ? `Added to “${title}”` : `Added ${n} verses to “${title}”`);
    }
    setExistingSelectionChanged(true);
  };

  const addNew = async () => {
    if ((assignSpace === 'qa' ? !newArabic.trim() : (!newArabic.trim() && !newEnglish.trim())) || !verses.length) return;
    const cat = await createCategory(newArabic, null, null, newEnglish, assignSpace);
    const n = await addVersesToCategory(cat.id, payload());
    setNewArabic('');
    setNewEnglish('');
    setExistingSelectionChanged(true);
    const titles = categoryTitles(cat);
    const title = assignSpace === 'qa' ? (titles.arabic || cat.name) : titles.combined;
    showToast(n === 1 ? `Added to “${title}”` : `Added ${n} verses to “${title}”`);
  };

  const done = () => {
    closeAssign();
    if (many) clearSelection();
  };

  const hasNewTitle = assignSpace === 'qa'
    ? Boolean(newArabic.trim())
    : Boolean(newArabic.trim() || newEnglish.trim());

  return (
    <div className="fixed inset-0 z-[72] flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0" style={{ background: 'rgb(0 0 0 / 0.4)' }} onClick={done} />
      <div className="panel relative flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-b-none sm:rounded-b-[10px]">
        <header className="shrink-0 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">
                {many ? `Add ${keys.length} verses to ${collectionLabel}` : `Add to ${collectionLabel}`}
              </h2>
              <p className="truncate text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                {subtitle}
              </p>
            </div>
          </div>
          {(cats ?? []).length > 6 ? (
            <input
              className="field mt-2"
              dir="auto"
              placeholder={`Filter ${collectionLabel}…`}
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
                  <span className="min-w-0 flex-1 text-sm"><CategoryTitle category={cat} arabicOnly={assignSpace === 'qa'} /></span>
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
                ? `No ${collectionLabel} item matches “${q}”.`
                : `No ${collectionLabel} items yet. Create your first one below.`}
            </p>
          )}
        </div>

        <footer
          className="flex shrink-0 gap-2 border-t px-4 py-3"
          style={{ borderColor: 'var(--border)', paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <div className={`grid min-w-0 flex-1 gap-2 ${assignSpace === 'qa' ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {assignSpace !== 'qa' ? (
              <input className="field" dir="ltr" lang="en" placeholder="English title…" value={newEnglish}
                onChange={(e) => setNewEnglish(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNew()} />
            ) : null}
            <input className="field text-right" dir="rtl" lang="ar" placeholder="العنوان بالعربية…" value={newArabic}
              onChange={(e) => setNewArabic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNew()} />
          </div>
          <button
            className="btn btn-primary shrink-0"
            onClick={() => { if (hasNewTitle) void addNew(); else done(); }}
            disabled={!hasNewTitle && !existingSelectionChanged}
          >
            {hasNewTitle ? 'Create' : existingSelectionChanged ? 'Done' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}

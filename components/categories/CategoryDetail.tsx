'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import type { Category, CategoryVerse, Meta, Verse } from '@/lib/types';
import {
  getVersesByKeys,
  listCategories,
  orderedVersesInCategory,
  removeVerseFromCategory,
  updateCategory,
  getNote,
} from '@/lib/db/repo';
import { db } from '@/lib/db/schema';
import { useUI } from '@/lib/store';
import { exportCategoryDocx, exportCategoryXlsx } from '@/lib/export/exporters';

export default function CategoryDetail({
  meta,
  categoryId,
  onBack,
}: {
  meta: Meta;
  categoryId: string;
  onBack: () => void;
}) {
  const { jumpTo, setMobilePane, showToast, openNote } = useUI();
  const [busy, setBusy] = useState(false);

  const cat = useLiveQuery(() => db().categories.get(categoryId), [categoryId]);
  const all = useLiveQuery(() => listCategories(), [], [] as Category[]);
  const links = useLiveQuery(
    async () => (cat ? orderedVersesInCategory(cat) : ([] as CategoryVerse[])),
    [cat?.id, cat?.verseSortMode, cat?.updatedAt],
    [] as CategoryVerse[]
  );

  const [verses, setVerses] = useState<Map<string, Verse>>(new Map());
  useEffect(() => {
    const keys = (links ?? []).map((l) => l.verseKey);
    if (!keys.length) {
      setVerses(new Map());
      return;
    }
    let live = true;
    getVersesByKeys(keys).then((rows) => {
      if (live) setVerses(new Map(rows.map((v) => [v.key, v])));
    });
    return () => {
      live = false;
    };
  }, [links]);

  const subcats = useMemo(
    () => (all ?? []).filter((c) => c.parentId === categoryId),
    [all, categoryId]
  );

  if (!cat) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          Category not found.
        </p>
      </div>
    );
  }

  const doExport = async (kind: 'docx' | 'xlsx') => {
    setBusy(true);
    try {
      console.info('[export] start', kind, cat.id);
      const fn = kind === 'docx' ? exportCategoryDocx : exportCategoryXlsx;
      await fn(cat, all ?? [], meta);
      console.info('[export] done', kind);
      showToast(`Exported as ${kind.toUpperCase()}`);
    } catch (e) {
      console.error('[export] failed', e);
      showToast('Export failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b px-3 py-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={onBack}>
            ‹ All
          </button>
          {cat.color ? (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.color }} />
          ) : null}
          <h2 dir="auto" className="min-w-0 flex-1 truncate text-sm font-semibold">{cat.name}</h2>
          <span className="shrink-0 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
            {(links ?? []).length} verse{(links ?? []).length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          <div className="flex rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            {(['quran', 'manual'] as const).map((mode) => (
              <button
                key={mode}
                className="px-2.5 py-1 text-[11px] font-medium first:rounded-s-lg last:rounded-e-lg"
                style={
                  cat.verseSortMode === mode
                    ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                    : { color: 'var(--ink-soft)' }
                }
                onClick={() => updateCategory(cat.id, { verseSortMode: mode })}
              >
                {mode === 'quran' ? 'Quran order' : 'Manual order'}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <button className="btn btn-ghost px-2 py-1 text-[11px]" disabled={busy} onClick={() => doExport('docx')}>
            Word
          </button>
          <button className="btn btn-ghost px-2 py-1 text-[11px]" disabled={busy} onClick={() => doExport('xlsx')}>
            Excel
          </button>
        </div>

        {cat.verseSortMode === 'manual' ? (
          <p className="mt-1.5 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
            Press and hold a verse to drag it into place.
          </p>
        ) : null}
      </header>

      <div className="scroll-y flex-1 p-2">
        {subcats.length ? (
          <div className="mb-3">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
              Subcategories
            </p>
            {subcats.map((sc) => (
              <SubcategoryRow key={sc.id} cat={sc} />
            ))}
          </div>
        ) : null}

        {(links ?? []).length ? (
          <>
            {cat.verseSortMode === 'manual' ? <VerseSlot categoryId={cat.id} index={0} /> : null}
            {(links ?? []).map((link, i) => (
              <div key={link.id}>
                <VerseRow
                  link={link}
                  verse={verses.get(link.verseKey)}
                  meta={meta}
                  draggable={cat.verseSortMode === 'manual'}
                  categoryId={cat.id}
                  index={i}
                  onOpen={() => {
                    const v = verses.get(link.verseKey);
                    if (v) {
                      jumpTo(v.page);
                      setMobilePane('reader');
                    }
                  }}
                  onNote={() => openNote(link.verseKey)}
                  onRemove={async () => {
                    await removeVerseFromCategory(cat.id, link.verseKey);
                    showToast('Removed from category');
                  }}
                />
                {cat.verseSortMode === 'manual' ? (
                  <VerseSlot categoryId={cat.id} index={i + 1} />
                ) : null}
              </div>
            ))}
          </>
        ) : (
          <EmptyDrop categoryId={cat.id} />
        )}
      </div>
    </div>
  );
}

function SubcategoryRow({ cat }: { cat: Category }) {
  const { setOpenCategory } = useUI();
  const { setNodeRef, isOver } = useDroppable({
    id: `cat-drop-${cat.id}`,
    data: { type: 'category', id: cat.id },
  });
  return (
    <button
      ref={setNodeRef}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${isOver ? 'drop-active' : ''}`}
      onClick={() => setOpenCategory(cat.id)}
    >
      <span className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>
        ▤
      </span>
      <span dir="auto" className="min-w-0 flex-1 truncate text-sm">{cat.name}</span>
      <span className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>
        ›
      </span>
    </button>
  );
}

function EmptyDrop({ categoryId }: { categoryId: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cat-drop-${categoryId}-empty`,
    data: { type: 'category', id: categoryId },
  });
  return (
    <div
      ref={setNodeRef}
      className={`m-2 rounded-xl border border-dashed px-4 py-10 text-center ${isOver ? 'drop-active' : ''}`}
      style={{ borderColor: 'var(--border)' }}
    >
      <p className="text-sm font-medium">No verses yet</p>
      <p className="mx-auto mt-1 max-w-[20rem] text-xs leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
        Tap a verse in the Mushaf, then either choose <span className="whitespace-nowrap">▤ Categories</span>{' '}
        or drag it here by its handle.
      </p>
    </div>
  );
}

/**
 * The gap between two verses, as a drop target — this is what makes "in a
 * specific order" work.
 *
 * It grows to a finger-sized target while a drag is in flight. Even so, a gap is
 * a small thing to hit on a touchscreen, so each VerseRow is ALSO a drop target
 * meaning "insert before me". The gaps give precision; the rows give
 * forgiveness. Relying on the gaps alone made reordering feel broken.
 */
function VerseSlot({ categoryId, index }: { categoryId: string; index: number }) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `verse-slot-${categoryId}-${index}`,
    data: { type: 'verse-slot', categoryId, index },
  });
  const dragging = active?.data.current as { kind?: string } | undefined;
  const show = dragging?.kind === 'verse';
  return (
    <div
      ref={setNodeRef}
      className="transition-all"
      style={{
        height: show ? (isOver ? 40 : 22) : 4,
        borderRadius: 6,
        background: isOver ? 'var(--accent-soft)' : 'transparent',
        border: isOver ? '2px dashed var(--accent)' : '1px solid transparent',
      }}
    />
  );
}

function VerseRow({
  link,
  verse,
  meta,
  draggable,
  categoryId,
  index,
  onOpen,
  onNote,
  onRemove,
}: {
  link: CategoryVerse;
  verse?: Verse;
  meta: Meta;
  draggable: boolean;
  categoryId: string;
  index: number;
  onOpen: () => void;
  onNote: () => void;
  onRemove: () => void;
}) {
  const surah = verse ? meta.surahs.find((s) => s.number === verse.surah) : null;
  const note = useLiveQuery(() => getNote(link.verseKey), [link.verseKey]);

  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `cv-${link.id}`,
    data: {
      kind: 'verse',
      verseKey: link.verseKey,
      verseId: link.verseId,
      fromCategoryId: categoryId,
      linkId: link.id,
    },
    disabled: !draggable,
  });

  // "Insert before me" — a full-height target beside the thin gaps.
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `verse-row-${link.id}`,
    data: { type: 'verse-slot', categoryId, index },
    disabled: isDragging,
  });

  return (
    <div
      ref={dropRef}
      className={`group flex gap-2 rounded-lg px-2 py-2 ${isDragging ? 'dragging' : ''}`}
      style={{
        background: 'var(--surface)',
        boxShadow: isOver ? 'inset 0 3px 0 0 var(--accent)' : undefined,
      }}
    >
      {draggable ? (
        <span
          ref={setNodeRef}
          {...listeners}
          {...attributes}
          className="mt-1 cursor-grab px-1 text-[11px] opacity-30 group-hover:opacity-70 active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          title="Drag to reorder"
        >
          ⠿
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <button className="w-full text-left" onClick={onOpen}>
          <span className="flex items-baseline gap-2">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
              {surah?.nameSimple} {verse?.ayah}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--ink-soft)' }}>
              Juz {verse?.juz} · p.{verse?.page}
            </span>
          </span>
          <span
            dir="rtl"
            className="mt-0.5 line-clamp-2 block text-[15px] leading-loose"
            style={{ fontFamily: "'Scheherazade New', serif" }}
          >
            {verse?.text ?? '…'}
          </span>
        </button>

        {note && note.deletedAt === null && note.contentText.trim() ? (
          <button
            className="mt-1 line-clamp-2 w-full rounded px-2 py-1 text-left text-[11px]"
            style={{ background: 'var(--surface-2)', color: 'var(--ink-soft)' }}
            onClick={onNote}
          >
            ✎ {note.contentText}
          </button>
        ) : null}
      </div>

      <button
        className="btn btn-ghost h-7 min-h-0 shrink-0 px-1.5 text-[11px] opacity-0 transition group-hover:opacity-100"
        style={{ color: '#b4483f' }}
        title="Remove from category"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

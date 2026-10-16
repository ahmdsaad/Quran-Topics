'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useDrag } from '@/components/dnd/DragLayer';
import type { Category, CategorySpace, CategoryVerse, Meta, TranslationLanguage, Verse } from '@/lib/types';
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
import { rangeLabel } from '@/lib/mushaf/verseRange';
import CategoryTitle from './CategoryTitle';
import QuestionTitle, { QuestionLanguageSelect, type QuestionLanguage } from './QuestionTitle';

type VerseUnit = { id: string; groupId: string | null; links: CategoryVerse[] };

function groupVerseLinks(links: CategoryVerse[]): VerseUnit[] {
  const units: VerseUnit[] = [];
  const grouped = new Map<string, VerseUnit>();
  for (const link of links) {
    if (!link.groupId) {
      units.push({ id: link.id, groupId: null, links: [link] });
      continue;
    }
    const existing = grouped.get(link.groupId);
    if (existing) existing.links.push(link);
    else {
      const unit = { id: link.groupId, groupId: link.groupId, links: [link] };
      grouped.set(link.groupId, unit);
      units.push(unit);
    }
  }
  return units;
}

export default function CategoryDetail({
  meta,
  translationLanguage,
  arabicFontSize,
  translationFontSize,
  categoryId,
  onBack,
  onVerseOpen,
  selectedVerseKey,
  space = 'topics',
  questionLanguage = 'ar',
  onQuestionLanguage,
}: {
  meta: Meta;
  translationLanguage: TranslationLanguage;
  arabicFontSize: number;
  translationFontSize: number;
  categoryId: string;
  onBack: () => void;
  onVerseOpen: (verse: Verse) => void;
  selectedVerseKey?: string | null;
  space?: CategorySpace;
  questionLanguage?: QuestionLanguage;
  onQuestionLanguage?: (language: QuestionLanguage) => void;
}) {
  const ui = useUI();
  const { showToast, openNote } = ui;
  const setOpenCategory = space === 'qa' ? ui.setOpenQaCategory : ui.setOpenCategory;

  const cat = useLiveQuery(() => db().categories.get(categoryId), [categoryId]);
  const all = useLiveQuery(() => listCategories(space), [space], [] as Category[]);
  const links = useLiveQuery(
    async () => (cat ? orderedVersesInCategory(cat) : ([] as CategoryVerse[])),
    [cat?.id, cat?.verseSortMode, cat?.updatedAt],
    [] as CategoryVerse[]
  );

  const [verses, setVerses] = useState<Map<string, Verse>>(new Map());
  const [staticTranslations, setStaticTranslations] = useState<Map<string, string>>(new Map());
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

  useEffect(() => {
    let live = true;
    setStaticTranslations(new Map());
    fetch(`/data/translations/${translationLanguage}.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`translation ${response.status}`);
        return response.json() as Promise<[string, string][]>;
      })
      .then((rows) => {
        if (live) setStaticTranslations(new Map(rows));
      })
      .catch((error) => console.error('[translation] failed to load', error));
    return () => {
      live = false;
    };
  }, [translationLanguage]);

  const subcats = useMemo(
    () => (all ?? []).filter((c) => c.parentId === categoryId),
    [all, categoryId]
  );
  const verseUnits = useMemo(() => groupVerseLinks(links ?? []), [links]);

  if (!cat) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          {space === 'qa' ? 'Q/A item' : 'Topic'} not found.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b px-3 py-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={onBack}>
            ‹ All
          </button>
          <h2 className="min-w-0 flex-1 text-sm font-semibold">
            {space === 'qa' ? <QuestionTitle category={cat} language={questionLanguage} /> : <CategoryTitle category={cat} />}
          </h2>
          {space === 'qa' && onQuestionLanguage ? (
            <QuestionLanguageSelect value={questionLanguage} onChange={onQuestionLanguage} />
          ) : null}
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
              Subtopics
            </p>
            {subcats.map((sc) => (
              <SubcategoryRow key={sc.id} cat={sc} questionLanguage={space === 'qa' ? questionLanguage : null}
                onOpen={() => setOpenCategory(sc.id)} />
            ))}
          </div>
        ) : null}

        {(links ?? []).length ? (
          <>
            {cat.verseSortMode === 'manual' ? <VerseSlot categoryId={cat.id} index={0} /> : null}
            {verseUnits.map((unit, i) => (
              <div key={unit.id}>
                {unit.groupId && unit.links.length > 1 ? (
                  <VerseRangeCard
                    unit={unit}
                    verses={verses}
                    staticTranslations={staticTranslations}
                    meta={meta}
                    translationLanguage={translationLanguage}
                    arabicFontSize={arabicFontSize}
                    translationFontSize={translationFontSize}
                    draggable={cat.verseSortMode === 'manual'}
                    categoryId={cat.id}
                    index={i}
                    onOpen={(link) => {
                      const v = verses.get(link.verseKey);
                      if (v) onVerseOpen(v);
                    }}
                    selectedVerseKey={selectedVerseKey}
                    onNote={(link) => openNote(link.verseKey)}
                    onRemove={async (link) => {
                      await removeVerseFromCategory(cat.id, link.verseKey);
                      showToast('Removed from topic');
                    }}
                  />
                ) : (
                  <VerseRow
                    link={unit.links[0]}
                    verse={verses.get(unit.links[0].verseKey)}
                    translation={
                      staticTranslations.get(unit.links[0].verseKey) ??
                      verses.get(unit.links[0].verseKey)?.translations?.[translationLanguage]
                    }
                    meta={meta}
                    translationLanguage={translationLanguage}
                    arabicFontSize={arabicFontSize}
                    translationFontSize={translationFontSize}
                    draggable={cat.verseSortMode === 'manual'}
                    categoryId={cat.id}
                    index={i}
                    onOpen={() => {
                      const v = verses.get(unit.links[0].verseKey);
                      if (v) onVerseOpen(v);
                    }}
                    selected={unit.links[0].verseKey === selectedVerseKey}
                    onNote={() => openNote(unit.links[0].verseKey)}
                    onRemove={async () => {
                      await removeVerseFromCategory(cat.id, unit.links[0].verseKey);
                      showToast('Removed from topic');
                    }}
                  />
                )}
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

function SubcategoryRow({ cat, questionLanguage, onOpen }: {
  cat: Category;
  questionLanguage: QuestionLanguage | null;
  onOpen: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cat-drop-${cat.id}`,
    data: { type: 'category', id: cat.id },
  });
  return (
    <button
      ref={setNodeRef}
      className={`mb-1 flex w-full items-center gap-2 rounded-xl border px-2 py-2 text-left ${isOver ? 'drop-active' : ''}`}
      style={{ borderColor: 'var(--border)' }}
      onClick={onOpen}
    >
      <span className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>
        ▤
      </span>
      <span className="min-w-0 flex-1 text-sm">
        {questionLanguage ? <QuestionTitle category={cat} language={questionLanguage} /> : <CategoryTitle category={cat} />}
      </span>
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
        Tap a verse in the Mushaf, then either choose <span className="whitespace-nowrap">▤ Topics</span>{' '}
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

function VerseRangeCard({
  unit,
  verses,
  staticTranslations,
  meta,
  translationLanguage,
  arabicFontSize,
  translationFontSize,
  draggable,
  categoryId,
  index,
  onOpen,
  onNote,
  onRemove,
  selectedVerseKey,
}: {
  unit: VerseUnit;
  verses: Map<string, Verse>;
  staticTranslations: Map<string, string>;
  meta: Meta;
  translationLanguage: TranslationLanguage;
  arabicFontSize: number;
  translationFontSize: number;
  draggable: boolean;
  categoryId: string;
  index: number;
  onOpen: (link: CategoryVerse) => void;
  onNote: (link: CategoryVerse) => void;
  onRemove: (link: CategoryVerse) => void;
  selectedVerseKey?: string | null;
}) {
  const first = unit.links[0];
  const last = unit.links.at(-1) ?? first;
  const { enabled: dragEnabled } = useDrag();
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `cv-range-${unit.id}`,
    data: {
      kind: 'verse',
      verseKey: first.verseKey,
      verseId: first.verseId,
      fromCategoryId: categoryId,
      linkId: first.id,
      groupId: unit.groupId,
    },
    disabled: !draggable || !dragEnabled,
  });
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `verse-range-${unit.id}`,
    data: { type: 'verse-slot', categoryId, index },
    disabled: isDragging || !dragEnabled,
  });

  return (
    <div
      ref={dropRef}
      className={`overflow-hidden rounded-xl border ${isDragging ? 'dragging' : ''}`}
      style={{
        borderColor: 'var(--accent)',
        background: 'var(--surface)',
        boxShadow: isOver ? 'inset 0 3px 0 0 var(--accent)' : undefined,
      }}
    >
      <div
        className="flex items-center gap-2 border-b px-2 py-1.5"
        style={{ borderColor: 'var(--border)', background: 'var(--accent-soft)' }}
      >
        {draggable && dragEnabled ? (
          <span
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            className="cursor-grab px-1 text-[11px] opacity-60 active:cursor-grabbing"
            style={{ touchAction: 'none' }}
            title="Drag range to reorder"
          >
            ⠿
          </span>
        ) : null}
        <span
          className="min-w-0 flex-1 truncate text-[11px] font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          Range · {rangeLabel(first.verseKey, last.verseKey)}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--ink-soft)' }}>
          {unit.links.length} verses
        </span>
      </div>
      {unit.links.map((link, rowIndex) => (
        <div
          key={link.id}
          className={rowIndex > 0 ? 'border-t' : ''}
          style={{ borderColor: 'var(--border)' }}
        >
          <VerseRow
            link={link}
            verse={verses.get(link.verseKey)}
            translation={
              staticTranslations.get(link.verseKey) ??
              verses.get(link.verseKey)?.translations?.[translationLanguage]
            }
            meta={meta}
            translationLanguage={translationLanguage}
            arabicFontSize={arabicFontSize}
            translationFontSize={translationFontSize}
            draggable={false}
            dropEnabled={false}
            categoryId={categoryId}
            index={index}
            onOpen={() => onOpen(link)}
            selected={link.verseKey === selectedVerseKey}
            onNote={() => onNote(link)}
            onRemove={() => onRemove(link)}
          />
        </div>
      ))}
    </div>
  );
}

function VerseRow({
  link,
  verse,
  translation,
  meta,
  translationLanguage,
  arabicFontSize,
  translationFontSize,
  draggable,
  dropEnabled = true,
  categoryId,
  index,
  onOpen,
  onNote,
  onRemove,
  selected = false,
}: {
  link: CategoryVerse;
  verse?: Verse;
  translation?: string;
  meta: Meta;
  translationLanguage: TranslationLanguage;
  arabicFontSize: number;
  translationFontSize: number;
  draggable: boolean;
  dropEnabled?: boolean;
  categoryId: string;
  index: number;
  onOpen: () => void;
  onNote: () => void;
  onRemove: () => void;
  selected?: boolean;
}) {
  const surah = verse ? meta.surahs.find((s) => s.number === verse.surah) : null;
  const note = useLiveQuery(() => getNote(link.verseKey), [link.verseKey]);
  const { enabled: dragEnabled } = useDrag();

  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `cv-${link.id}`,
    data: {
      kind: 'verse',
      verseKey: link.verseKey,
      verseId: link.verseId,
      fromCategoryId: categoryId,
      linkId: link.id,
    },
    disabled: !draggable || !dragEnabled,
  });

  // "Insert before me" — a full-height target beside the thin gaps.
  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `verse-row-${link.id}`,
    data: { type: 'verse-slot', categoryId, index },
    disabled: isDragging || !dropEnabled || !dragEnabled,
  });

  return (
    <div
      ref={dropRef}
      className={`group flex gap-2 rounded-lg px-2 py-2 ${isDragging ? 'dragging' : ''}`}
      style={{
        background: selected ? 'var(--accent-soft)' : 'var(--surface)',
        boxShadow: isOver
          ? 'inset 0 3px 0 0 var(--accent)'
          : selected
            ? 'inset 3px 0 0 var(--accent)'
            : undefined,
      }}
      aria-current={selected ? 'true' : undefined}
    >
      {draggable && dragEnabled ? (
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
          <span className="mt-1 grid grid-cols-1 gap-2 lg:grid-cols-2 lg:gap-4" dir="ltr">
            <span
              dir="ltr"
              className="order-2 block border-t pt-2 text-left leading-normal lg:order-1 lg:border-e lg:border-t-0 lg:pe-3 lg:pt-0"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--ink-soft)',
                fontSize: translationFontSize,
              }}
            >
              <span
                className="mb-1 block text-[9px] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--accent)' }}
              >
                {translationLabel(translationLanguage)} translation
              </span>
              <span className="line-clamp-3 block">
                {translation || 'Loading translation…'}
              </span>
            </span>
            <span
              dir="rtl"
              className="order-1 line-clamp-3 block text-right leading-loose lg:order-2"
              style={{ fontFamily: "'Scheherazade New', serif", fontSize: arabicFontSize }}
            >
              {verse?.text ?? '…'}
            </span>
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
        title="Remove from topic"
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  );
}

function translationLabel(language: TranslationLanguage): string {
  return {
    en: 'English',
    ru: 'Russian',
    it: 'Italian',
    fr: 'French',
    es: 'Spanish',
  }[language];
}

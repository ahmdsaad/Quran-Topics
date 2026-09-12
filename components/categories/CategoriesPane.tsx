'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import type { Category, CategorySpace, Meta, TranslationLanguage } from '@/lib/types';
import {
  createCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  mergeCategory,
  setCategoriesExpanded,
  moveCategory,
} from '@/lib/db/repo';
import { db } from '@/lib/db/schema';
import { useUI } from '@/lib/store';
import { useDrag } from '@/components/dnd/DragLayer';
import CategoryDetail from './CategoryDetail';
import { categoryTitles } from '@/lib/categories/titles';
import CategoryTitle from './CategoryTitle';
import QuestionTitle, { QuestionLanguageSelect, type QuestionLanguage } from './QuestionTitle';

const PALETTE = ['#8a6d3b', '#4f9d69', '#4a7fb5', '#c2647a', '#8b6bb1', '#c98a3c'];
const QA_LANGUAGE_KEY = 'qc.qa-language';

export default function CategoriesPane({
  meta,
  translationLanguage,
  arabicFontSize,
  translationFontSize,
  onVerseOpen,
  selectedVerseKey,
  space = 'topics',
}: {
  meta: Meta;
  translationLanguage: TranslationLanguage;
  arabicFontSize: number;
  translationFontSize: number;
  onVerseOpen: (verse: import('@/lib/types').Verse) => void;
  selectedVerseKey?: string | null;
  space?: CategorySpace;
}) {
  const ui = useUI();
  const openCategoryId = space === 'qa' ? ui.openQaCategoryId : ui.openCategoryId;
  const setOpenCategory = space === 'qa' ? ui.setOpenQaCategory : ui.setOpenCategory;
  const paneTitle = space === 'qa' ? 'Q/A' : 'Topics';
  const itemLabel = space === 'qa' ? 'Q/A item' : 'topic';
  const cats = useLiveQuery(() => listCategories(space), [space], [] as Category[]);
  const [newArabic, setNewArabic] = useState('');
  const [newEnglish, setNewEnglish] = useState('');
  const [filter, setFilter] = useState('');
  const [navigatorView, setNavigatorView] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [mobileDevice, setMobileDevice] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [questionLanguage, setQuestionLanguage] = useState<QuestionLanguage>('ar');

  useEffect(() => {
    setNavigatorView(localStorage.getItem('category-navigator-view') === 'true');
    const query = window.matchMedia('(min-width: 1024px)');
    const pointer = window.matchMedia('(pointer: coarse)');
    const update = () => {
      setDesktop(query.matches);
      setMobileDevice(pointer.matches);
    };
    update();
    query.addEventListener('change', update);
    pointer.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
      pointer.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(QA_LANGUAGE_KEY);
    if (saved && ['ar', 'en', 'ru', 'it', 'fr', 'es'].includes(saved)) {
      setQuestionLanguage(saved as QuestionLanguage);
    }
  }, []);

  const changeQuestionLanguage = (language: QuestionLanguage) => {
    setQuestionLanguage(language);
    localStorage.setItem(QA_LANGUAGE_KEY, language);
  };

  const mobileLayout = !desktop || mobileDevice;

  const changeNavigatorView = (enabled: boolean) => {
    setNavigatorView(enabled);
    localStorage.setItem('category-navigator-view', String(enabled));
  };

  const counts = useLiveQuery(async () => {
    const rows = await db().categoryVerses.toArray();
    const m: Record<string, number> = {};
    rows.filter((r) => r.deletedAt === null).forEach((r) => {
      m[r.categoryId] = (m[r.categoryId] ?? 0) + 1;
    });
    return m;
  }, [], {} as Record<string, number>);

  const roots = useMemo(() => (cats ?? []).filter((c) => c.parentId === null), [cats]);
  const expandableCategories = useMemo(
    () => (cats ?? []).filter((category) => (cats ?? []).some((child) => child.parentId === category.id)),
    [cats]
  );
  const allExpanded = expandableCategories.length > 0 && expandableCategories.every((category) => category.isExpanded);

  const matches = (c: Category) => {
    const titles = categoryTitles(c);
    const searchableTitle = space === 'qa' ? titles.arabic : `${titles.english} ${titles.arabic}`;
    return !filter.trim() || searchableTitle.toLowerCase().includes(filter.trim().toLowerCase());
  };

  const addRoot = async () => {
    if (space === 'qa' ? !newArabic.trim() : (!newArabic.trim() && !newEnglish.trim())) return;
    await createCategory(
      newArabic,
      null,
      PALETTE[(cats ?? []).length % PALETTE.length],
      newEnglish,
      space
    );
    setNewArabic('');
    setNewEnglish('');
  };

  const categoryTree = (
    <>
      {(cats ?? []).length > 8 ? (
        <div className="shrink-0 px-3 pt-3">
          <input
            className="field"
            dir="auto"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      ) : null}
      <div className="scroll-y flex-1 p-2">
        {roots.length ? (
          roots.map((c, i) => (
            <TreeNode key={c.id} cat={c} all={cats ?? []} counts={counts ?? {}} depth={0}
              index={i} filter={filter} matches={matches} editMode={editMode}
              mobileLayout={mobileLayout} space={space} questionLanguage={questionLanguage} />
          ))
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">No {space === 'qa' ? 'Q/A items' : 'topics'} yet</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-soft)' }}>Create one below.</p>
          </div>
        )}
        <RootDropZone />
      </div>
      <footer className="flex shrink-0 gap-2 border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
        <div className={`grid min-w-0 flex-1 gap-2 ${space === 'qa' ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {space !== 'qa' ? (
            <input className="field" dir="ltr" placeholder="English title…" value={newEnglish}
              onChange={(e) => setNewEnglish(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRoot()} />
          ) : null}
          <input className="field text-right" dir="rtl" lang="ar" placeholder="العنوان بالعربية…" value={newArabic}
            onChange={(e) => setNewArabic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRoot()} />
        </div>
        <button className="btn btn-primary shrink-0" disabled={space === 'qa' ? !newArabic.trim() : (!newArabic.trim() && !newEnglish.trim())} onClick={addRoot}>
          Add
        </button>
      </footer>
    </>
  );

  const navigatorViewActive = navigatorView && desktop && !mobileDevice;

  if (openCategoryId && !navigatorViewActive) {
    return (
      <CategoryDetail meta={meta} translationLanguage={translationLanguage}
        arabicFontSize={arabicFontSize}
        translationFontSize={translationFontSize} categoryId={openCategoryId}
        onVerseOpen={onVerseOpen}
        selectedVerseKey={selectedVerseKey} space={space}
        questionLanguage={questionLanguage}
        onQuestionLanguage={changeQuestionLanguage}
        onBack={() => setOpenCategory(null)} />
    );
  }

  if (navigatorViewActive) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2"
          style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold">{paneTitle}</h2>
          <div className="flex items-center gap-1">
            {space === 'qa' ? (
              <QuestionLanguageSelect value={questionLanguage} onChange={changeQuestionLanguage} />
            ) : null}
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => changeNavigatorView(false)}>
              Single view
            </button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[38%] min-w-[230px] flex-col border-r" style={{ borderColor: 'var(--border)' }}
            aria-label="Topic navigator">
            {categoryTree}
          </nav>
          <section className="min-w-0 flex-1">
            {openCategoryId ? (
              <CategoryDetail meta={meta} translationLanguage={translationLanguage}
                arabicFontSize={arabicFontSize}
                translationFontSize={translationFontSize} categoryId={openCategoryId}
                onVerseOpen={onVerseOpen}
                selectedVerseKey={selectedVerseKey} space={space}
                questionLanguage={questionLanguage}
                onQuestionLanguage={changeQuestionLanguage}
                onBack={() => setOpenCategory(null)} />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm"
                style={{ color: 'var(--ink-soft)' }}>
                Select a {itemLabel} to view its Arabic verses and translation.
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <h2 className="text-sm font-semibold">{paneTitle}</h2>
        <div className="flex items-center gap-1">
          {space === 'qa' ? (
            <QuestionLanguageSelect value={questionLanguage} onChange={changeQuestionLanguage} />
          ) : null}
          {!mobileLayout ? (
            <button
              className="btn btn-ghost px-2 py-1 text-xs"
              title="Keep topics visible while reading their verses"
              onClick={() => changeNavigatorView(true)}
            >
              Navigator view
            </button>
          ) : null}
          <button
            className="btn btn-ghost px-2 py-1 text-xs"
            title={allExpanded ? 'Collapse all' : 'Expand all'}
            disabled={!expandableCategories.length}
            onClick={() => setCategoriesExpanded(expandableCategories.map((category) => category.id), !allExpanded)}
          >
            <span className="lg:hidden">{allExpanded ? 'Collapse' : 'Expand'}</span>
            <span className="hidden lg:inline">{allExpanded ? 'Collapse all' : 'Expand all'}</span>
          </button>
          {mobileLayout ? (
            <button
              className="btn btn-ghost px-2 py-1 text-xs"
              style={editMode ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
              aria-pressed={editMode}
              onClick={() => setEditMode((enabled) => !enabled)}
            >
              {editMode ? 'Done' : 'Edit'}
            </button>
          ) : null}
        </div>
      </header>

      {(cats ?? []).length > 8 ? (
        <div className="shrink-0 px-3 pt-3">
          <input
            className="field"
            dir="auto"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      ) : null}

      <div className="scroll-y flex-1 p-2">
        {roots.length ? (
          roots.map((c, i) => (
            <TreeNode
              key={c.id}
              cat={c}
              all={cats ?? []}
              counts={counts ?? {}}
              depth={0}
              index={i}
              filter={filter}
              matches={matches}
              editMode={editMode}
              mobileLayout={mobileLayout}
              space={space}
              questionLanguage={questionLanguage}
            />
          ))
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">No {space === 'qa' ? 'Q/A items' : 'topics'} yet</p>
            <p className="mx-auto mt-1 max-w-[22rem] text-xs leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
              Create one below, then tap any verse in the Mushaf and choose{' '}
              <span className="whitespace-nowrap">{space === 'qa' ? '? Q/A' : '▤ Topics'}</span> to file it. Items nest as
              deep as you like.
            </p>
          </div>
        )}
        <RootDropZone />
      </div>

      <footer
        className="flex shrink-0 gap-2 border-t px-3 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className={`grid min-w-0 flex-1 gap-2 ${space === 'qa' ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {space !== 'qa' ? (
            <input className="field" dir="ltr" placeholder="English title…" value={newEnglish}
              onChange={(e) => setNewEnglish(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRoot()} />
          ) : null}
          <input className="field text-right" dir="rtl" lang="ar" placeholder="العنوان بالعربية…" value={newArabic}
            onChange={(e) => setNewArabic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addRoot()} />
        </div>
        <button
          className="btn btn-primary shrink-0"
          disabled={space === 'qa' ? !newArabic.trim() : (!newArabic.trim() && !newEnglish.trim())}
          onClick={addRoot}
        >
          Add
        </button>
      </footer>
    </div>
  );
}

/** True when `id` sits anywhere inside the subtree rooted at `ancestorId`. */
function isUnder(all: Category[], id: string, ancestorId: string): boolean {
  const byId = new Map(all.map((c) => [c.id, c]));
  let cur = byId.get(id)?.parentId ?? null;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

/**
 * Dropping here moves a category back to the top level.
 *
 * It lives BELOW the tree, not above it. Rendered above, it appears the moment a
 * drag starts and pushes every row down by its own height — mid-gesture, while
 * the user is already aiming at a row. The drop then lands on whatever slid into
 * place. Anything that appears during a drag has to appear where it cannot move
 * the targets.
 */
function RootDropZone() {
  const { setNodeRef, isOver, active } = useDroppable({
    id: 'category-root',
    data: { type: 'category-slot', parentId: null, index: 0 },
  });
  const dragging = active?.data.current as { kind?: string } | undefined;
  if (dragging?.kind !== 'category') return null;
  return (
    <div
      ref={setNodeRef}
      className={`mt-2 rounded-lg border border-dashed px-3 py-3 text-center text-[11px] ${
        isOver ? 'drop-active' : ''
      }`}
      style={{ borderColor: 'var(--border)', color: 'var(--ink-soft)' }}
    >
      Drop here to move to the top level
    </div>
  );
}

function TreeNode({
  cat,
  all,
  counts,
  depth,
  index,
  filter,
  matches,
  editMode,
  mobileLayout,
  space,
  questionLanguage,
}: {
  cat: Category;
  all: Category[];
  counts: Record<string, number>;
  depth: number;
  index: number;
  filter: string;
  matches: (c: Category) => boolean;
  editMode: boolean;
  mobileLayout: boolean;
  space: CategorySpace;
  questionLanguage: QuestionLanguage;
}) {
  const ui = useUI();
  const openCategoryId = space === 'qa' ? ui.openQaCategoryId : ui.openCategoryId;
  const setOpenCategory = space === 'qa' ? ui.setOpenQaCategory : ui.setOpenCategory;
  const [renaming, setRenaming] = useState(false);
  const titles = categoryTitles(cat);
  const [draftArabic, setDraftArabic] = useState(titles.arabic);
  const [draftEnglish, setDraftEnglish] = useState(titles.english);
  const [addingChild, setAddingChild] = useState(false);
  const [moving, setMoving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [childArabic, setChildArabic] = useState('');
  const [childEnglish, setChildEnglish] = useState('');
  const previousEditMode = useRef(editMode);
  const displayTitle = space === 'qa' ? (titles.arabic || cat.name) : titles.combined;

  const saveRename = async () => {
    const valid = space === 'qa'
      ? Boolean(draftArabic.trim())
      : Boolean(draftArabic.trim() || draftEnglish.trim());
    if (!valid) {
      setDraftArabic(titles.arabic);
      setDraftEnglish(titles.english);
      setRenaming(false);
      return;
    }
    await updateCategory(cat.id, {
      name: draftArabic.trim() || draftEnglish.trim(),
      nameArabic: draftArabic.trim(),
      nameEnglish: draftEnglish.trim(),
    });
    setRenaming(false);
  };

  useEffect(() => {
    const wasEditing = previousEditMode.current;
    previousEditMode.current = editMode;
    if (!wasEditing || editMode) return;

    // The pane-level Done button is also the commit action for whichever row
    // editor is open. Close other temporary edit panels at the same time so
    // leaving edit mode always returns to a clean list.
    setMoving(false);
    setMerging(false);
    setMergeTargetId('');
    setAddingChild(false);
    setChildArabic('');
    setChildEnglish('');
    if (renaming) {
      void saveRename().catch(() => ui.showToast('The title could not be updated'));
    }
    // This effect intentionally responds only to the edit-mode transition;
    // the current drafts are captured by the render in which Done was pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  const children = all.filter((c) => c.parentId === cat.id);
  const availableParents = all.filter((candidate) =>
    candidate.id !== cat.id && !isUnder(all, candidate.id, cat.id)
  );
  const availableMergeTargets = space === 'topics'
    ? all.filter((candidate) => candidate.id !== cat.id && !isUnder(all, candidate.id, cat.id))
    : [];
  const descendantMatches = (c: Category): boolean =>
    matches(c) || all.filter((x) => x.parentId === c.id).some(descendantMatches);

  // A category cannot be dropped into itself or into its own descendants, so
  // those rows stop being drop targets for the duration of the drag. Disabling
  // them (rather than rejecting the drop afterwards) means the invalid target
  // never lights up, so the gesture reads correctly while it is happening.
  const { draggingCategoryId, enabled: dragEnabled } = useDrag();
  const insideDraggedSubtree =
    !!draggingCategoryId &&
    (cat.id === draggingCategoryId || isUnder(all, cat.id, draggingCategoryId));

  const { setNodeRef: dropRef, isOver } = useDroppable({
    id: `cat-drop-${cat.id}`,
    data: { type: 'category', id: cat.id },
    disabled: insideDraggedSubtree,
  });

  const {
    setNodeRef: dragRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({
    id: `cat-drag-${cat.id}`,
    data: { kind: 'category', id: cat.id, name: displayTitle },
    disabled: !dragEnabled,
  });

  if (filter.trim() && !descendantMatches(cat)) return null;

  const count = counts[cat.id] ?? 0;
  const total = count + children.reduce((a, c) => a + (counts[c.id] ?? 0), 0);
  const selected = openCategoryId === cat.id;

  return (
    <div>
      <div
        ref={dropRef}
        className={`group mx-1 mb-1 flex items-center gap-1 rounded-xl border px-1 ${mobileLayout ? 'flex-wrap' : ''} ${isOver ? 'drop-active' : ''} ${
          isDragging ? 'dragging' : ''
        }`}
        style={{
          paddingInlineStart: depth * 14,
          background: selected ? 'var(--accent-soft)' : undefined,
          boxShadow: selected ? 'inset 3px 0 0 var(--accent)' : undefined,
          borderColor: selected ? 'var(--accent)' : 'var(--border)',
        }}
        aria-current={selected ? 'page' : undefined}
      >
        {!mobileLayout ? (
          <button
            className="btn btn-ghost h-8 min-h-0 w-6 shrink-0 px-0 text-[10px]"
            onClick={() => setCategoriesExpanded([cat.id], !cat.isExpanded)}
            aria-label={cat.isExpanded ? 'Collapse' : 'Expand'}
            style={{ visibility: children.length ? 'visible' : 'hidden' }}
          >
            {cat.isExpanded ? '▾' : '▸'}
          </button>
        ) : null}

        {dragEnabled ? <span
          ref={dragRef}
          {...listeners}
          {...attributes}
          className={`shrink-0 cursor-grab active:cursor-grabbing ${
            mobileLayout
              ? 'flex h-11 w-11 items-center justify-center rounded-lg text-xl opacity-60 active:bg-[var(--accent-soft)]'
              : 'px-1 text-[11px] opacity-30 group-hover:opacity-70'
          }`}
          style={{ touchAction: 'none' }}
          title="Drag to reorder or nest"
          aria-label="Drag to reorder or nest"
        >
          ⠿
        </span> : null}

        {renaming ? (
          <BilingualTitleEditor
            arabic={draftArabic}
            english={draftEnglish}
            arabicOnly={space === 'qa'}
            onArabic={setDraftArabic}
            onEnglish={setDraftEnglish}
            onCancel={() => {
              setDraftArabic(titles.arabic);
              setDraftEnglish(titles.english);
              setRenaming(false);
            }}
            onSave={() => { void saveRename(); }}
          />
        ) : (
          <button
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm"
            onClick={() => setOpenCategory(cat.id)}
            onDoubleClick={() => setRenaming(true)}
          >
            <span className="min-w-0 flex-1 truncate">
              {space === 'qa' ? (
                <QuestionTitle category={cat} language={questionLanguage}
                  countLabel={total ? `(${count}${children.length && total !== count ? ` / ${total}` : ''})` : undefined} />
              ) : (
                <CategoryTitle category={cat}
                  countLabel={total ? `(${count}${children.length && total !== count ? ` / ${total}` : ''})` : undefined} />
              )}
            </span>
          </button>
        )}

        <div
          className={`${mobileLayout
            ? `${editMode ? 'flex' : 'hidden'} basis-full justify-end gap-1 border-t px-1 py-1`
            : 'flex opacity-0 transition group-hover:opacity-100 focus-within:opacity-100'} shrink-0 items-center`}
          style={mobileLayout ? { borderColor: 'var(--border)' } : undefined}
        >
            {mobileLayout ? (
              <>
                <button className="btn btn-ghost h-9 min-h-0 px-1.5 text-[11px]" title="Move to another level"
                  aria-label="Move to another level" onClick={() => setMoving((open) => !open)}>
                Move
              </button>
            </>
          ) : null}
          <button
            className="btn btn-ghost h-8 min-h-0 px-1.5 text-[11px]"
            title="Add subtopic"
            onClick={() => {
              setAddingChild(true);
              setCategoriesExpanded([cat.id], true);
            }}
          >
            ＋
          </button>
          <button
            className="btn btn-ghost h-8 min-h-0 px-1.5 text-[11px]"
            title="Rename"
            onClick={() => setRenaming(true)}
          >
            ✎
          </button>
          {space === 'topics' ? (
            <button
              className="btn btn-ghost h-8 min-h-0 px-1.5 text-[11px]"
              title="Merge into another topic"
              onClick={() => {
                setMerging((open) => !open);
                setMoving(false);
              }}
            >
              <span className="lg:hidden">Merge</span>
              <span className="hidden lg:inline">⇄</span>
            </button>
          ) : null}
          <button
            className="btn btn-ghost h-8 min-h-0 px-1.5 text-[11px]"
            title="Delete"
            style={{ color: '#b4483f' }}
            onClick={() => {
              const msg = children.length
                ? `Delete “${displayTitle}” and its ${children.length} subtopic${
                    children.length === 1 ? '' : 's'
                  }?`
                : `Delete “${displayTitle}”?`;
              if (confirm(msg)) deleteCategory(cat.id);
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {moving ? (
        <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border p-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <span className="shrink-0 text-xs font-medium">Move to</span>
          <select className="field h-9 min-h-0 min-w-0 flex-1 py-0 text-sm"
            value={cat.parentId ?? ''}
            onChange={async (event) => {
              const parentId = event.target.value || null;
              if (parentId === cat.parentId) return;
              const targetSiblings = all.filter((candidate) => candidate.parentId === parentId && candidate.id !== cat.id);
              await moveCategory(cat.id, parentId, targetSiblings.length);
              setMoving(false);
              ui.showToast(parentId ? 'Moved to selected parent' : 'Moved to top level');
            }}>
            <option value="">Top level</option>
            {availableParents.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{categoryTitles(candidate).combined}</option>
            ))}
          </select>
          <button className="btn btn-ghost h-9 min-h-0 px-2 text-xs" onClick={() => setMoving(false)}>Cancel</button>
        </div>
      ) : null}

      {merging && space === 'topics' ? (
        <div className="mx-2 mb-2 rounded-lg border p-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="mb-2 text-xs" style={{ color: 'var(--ink-soft)' }}>
            Choose the topic name to keep. Verses and subtopics from “{displayTitle}” will move into it.
          </p>
          <div className="flex items-center gap-2">
            <select
              className="field h-9 min-h-0 min-w-0 flex-1 py-0 text-sm"
              value={mergeTargetId}
              onChange={(event) => setMergeTargetId(event.target.value)}
            >
              <option value="">Keep topic…</option>
              {availableMergeTargets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{categoryTitles(candidate).combined}</option>
              ))}
            </select>
            <button
              className="btn btn-primary h-9 min-h-0 px-3 text-xs"
              disabled={!mergeTargetId}
              onClick={async () => {
                const target = all.find((candidate) => candidate.id === mergeTargetId);
                if (!target) return;
                const targetTitle = categoryTitles(target).combined;
                if (!confirm(`Keep “${targetTitle}” and merge “${displayTitle}” into it?`)) return;
                try {
                  const result = await mergeCategory(cat.id, target.id);
                  setMerging(false);
                  setMergeTargetId('');
                  setOpenCategory(target.id);
                  ui.showToast(
                    `Merged into “${targetTitle}” · ${result.moved} moved${result.duplicates ? `, ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} removed` : ''}`
                  );
                } catch (error) {
                  console.error(error);
                  ui.showToast('The topics could not be merged');
                }
              }}
            >
              Merge
            </button>
            <button className="btn btn-ghost h-9 min-h-0 px-2 text-xs"
              onClick={() => { setMerging(false); setMergeTargetId(''); }}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {addingChild ? (
        <div className="flex gap-1 py-1" style={{ paddingInlineStart: (depth + 1) * 14 + 24 }}>
          <BilingualTitleEditor
            arabic={childArabic} english={childEnglish} onArabic={setChildArabic} onEnglish={setChildEnglish}
            arabicOnly={space === 'qa'}
            placeholders onCancel={() => { setAddingChild(false); setChildArabic(''); setChildEnglish(''); }}
            onSave={async () => {
              if (space === 'qa' ? !childArabic.trim() : (!childArabic.trim() && !childEnglish.trim())) return;
              await createCategory(childArabic, cat.id, cat.color, childEnglish, space);
              setChildArabic(''); setChildEnglish(''); setAddingChild(false);
            }}
          />
        </div>
      ) : null}

      {cat.isExpanded || filter.trim()
        ? children.map((c, i) => (
            <TreeNode
              key={c.id}
              cat={c}
              all={all}
              counts={counts}
              depth={depth + 1}
              index={i}
              filter={filter}
              matches={matches}
              editMode={editMode}
              mobileLayout={mobileLayout}
              space={space}
              questionLanguage={questionLanguage}
            />
          ))
        : null}
    </div>
  );
}

function BilingualTitleEditor({ arabic, english, onArabic, onEnglish, onSave, onCancel, placeholders = false, arabicOnly = false }: {
  arabic: string; english: string; onArabic: (value: string) => void; onEnglish: (value: string) => void;
  onSave: () => void; onCancel: () => void; placeholders?: boolean; arabicOnly?: boolean;
}) {
  const keyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSave();
    if (e.key === 'Escape') onCancel();
  };
  return (
    <span className={`grid min-w-0 flex-1 gap-1 ${arabicOnly ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {!arabicOnly ? (
        <input className="field h-8 min-h-0 py-0 text-sm" dir="ltr" lang="en" autoFocus
          placeholder={placeholders ? 'English title…' : undefined} value={english} onChange={(e) => onEnglish(e.target.value)} onKeyDown={keyDown} />
      ) : null}
      <input className="field h-8 min-h-0 py-0 text-right text-sm" dir="rtl" lang="ar"
        autoFocus={arabicOnly}
        placeholder={placeholders ? 'العنوان بالعربية…' : undefined} value={arabic} onChange={(e) => onArabic(e.target.value)} onKeyDown={keyDown} />
    </span>
  );
}

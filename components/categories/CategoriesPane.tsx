'use client';

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import type { Category, Meta } from '@/lib/types';
import {
  createCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  setCategoriesExpanded,
} from '@/lib/db/repo';
import { db } from '@/lib/db/schema';
import { useUI } from '@/lib/store';
import { useDrag } from '@/components/dnd/DragLayer';
import CategoryDetail from './CategoryDetail';

const PALETTE = ['#8a6d3b', '#4f9d69', '#4a7fb5', '#c2647a', '#8b6bb1', '#c98a3c'];

export default function CategoriesPane({ meta }: { meta: Meta }) {
  const { openCategoryId, setOpenCategory } = useUI();
  const cats = useLiveQuery(() => listCategories(), [], [] as Category[]);
  const [newName, setNewName] = useState('');
  const [filter, setFilter] = useState('');

  const counts = useLiveQuery(async () => {
    const rows = await db().categoryVerses.toArray();
    const m: Record<string, number> = {};
    rows.filter((r) => r.deletedAt === null).forEach((r) => {
      m[r.categoryId] = (m[r.categoryId] ?? 0) + 1;
    });
    return m;
  }, [], {} as Record<string, number>);

  const roots = useMemo(() => (cats ?? []).filter((c) => c.parentId === null), [cats]);

  if (openCategoryId) {
    return (
      <CategoryDetail
        meta={meta}
        categoryId={openCategoryId}
        onBack={() => setOpenCategory(null)}
      />
    );
  }

  const matches = (c: Category) =>
    !filter.trim() || c.name.toLowerCase().includes(filter.trim().toLowerCase());

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <h2 className="text-sm font-semibold">Categories</h2>
        <div className="flex items-center gap-1">
          <button
            className="btn btn-ghost px-2 py-1 text-xs"
            title="Expand all"
            onClick={() => setCategoriesExpanded((cats ?? []).map((c) => c.id), true)}
          >
            Expand all
          </button>
          <button
            className="btn btn-ghost px-2 py-1 text-xs"
            title="Collapse all"
            onClick={() => setCategoriesExpanded((cats ?? []).map((c) => c.id), false)}
          >
            Collapse all
          </button>
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
            />
          ))
        ) : (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium">No categories yet</p>
            <p className="mx-auto mt-1 max-w-[22rem] text-xs leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
              Create one below, then tap any verse in the Mushaf and choose{' '}
              <span className="whitespace-nowrap">▤ Categories</span> to file it. Categories nest as
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
        <input
          className="field"
          dir="auto"
          placeholder="New category…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key !== 'Enter' || !newName.trim()) return;
            await createCategory(newName.trim(), null, PALETTE[(cats ?? []).length % PALETTE.length]);
            setNewName('');
          }}
        />
        <button
          className="btn btn-primary shrink-0"
          disabled={!newName.trim()}
          onClick={async () => {
            await createCategory(newName.trim(), null, PALETTE[(cats ?? []).length % PALETTE.length]);
            setNewName('');
          }}
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
}: {
  cat: Category;
  all: Category[];
  counts: Record<string, number>;
  depth: number;
  index: number;
  filter: string;
  matches: (c: Category) => boolean;
}) {
  const { setOpenCategory } = useUI();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(cat.name);
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState('');

  const children = all.filter((c) => c.parentId === cat.id);
  const descendantMatches = (c: Category): boolean =>
    matches(c) || all.filter((x) => x.parentId === c.id).some(descendantMatches);

  // A category cannot be dropped into itself or into its own descendants, so
  // those rows stop being drop targets for the duration of the drag. Disabling
  // them (rather than rejecting the drop afterwards) means the invalid target
  // never lights up, so the gesture reads correctly while it is happening.
  const { draggingCategoryId } = useDrag();
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
    data: { kind: 'category', id: cat.id, name: cat.name },
  });

  if (filter.trim() && !descendantMatches(cat)) return null;

  const count = counts[cat.id] ?? 0;
  const total = count + children.reduce((a, c) => a + (counts[c.id] ?? 0), 0);

  return (
    <div>
      <div
        ref={dropRef}
        className={`group flex items-center gap-1 rounded-lg ${isOver ? 'drop-active' : ''} ${
          isDragging ? 'dragging' : ''
        }`}
        style={{ paddingInlineStart: depth * 14 }}
      >
        <button
          className="btn btn-ghost h-8 min-h-0 w-6 shrink-0 px-0 text-[10px]"
          onClick={() => setCategoriesExpanded([cat.id], !cat.isExpanded)}
          aria-label={cat.isExpanded ? 'Collapse' : 'Expand'}
          style={{ visibility: children.length ? 'visible' : 'hidden' }}
        >
          {cat.isExpanded ? '▾' : '▸'}
        </button>

        <span
          ref={dragRef}
          {...listeners}
          {...attributes}
          className="shrink-0 cursor-grab px-1 text-[11px] opacity-30 group-hover:opacity-70 active:cursor-grabbing"
          style={{ touchAction: 'none' }}
          title="Drag to reorder or nest"
        >
          ⠿
        </span>

        {cat.color ? (
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: cat.color }} />
        ) : null}

        {renaming ? (
          <input
            className="field h-8 min-h-0 py-0 text-sm"
            dir="auto"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft.trim() && draft !== cat.name) updateCategory(cat.id, { name: draft.trim() });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setDraft(cat.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            className="min-w-0 flex-1 truncate py-1.5 text-left text-sm"
            onClick={() => setOpenCategory(cat.id)}
            onDoubleClick={() => setRenaming(true)}
          >
            {/* dir="auto" per name: an Arabic name needs an RTL base direction so
                its digits, brackets and punctuation resolve on the correct side.
                It sits on the name alone so the count below keeps the row's own
                direction. Truncation stays on the button, which is the block. */}
            <span dir="auto">{cat.name}</span>
            {total ? (
              <span className="ms-2 text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                {count}
                {children.length && total !== count ? ` (${total})` : ''}
              </span>
            ) : null}
          </button>
        )}

        <div className="flex shrink-0 items-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <button
            className="btn btn-ghost h-8 min-h-0 px-1.5 text-[11px]"
            title="Add subcategory"
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
          <button
            className="btn btn-ghost h-8 min-h-0 px-1.5 text-[11px]"
            title="Delete"
            style={{ color: '#b4483f' }}
            onClick={() => {
              const msg = children.length
                ? `Delete “${cat.name}” and its ${children.length} subcategor${
                    children.length === 1 ? 'y' : 'ies'
                  }?`
                : `Delete “${cat.name}”?`;
              if (confirm(msg)) deleteCategory(cat.id);
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {addingChild ? (
        <div className="flex gap-1 py-1" style={{ paddingInlineStart: (depth + 1) * 14 + 24 }}>
          <input
            className="field h-8 min-h-0 py-0 text-sm"
            dir="auto"
            autoFocus
            placeholder="Subcategory name…"
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Escape') {
                setAddingChild(false);
                setChildName('');
              }
              if (e.key === 'Enter' && childName.trim()) {
                await createCategory(childName.trim(), cat.id, cat.color);
                setChildName('');
                setAddingChild(false);
              }
            }}
            onBlur={() => {
              setAddingChild(false);
              setChildName('');
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
            />
          ))
        : null}
    </div>
  );
}

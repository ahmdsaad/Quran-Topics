'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Meta } from '@/lib/types';
import {
  addVerseToCategory,
  moveCategory,
  listCategories,
  reorderVerseInCategory,
  removeVerseFromCategory,
} from '@/lib/db/repo';
import { useUI } from '@/lib/store';

export type DragPayload =
  | { kind: 'verse'; verseKey: string; verseId: number; fromCategoryId?: string; linkId?: string }
  | { kind: 'category'; id: string; name: string };

interface Ctx {
  active: DragPayload | null;
  /** Category currently being dragged, if any — used to disable invalid drops. */
  draggingCategoryId: string | null;
}
const DragCtx = createContext<Ctx>({ active: null, draggingCategoryId: null });
export const useDrag = () => useContext(DragCtx);

/**
 * One DndContext for the whole app.
 *
 * The activation constraint is the load-bearing detail on a tablet: without a
 * press delay, every attempt to scroll a list starts a drag instead. 200ms/8px
 * is the threshold that lets a flick scroll and a deliberate press drag.
 */
export default function DragLayer({
  meta,
  children,
}: {
  meta: Meta;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<DragPayload | null>(null);
  const showToast = useUI((s) => s.showToast);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  /**
   * Whatever is under the finger wins; fall back to nearest only once the
   * pointer leaves every target.
   *
   * `closestCenter` alone is wrong for a category tree. Rows are ~32px apart and
   * each row is both a drag source and a drop target, so the centre of a row
   * being dragged stays closer to ITSELF than to the neighbour it was dropped
   * on — the drop resolves to the dragged node and silently does nothing. That
   * failure is invisible: no error, no toast, the tree just doesn't change.
   */
  const collisionDetection: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length ? hits : closestCenter(args);
  };

  const onDragStart = (e: DragStartEvent) => {
    setActive((e.active.data.current as DragPayload) ?? null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const payload = e.active.data.current as DragPayload | undefined;
    const over = e.over?.data.current as
      | { type: 'category'; id: string }
      | { type: 'verse-slot'; categoryId: string; index: number }
      | { type: 'category-slot'; parentId: string | null; index: number }
      | undefined;
    setActive(null);
    if (!payload || !over) return;

    try {
      if (payload.kind === 'verse') {
        if (over.type === 'category') {
          if (payload.fromCategoryId && payload.fromCategoryId !== over.id) {
            await removeVerseFromCategory(payload.fromCategoryId, payload.verseKey);
          }
          await addVerseToCategory(over.id, payload.verseKey, payload.verseId);
          showToast(`${payload.verseKey} added`);
        } else if (over.type === 'verse-slot') {
          if (payload.fromCategoryId === over.categoryId && payload.linkId) {
            await reorderVerseInCategory(over.categoryId, payload.linkId, over.index);
          } else {
            if (payload.fromCategoryId) {
              await removeVerseFromCategory(payload.fromCategoryId, payload.verseKey);
            }
            await addVerseToCategory(
              over.categoryId,
              payload.verseKey,
              payload.verseId,
              over.index
            );
            showToast(`${payload.verseKey} added`);
          }
        }
        return;
      }

      if (payload.kind === 'category') {
        if (over.type === 'category') {
          if (over.id === payload.id) return;
          const all = await listCategories();
          const kids = all.filter((c) => c.parentId === over.id);
          await moveCategory(payload.id, over.id, kids.length);
        } else if (over.type === 'category-slot') {
          await moveCategory(payload.id, over.parentId, over.index);
        }
      }
    } catch (err) {
      console.error(err);
      showToast('That move could not be completed');
    }
  };

  const ctx = useMemo(
    () => ({
      active,
      draggingCategoryId: active?.kind === 'category' ? active.id : null,
    }),
    [active]
  );

  return (
    <DragCtx.Provider value={ctx}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActive(null)}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          {active ? (
            <div className="drag-overlay">
              {active.kind === 'verse' ? (
                <span>
                  <strong>{active.verseKey}</strong>
                  <span style={{ color: 'var(--ink-soft)' }}> · drop on a category</span>
                </span>
              ) : (
                <span>▤ {active.name}</span>
              )}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </DragCtx.Provider>
  );
}

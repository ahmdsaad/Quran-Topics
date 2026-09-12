'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
  getVerseByKey,
  moveCategory,
  listCategories,
  reorderVerseUnitInCategory,
  removeVerseFromCategory,
} from '@/lib/db/repo';
import { useUI } from '@/lib/store';

export type DragPayload =
  | {
      kind: 'verse';
      verseKey: string;
      verseId?: number;
      fromCategoryId?: string;
      linkId?: string;
      groupId?: string | null;
    }
  | { kind: 'category'; id: string; name: string };

interface Ctx {
  active: DragPayload | null;
  /** Dragging is intentionally desktop-only; touch devices use explicit actions. */
  enabled: boolean;
  /** Category currently being dragged, if any — used to disable invalid drops. */
  draggingCategoryId: string | null;
}
const DragCtx = createContext<Ctx>({ active: null, enabled: false, draggingCategoryId: null });
export const useDrag = () => useContext(DragCtx);

/**
 * One DndContext for the whole app.
 *
 * Dragging is enabled only for a desktop-class pointer. Touch layouts use
 * explicit Move controls and long-press range selection instead, avoiding
 * accidental drops while reading or scrolling.
 */
export default function DragLayer({
  meta,
  children,
}: {
  meta: Meta;
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<DragPayload | null>(null);
  const [desktopDragEnabled, setDesktopDragEnabled] = useState(false);
  const showToast = useUI((s) => s.showToast);

  useEffect(() => {
    const desktopPointer = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
    const update = () => {
      setDesktopDragEnabled(desktopPointer.matches);
      if (!desktopPointer.matches) setActive(null);
    };
    update();
    desktopPointer.addEventListener('change', update);
    return () => desktopPointer.removeEventListener('change', update);
  }, []);

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
    if (!desktopDragEnabled) return;
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
        const verseId = payload.verseId ?? (await getVerseByKey(payload.verseKey))?.id;
        if (verseId === undefined) throw new Error(`Verse ${payload.verseKey} was not found`);
        if (over.type === 'category') {
          if (payload.fromCategoryId && payload.fromCategoryId !== over.id) {
            await removeVerseFromCategory(payload.fromCategoryId, payload.verseKey);
          }
          await addVerseToCategory(over.id, payload.verseKey, verseId);
          showToast(`${payload.verseKey} added`);
        } else if (over.type === 'verse-slot') {
          if (payload.fromCategoryId === over.categoryId && payload.linkId) {
            await reorderVerseUnitInCategory(
              over.categoryId,
              payload.linkId,
              payload.groupId ?? null,
              over.index
            );
          } else {
            if (payload.fromCategoryId) {
              await removeVerseFromCategory(payload.fromCategoryId, payload.verseKey);
            }
            await addVerseToCategory(
              over.categoryId,
              payload.verseKey,
              verseId,
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
          const all = await listCategories('all');
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
      enabled: desktopDragEnabled,
      draggingCategoryId: active?.kind === 'category' ? active.id : null,
    }),
    [active, desktopDragEnabled]
  );

  return (
    <DragCtx.Provider value={ctx}>
      <DndContext
        sensors={desktopDragEnabled ? sensors : []}
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
                  <span style={{ color: 'var(--ink-soft)' }}> · drop on a topic</span>
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

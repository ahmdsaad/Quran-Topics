'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDraggable } from '@dnd-kit/core';
import type { Bookmark, Category, Meta, Verse } from '@/lib/types';
import { BOOKMARK_COLORS } from '@/lib/types';
import {
  addBookmark,
  bookmarksForVerse,
  categoriesForVerse,
  getNote,
  getVerseByKey,
  listCategories,
  removeBookmark,
} from '@/lib/db/repo';
import { useUI } from '@/lib/store';

export default function VerseActionSheet({ meta }: { meta: Meta }) {
  const { activeVerse, actionAnchor, closeVerse, openNote, openAssign, showToast, startRange } =
    useUI();
  const [verse, setVerse] = useState<Verse | null>(null);

  useEffect(() => {
    if (!activeVerse) {
      setVerse(null);
      return;
    }
    let live = true;
    getVerseByKey(activeVerse).then((v) => live && setVerse(v ?? null));
    return () => {
      live = false;
    };
  }, [activeVerse]);

  const bookmarks = useLiveQuery(
    () => (activeVerse ? bookmarksForVerse(activeVerse) : Promise.resolve([] as Bookmark[])),
    [activeVerse],
    [] as Bookmark[]
  );
  const note = useLiveQuery(() => (activeVerse ? getNote(activeVerse) : undefined), [activeVerse]);
  const catIds = useLiveQuery(
    () => (activeVerse ? categoriesForVerse(activeVerse) : Promise.resolve([] as string[])),
    [activeVerse],
    [] as string[]
  );
  const cats = useLiveQuery(() => listCategories(), [], [] as Category[]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeVerse();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeVerse]);

  if (!activeVerse || !verse) return null;

  const surah = meta.surahs.find((s) => s.number === verse.surah);
  const assigned = (cats ?? []).filter((c) => (catIds ?? []).includes(c.id));
  const bookmarked = (bookmarks ?? []).length > 0;

  const copy = async () => {
    const text = `${verse.text}\n\n— ${surah?.nameSimple ?? ''} ${verse.key}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Verse copied');
    } catch {
      showToast('Copy is blocked in this browser');
    }
    closeVerse();
  };

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={closeVerse} />
      <div
        className="panel fixed z-[61] w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden"
        style={anchorStyle(actionAnchor)}
        role="dialog"
        aria-label={`Actions for verse ${verse.key}`}
      >
        {/* Identification: chapter, juz and verse, per the requirements */}
        <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {surah?.nameSimple} {verse.ayah}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                Surah {verse.surah} · Juz {verse.juz} · Page {verse.page} · {verse.key}
              </p>
            </div>
            <span
              dir="rtl"
              className="shrink-0 text-base"
              style={{ color: 'var(--accent)', fontFamily: "'Scheherazade New', serif" }}
            >
              {surah?.nameArabic}
            </span>
          </div>
          <p
            dir="rtl"
            className="mt-2 max-h-24 overflow-y-auto text-[15px] leading-loose"
            style={{ fontFamily: "'Scheherazade New', serif" }}
          >
            {verse.text}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 p-2">
          <Action onClick={() => openNote(verse.key)}>
            {note && note.deletedAt === null && note.contentText.trim() ? '✎ Edit note' : '✎ Add note'}
          </Action>
          <Action onClick={() => openAssign(verse.key)}>
            ▤ Categories{assigned.length ? ` (${assigned.length})` : ''}
          </Action>
          <Action onClick={copy}>⧉ Copy verse</Action>
          {/* The touchscreen equivalent of shift-click: mark this verse as the
              start, then the next verse tapped closes the range. */}
          <Action onClick={() => startRange(verse.key)}>⇥ Select range from here</Action>
          <Action
            onClick={async () => {
              if (bookmarked) {
                for (const b of bookmarks ?? []) await removeBookmark(b.id);
                showToast('Bookmark removed');
              } else {
                await addBookmark(verse.key, verse.id, BOOKMARK_COLORS[0].value);
                showToast('Bookmarked');
              }
              closeVerse();
            }}
          >
            {bookmarked ? '⚑ Remove bookmark' : '⚑ Bookmark'}
          </Action>
        </div>

        {!bookmarked ? (
          <div className="flex items-center gap-2 px-4 pb-3">
            <span className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>
              Colour
            </span>
            {BOOKMARK_COLORS.map((c) => (
              <button
                key={c.value}
                title={c.name}
                aria-label={`Bookmark ${c.name}`}
                className="h-5 w-5 rounded-full border"
                style={{ background: c.value, borderColor: 'var(--border)' }}
                onClick={async () => {
                  await addBookmark(verse.key, verse.id, c.value);
                  showToast(`Bookmarked in ${c.name.toLowerCase()}`);
                  closeVerse();
                }}
              />
            ))}
          </div>
        ) : null}

        {assigned.length ? (
          <div className="flex flex-wrap gap-1 border-t px-4 py-2" style={{ borderColor: 'var(--border)' }}>
            {assigned.map((c) => (
              <span
                key={c.id}
                className="rounded-full px-2 py-0.5 text-[11px]"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {c.name}
              </span>
            ))}
          </div>
        ) : null}

        <DragGrip verseKey={verse.key} verseId={verse.id} />
      </div>
    </>
  );
}

/**
 * The drag source for "drop a verse into a category".
 *
 * Dragging directly off the Mushaf text would fight the reader's scroll — the
 * words are the scroll surface. Tapping a verse first, then dragging this grip,
 * keeps both gestures unambiguous on a touchscreen.
 */
function DragGrip({ verseKey, verseId }: { verseKey: string; verseId: number }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `verse-drag-${verseKey}`,
    data: { kind: 'verse', verseKey, verseId },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="flex cursor-grab items-center justify-center gap-2 border-t py-2.5 text-[11px] active:cursor-grabbing"
      style={{
        borderColor: 'var(--border)',
        color: 'var(--ink-soft)',
        background: 'var(--surface-2)',
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
      }}
    >
      <span style={{ letterSpacing: '0.2em' }}>⠿</span>
      Press and hold, then drag into a category
    </div>
  );
}

function Action({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button className="btn btn-ghost justify-start text-[13px]" onClick={onClick}>
      {children}
    </button>
  );
}

function anchorStyle(anchor: { x: number; y: number } | null): React.CSSProperties {
  if (typeof window === 'undefined' || !anchor) {
    return { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' };
  }
  const w = Math.min(416, window.innerWidth - 24);
  const left = Math.min(Math.max(12, anchor.x - w / 2), window.innerWidth - w - 12);
  const spaceBelow = window.innerHeight - anchor.y;
  const top = spaceBelow > 380 ? anchor.y + 8 : Math.max(12, anchor.y - 380);
  return { left, top };
}

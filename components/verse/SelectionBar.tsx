'use client';

import { useEffect, useState } from 'react';
import type { Meta, Verse } from '@/lib/types';
import { BOOKMARK_COLORS } from '@/lib/types';
import { addBookmarks, versesBetween } from '@/lib/db/repo';
import { useUI } from '@/lib/store';
import { normalizeRange, rangeLabel } from '@/lib/mushaf/verseRange';

/**
 * The bar that appears once a range is being selected.
 *
 * It has two states because selecting a range on a touchscreen has two steps:
 * first the user says where the range starts, then they tap where it ends.
 * Between those, the bar is the only thing telling them the app is waiting — so
 * it says so, and offers the way out.
 */
export default function SelectionBar({ meta }: { meta: Meta }) {
  const { selectionAnchor, selectionFocus, clearSelection, openAssign, showToast } = useUI();
  const [verses, setVerses] = useState<Verse[]>([]);

  const complete = !!selectionAnchor && !!selectionFocus;
  const [from, to] = complete ? normalizeRange(selectionAnchor, selectionFocus) : ['', ''];

  useEffect(() => {
    if (!complete) {
      setVerses([]);
      return;
    }
    let live = true;
    versesBetween(from, to).then((v) => live && setVerses(v));
    return () => {
      live = false;
    };
  }, [complete, from, to]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && clearSelection();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  if (!selectionAnchor) return null;

  const surahOf = (v?: Verse) => meta.surahs.find((s) => s.number === v?.surah)?.nameSimple ?? '';

  const copy = async () => {
    const text = verses.map((v) => v.text).join(' ');
    const cite = `${surahOf(verses[0])} ${rangeLabel(from, to)}`;
    try {
      await navigator.clipboard.writeText(`${text}\n\n— ${cite}`);
      showToast(`Copied ${verses.length} verses`);
    } catch {
      showToast('Copy is blocked in this browser');
    }
  };

  return (
    <div
      className="panel fixed bottom-4 left-1/2 z-[62] flex w-[calc(100vw-1rem)] -translate-x-1/2 items-center justify-center gap-2 px-3 py-2 sm:w-auto"
      style={{ maxWidth: 'calc(100vw - 1rem)' }}
      role="status"
    >
      {!complete ? (
        <>
          <span className="px-1 text-[13px]">
            Start: <strong>{selectionAnchor}</strong> — now tap the last verse
          </span>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={clearSelection}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="hidden px-1 text-[13px] whitespace-nowrap sm:inline">
            <strong>{verses.length || '…'}</strong> {verses.length === 1 ? 'verse' : 'verses'}
            <span style={{ color: 'var(--ink-soft)' }}> · {rangeLabel(from, to)}</span>
          </span>
          <button
            className="btn btn-primary whitespace-nowrap px-2.5 py-1 text-xs"
            disabled={!verses.length}
            onClick={() => openAssign(verses.map((v) => v.key), 'topics')}
          >
            ▤ Add to topics
          </button>
          <button
            className="btn btn-ghost whitespace-nowrap px-2.5 py-1 text-xs"
            disabled={!verses.length}
            onClick={() => openAssign(verses.map((v) => v.key), 'qa')}
          >
            ? Add to Q/A
          </button>
          <button
            className="btn btn-ghost px-2 py-1 text-xs"
            disabled={!verses.length}
            onClick={async () => {
              const n = await addBookmarks(
                verses.map((v) => ({ key: v.key, id: v.id })),
                BOOKMARK_COLORS[0].value
              );
              showToast(n ? `Bookmarked ${n} verses` : 'Already bookmarked');
            }}
          >
            ⚑
          </button>
          <button className="btn btn-ghost px-2 py-1 text-xs" disabled={!verses.length} onClick={copy}>
            ⧉
          </button>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={clearSelection}>
            ✕
          </button>
        </>
      )}
    </div>
  );
}

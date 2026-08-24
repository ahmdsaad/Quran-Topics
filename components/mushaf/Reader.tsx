'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import MushafPage from './MushafPage';
import type { Meta, VerseMarker } from '@/lib/types';
import { prefetchAround } from '@/lib/mushaf/fonts';
import { saveReadingState } from '@/lib/db/repo';

interface Props {
  meta: Meta;
  markers: Map<string, VerseMarker>;
  selectedVerse: string | null;
  range: { from: string; to: string } | null;
  onVerseTap: (verseKey: string, el: HTMLElement, additive: boolean) => void;
  initialPage: number;
  scale: number;
  onPageChange?: (page: number) => void;
  /** Bumping this scrolls to `initialPage` again (used by jump-to navigation). */
  jumpToken: number;
}

/**
 * Vertically scrolls all 604 pages.
 *
 * Every page is a fixed-aspect-ratio box, so total scroll height is deterministic
 * and jumping to a page is arithmetic rather than a search. Only the visible
 * window is mounted — mounting 604 pages of ~200 spans each would not survive a
 * tablet.
 */
export default function Reader({
  meta,
  markers,
  selectedVerse,
  range,
  onVerseTap,
  initialPage,
  scale,
  onPageChange,
  jumpToken,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const didInitialScroll = useRef(false);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth);
      setHeight(el.clientHeight);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    setHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Page box is width-constrained; height follows the 1:1.55 aspect ratio.
  // A Mushaf line always fills its measure, so type size follows page size and
  // "text size" is really "page size" — exactly as with printed editions.
  //
  // Default the page to whatever width makes a WHOLE page fit the viewport
  // height, which is how one actually reads a Mushaf: a page at a time, not a
  // scrolling ribbon. The size slider then scales up from there and the page
  // simply becomes taller than the screen, which is a deliberate choice the
  // reader made rather than the default they were given.
  const PAGE_RATIO = 1.52;
  const fitToHeight = height > 0 ? (height - 40) / PAGE_RATIO : 820;
  const pageWidth = Math.max(280, Math.min(width - 32, Math.round(fitToHeight * scale), 900));
  const estimate = useMemo(() => (pageWidth > 0 ? pageWidth * PAGE_RATIO + 28 : 900), [pageWidth]);

  const virtualizer = useVirtualizer({
    count: meta.pages,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimate,
    overscan: 1,
  });

  // Jump to a page: initial restore, and any later jumpToken bump.
  useEffect(() => {
    if (pageWidth <= 0) return;
    if (!didInitialScroll.current) didInitialScroll.current = true;
    virtualizer.scrollToIndex(Math.max(0, initialPage - 1), { align: 'start' });
    prefetchAround(initialPage, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToken, pageWidth > 0]);

  const currentPage = useRef(initialPage);

  const handleScroll = useCallback(() => {
    const items = virtualizer.getVirtualItems();
    if (!items.length) return;
    const el = parentRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    const item = items.find((i) => i.start <= mid && i.end >= mid) ?? items[0];
    const page = item.index + 1;
    if (page !== currentPage.current) {
      currentPage.current = page;
      onPageChange?.(page);
      prefetchAround(page, 2);
    }
  }, [virtualizer, onPageChange]);

  // Persist reading position, throttled — this fires on every scroll frame.
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = parentRef.current;
      if (!el) return;
      const page = currentPage.current;
      const idx = page - 1;
      const offset = estimate > 0 ? ((el.scrollTop - idx * estimate) / estimate) : 0;
      const range = meta.pageIndex[String(page)];
      void saveReadingState(page, range?.from ?? `${page}`, Math.min(1, Math.max(0, offset)));
    }, 4000);
    return () => window.clearInterval(id);
  }, [estimate, meta.pageIndex]);

  return (
    <div
      ref={parentRef}
      className="scroll-y h-full w-full"
      onScroll={handleScroll}
      style={{ background: 'var(--surface-2)' }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${item.start}px)`,
              display: 'flex',
              justifyContent: 'center',
              padding: '0 16px 24px',
            }}
          >
            <div style={{ width: '100%', maxWidth: pageWidth }}>
              <MushafPage
                page={item.index + 1}
                meta={meta}
                markers={markers}
                selectedVerse={selectedVerse}
                range={range}
                onVerseTap={onVerseTap}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

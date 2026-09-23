'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import SvgMushafPage from './SvgMushafPage';
import type { Meta, VerseMarker } from '@/lib/types';
import { prefetchAround } from '@/lib/mushaf/fonts';
import { saveReadingState } from '@/lib/db/repo';

interface Props {
  meta: Meta;
  markers: Map<string, VerseMarker>;
  selectedVerse: string | null;
  searchedVerse: string | null;
  dimmedVerses?: ReadonlySet<string>;
  range: { from: string; to: string } | null;
  onVerseTap: (verseKey: string, el: HTMLElement, additive: boolean) => void;
  onRangeStart: (verseKey: string) => void;
  initialPage: number;
  scale: number;
  onPageChange?: (page: number) => void;
  /** Bumping this scrolls to `initialPage` again (used by jump-to navigation). */
  jumpToken: number;
  /** Search/reference readers must never alter the synced reading position. */
  persistReading?: boolean;
  /** A mounted but hidden Read workspace must not react to another mode's gestures. */
  active?: boolean;
  /** Smooth, mobile Read-mode scrolling controlled from the top bar. */
  autoScroll?: boolean;
  autoScrollSpeed?: number;
  onAutoScrollEnd?: () => void;
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
  searchedVerse,
  dimmedVerses,
  range,
  onVerseTap,
  onRangeStart,
  initialPage,
  scale,
  onPageChange,
  jumpToken,
  persistReading = true,
  active = true,
  autoScroll = false,
  autoScrollSpeed = 1,
  onAutoScrollEnd,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [compactMobile, setCompactMobile] = useState(false);
  const [appLandscape, setAppLandscape] = useState(false);
  const didInitialScroll = useRef(false);
  const currentPage = useRef(initialPage);
  const resumePage = useRef(initialPage);
  const previousLandscape = useRef(false);
  const suppressRemoteSaveUntil = useRef(0);
  const userNavigationActive = useRef(false);

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

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 1023px)');
    const landscape = window.matchMedia('(orientation: landscape)');
    const standalone = window.matchMedia('(display-mode: standalone)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const update = () => {
      const landscapeApp = landscape.matches && (standalone.matches || coarsePointer.matches);
      setAppLandscape(landscapeApp);
      setCompactMobile(narrow.matches || landscapeApp);
    };
    update();
    const queries = [narrow, landscape, standalone, coarsePointer];
    queries.forEach((query) => query.addEventListener('change', update));
    return () => queries.forEach((query) => query.removeEventListener('change', update));
  }, []);

  // Page box is width-constrained; height follows the 1:1.52 paper ratio.
  // A Mushaf line always fills its measure, so type size follows page size and
  // "text size" is really "page size" — exactly as with printed editions.
  //
  // Default the page to whatever width makes a WHOLE page fit the viewport
  // height, which is how one actually reads a Mushaf: a page at a time, not a
  // scrolling ribbon. The size slider then scales up from there and the page
  // simply becomes taller than the screen, which is a deliberate choice the
  // reader made rather than the default they were given.
  // Exact aspect ratio of the QUL Ligature Based SVG Mushaf viewBox.
  const PAGE_RATIO = compactMobile ? 1.85 : 1.56;
  const fitToHeight = height > 0 ? height / PAGE_RATIO : 820;
  const pageWidth = appLandscape
    ? Math.max(280, width)
    : Math.max(280, Math.min(width, Math.round(fitToHeight * scale), 900));
  const PAGE_GAP = 16;
  const estimate = useMemo(
    () => (pageWidth > 0 ? pageWidth * PAGE_RATIO + PAGE_GAP : 900),
    [pageWidth],
  );

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
    // Every explicit jump becomes this mode's new restoration anchor before
    // scrolling. Otherwise a concurrent desktop panel resize can restore the
    // previous page and make a Topic/Search verse appear to need two clicks.
    resumePage.current = initialPage;
    currentPage.current = initialPage;
    virtualizer.scrollToIndex(Math.max(0, initialPage - 1), { align: 'start' });
    prefetchAround(initialPage, 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToken, pageWidth > 0]);

  // Preserve the current Quran page while rotating. The virtualizer's item
  // heights change substantially when landscape switches to full-width pages.
  useEffect(() => {
    if (previousLandscape.current === appLandscape) return;
    previousLandscape.current = appLandscape;
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(Math.max(0, currentPage.current - 1), { align: 'start' });
    });
  }, [appLandscape, virtualizer]);

  const persistCurrentPosition = useCallback(() => {
    if (!persistReading || !active) return Promise.resolve();
    // An idle device must never claim ownership of the shared reading state.
    // Only navigation initiated by an actual user gesture is allowed to write.
    if (!userNavigationActive.current) return Promise.resolve();
    if (Date.now() < suppressRemoteSaveUntil.current) return Promise.resolve();
    const el = parentRef.current;
    if (!el) return Promise.resolve();
    const page = currentPage.current;
    const idx = page - 1;
    const offset = estimate > 0 ? ((el.scrollTop - idx * estimate) / estimate) : 0;
    const range = meta.pageIndex[String(page)];
    return saveReadingState(
      page,
      range?.from ?? `${page}`,
      Math.min(1, Math.max(0, offset)),
    );
  }, [active, estimate, meta.pageIndex, persistReading]);

  useEffect(() => {
    if (!active) userNavigationActive.current = false;
  }, [active]);

  // Mobile workspaces stay mounted while tabs change. Restore the last page
  // synchronously when Read becomes active so a resize/virtualizer event cannot
  // reinterpret its old pixel offset as a nearby page first.
  useLayoutEffect(() => {
    if (!active || pageWidth <= 0) return;
    const page = resumePage.current;
    const restore = () => {
      currentPage.current = page;
      virtualizer.scrollToIndex(Math.max(0, page - 1), { align: 'start' });
    };
    restore();
    // ResizeObserver and the virtualizer settle on separate frames when the
    // desktop side panel opens/closes. Restore once more after that settlement
    // so the highlighted ayah's page cannot drift out of view.
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [active, pageWidth, virtualizer]);

  useEffect(() => {
    const suppressRemoteSave = () => {
      // Virtualized scrolling can report an intermediate page while it mounts
      // the remote destination. Five seconds comfortably covers that settling
      // period on slower installed mobile apps.
      suppressRemoteSaveUntil.current = Date.now() + 5000;
      userNavigationActive.current = false;
    };
    window.addEventListener('quran-remote-page-will-apply', suppressRemoteSave);
    return () => window.removeEventListener('quran-remote-page-will-apply', suppressRemoteSave);
  }, []);

  const markUserNavigation = useCallback(() => {
    // A real touch, pointer, or wheel action always wins immediately, even if
    // it follows a cloud-driven jump during the suppression window.
    suppressRemoteSaveUntil.current = 0;
    userNavigationActive.current = true;
  }, []);

  useEffect(() => {
    if (!active || !autoScroll) return;
    const el = parentRef.current;
    if (!el) return;

    // Deliberately gentle reading speeds, expressed in CSS pixels per second.
    const speeds = [2.5, 9, 14, 20, 27.5];
    const pixelsPerSecond = speeds[Math.min(5, Math.max(1, autoScrollSpeed)) - 1];
    let frame = 0;
    let previous = performance.now();
    let position = el.scrollTop;
    markUserNavigation();

    const scroll = (now: number) => {
      const elapsed = Math.min(64, now - previous);
      previous = now;
      const maximum = Math.max(0, el.scrollHeight - el.clientHeight);
      if (position >= maximum - 1) {
        onAutoScrollEnd?.();
        return;
      }
      // Keep the fractional position ourselves. Some mobile engines expose
      // scrollTop as whole pixels, which otherwise makes the gentlest speed
      // repeatedly round a sub-pixel step back to zero.
      position = Math.min(maximum, position + (pixelsPerSecond * elapsed) / 1000);
      el.scrollTop = position;
      frame = requestAnimationFrame(scroll);
    };

    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [active, autoScroll, autoScrollSpeed, markUserNavigation, onAutoScrollEnd]);

  // Listen on the window as well as the reading surface. Page jumps from the
  // surah navigator and search results begin with a gesture outside the reader,
  // but they are still genuine user navigation and should sync.
  useEffect(() => {
    if (!active) return;
    const mark = () => markUserNavigation();
    window.addEventListener('pointerdown', mark, true);
    window.addEventListener('touchstart', mark, true);
    window.addEventListener('wheel', mark, true);
    window.addEventListener('keydown', mark, true);
    return () => {
      window.removeEventListener('pointerdown', mark, true);
      window.removeEventListener('touchstart', mark, true);
      window.removeEventListener('wheel', mark, true);
      window.removeEventListener('keydown', mark, true);
    };
  }, [active, markUserNavigation]);

  const handleScroll = useCallback(() => {
    // A display:none mobile workspace can emit virtualizer scroll/layout
    // events while another mode opens. Those events are not reading and must
    // not update even the in-memory Read page.
    if (!active) return;
    const items = virtualizer.getVirtualItems();
    if (!items.length) return;
    const el = parentRef.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight / 3;
    const item = items.find((i) => i.start <= mid && i.end >= mid) ?? items[0];
    const page = item.index + 1;
    if (page !== currentPage.current) {
      currentPage.current = page;
      resumePage.current = page;
      onPageChange?.(page);
      prefetchAround(page, 2);
      // Do not wait for the periodic position save: page changes are the key
      // cross-device resume point and should enter the cloud queue immediately.
      void persistCurrentPosition();
    }
  }, [active, virtualizer, onPageChange, persistCurrentPosition]);

  // `pagehide` also fires for mobile app switching and browser tab closure.
  // Saving when the document becomes hidden gives iOS/Android an earlier,
  // more reliable opportunity before the operating system suspends the page.
  useEffect(() => {
    const saveFinalPosition = () => { void persistCurrentPosition(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveFinalPosition();
    };
    window.addEventListener('pagehide', saveFinalPosition);
    window.addEventListener('quran-before-auto-refresh', saveFinalPosition);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', saveFinalPosition);
      window.removeEventListener('quran-before-auto-refresh', saveFinalPosition);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [persistCurrentPosition]);

  return (
    <div
      ref={parentRef}
      className="mushaf-reader scroll-y h-full w-full"
      onScroll={handleScroll}
      onPointerDown={markUserNavigation}
      onTouchStart={markUserNavigation}
      onWheel={markUserNavigation}
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
              padding: `0 0 ${PAGE_GAP}px`,
            }}
          >
            <div className="mushaf-page-frame" style={{ width: '100%', maxWidth: pageWidth }}>
              <SvgMushafPage
                page={item.index + 1}
                meta={meta}
                markers={markers}
                selectedVerse={selectedVerse}
                searchedVerse={searchedVerse}
                dimmedVerses={dimmedVerses}
                range={range}
                onVerseTap={onVerseTap}
                onRangeStart={onRangeStart}
                compactMobile={compactMobile}
                active={active}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

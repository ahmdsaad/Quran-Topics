'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Meta, VerseMarker } from '@/lib/types';
import { verseKeyInRange } from '@/lib/mushaf/verseRange';
import { useDrag } from '@/components/dnd/DragLayer';
import MushafPage from './MushafPage';

interface Props {
  page: number;
  meta: Meta;
  markers: Map<string, VerseMarker>;
  selectedVerse: string | null;
  searchedVerse: string | null;
  range: { from: string; to: string } | null;
  onVerseTap: (verseKey: string, el: HTMLElement, additive: boolean) => void;
  onRangeStart: (verseKey: string) => void;
  compactMobile?: boolean;
  active?: boolean;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export default function SvgMushafPage({
  page, meta, markers, selectedVerse, searchedVerse, range, onVerseTap, onRangeStart, compactMobile = false, active = true,
}: Props) {
  const [markup, setMarkup] = useState('');
  const [error, setError] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [dragVerseKey, setDragVerseKey] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStart = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggered = useRef(false);
  const suppressClickUntil = useRef(0);
  const touchPointerActive = useRef(false);
  const { enabled: dragEnabled } = useDrag();
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `mushaf-page-verse-${page}`,
    data: dragVerseKey ? { kind: 'verse', verseKey: dragVerseKey } : undefined,
    disabled: !dragEnabled,
  });

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
    longPressStart.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  useEffect(() => {
    // Some Android WebViews synthesize a delayed click after touchend. Once a
    // long press opens the range UI, that click can land on the bottom Read tab
    // because the layout beneath the finger has changed. Catch it at document
    // level before it can activate any newly-positioned control.
    const suppressPostLongPressClick = (event: MouseEvent) => {
      if (Date.now() >= suppressClickUntil.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('click', suppressPostLongPressClick, true);
    return () => document.removeEventListener('click', suppressPostLongPressClick, true);
  }, []);

  const setHostRef = useCallback(
    (node: HTMLDivElement | null) => {
      hostRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef]
  );

  useEffect(() => {
    let live = true;
    setMarkup('');
    setError(false);
    fetch(`/mushaf-svg/${String(page).padStart(3, '0')}.svg`)
      .then((response) => {
        if (!response.ok) throw new Error(`SVG page ${page}: ${response.status}`);
        return response.text();
      })
      .then((svg) => live && setMarkup(svg.replace(/^\uFEFF?<\?xml[^>]*>\s*/i, '')))
      .catch(() => live && setError(true));
    return () => { live = false; };
  }, [page]);

  const isSelected = useCallback(
    (key: string) => selectedVerse === key || (!!range && verseKeyInRange(key, range.from, range.to)),
    [selectedVerse, range]
  );

  const categoryToneByVerse = useMemo(() => {
    const tone = new Map<string, 'light' | 'dark'>();
    const versesPerSurah = new Map(meta.surahs.map((surah) => [surah.number, surah.versesCount]));
    const categorized = Array.from(markers.values())
      .filter((marker) => marker.categoryCount > 0)
      .sort((a, b) => {
        const [aSurah, aAyah] = a.verseKey.split(':').map(Number);
        const [bSurah, bAyah] = b.verseKey.split(':').map(Number);
        return aSurah - bSurah || aAyah - bAyah;
      });
    let previous: { surah: number; ayah: number; group: string; tone: 'light' | 'dark' } | null = null;
    for (const marker of categorized) {
      const [surah, ayah] = marker.verseKey.split(':').map(Number);
      const group = marker.categoryGroupKeys?.[0] ?? `verse:${marker.verseKey}`;
      const followsPrevious: boolean = previous != null && (
        (surah === previous.surah && ayah === previous.ayah + 1)
        || (surah === previous.surah + 1
          && ayah === 1
          && previous.ayah === versesPerSurah.get(previous.surah))
      );
      const nextTone: 'light' | 'dark' = followsPrevious
        ? (group === previous!.group ? previous!.tone : previous!.tone === 'light' ? 'dark' : 'light')
        : 'light';
      tone.set(marker.verseKey, nextTone);
      previous = { surah, ayah, group, tone: nextTone };
    }
    return tone;
  }, [markers, meta.surahs]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const svg = host?.querySelector<SVGSVGElement>('svg');
    const pageInner = svg?.querySelector<SVGGElement>('#md-page-inner');
    if (!svg || !pageInner) return;

    // Running headers, marginal labels, and the folio number are decorative.
    // Their SVG bounds can overlap the first Quran lines on the compact mobile
    // crop, which caused those labels to intercept touchstart and made a long
    // press on the first two lines appear broken. Let touches pass through to
    // the verse hit layer underneath.
    svg.querySelectorAll<SVGElement>('[id^="md-non-quranic-"]').forEach((element) => {
      element.setAttribute('pointer-events', 'none');
    });

    const rect = pageInner.dataset.rect?.split(',').map(Number);
    const quranLeft = rect?.[0];
    const quranTop = rect?.[1];
    const quranRight = rect?.[2];
    const quranBottom = rect?.[3];
    const quranCenter = Number.isFinite(quranLeft) && Number.isFinite(quranRight)
      ? (quranLeft! + quranRight!) / 2
      : 382.68 / 2;

    // Printed SVG pages include wide outer gutters for marginal juz/hizb
    // labels. On a phone those gutters make the Quran text unnecessarily
    // small, so use a narrower viewport and omit only the side annotation.
    if (compactMobile) {
      // Bound pages alternate their binding gutter. `data-rect` stores the
      // Quran block as x1,y1,x2,y2, so center each page independently instead
      // of applying an odd/even guess or a fixed horizontal crop.
      // Crop the unused paper gutters in the viewBox itself. This makes the
      // Quran larger without CSS scaling that can clip the running headers or
      // folio number at the page boundary.
      const mobileWidth = 255;
      const mobileX = Math.max(0, Math.min(382.68 - mobileWidth, quranCenter - mobileWidth / 2));
      const mobileTop = 24;
      const mobileHeight = 488;
      svg.setAttribute('viewBox', `${mobileX.toFixed(2)} ${mobileTop} ${mobileWidth} ${mobileHeight}`);
      svg.querySelector<SVGGElement>('#md-non-quranic-margin-juz-hisb')?.setAttribute('display', 'none');
      // The running labels also alternate with the binding gutter. Align their
      // outer edges to the measured Quran block so neither label is cropped.
      const surahHeader = svg.querySelector<SVGGElement>('#md-non-quranic-header-surah-name');
      const juzHeader = svg.querySelector<SVGGElement>('#md-non-quranic-header-juz-name');
      if (surahHeader && Number.isFinite(quranLeft)) {
        const box = surahHeader.getBBox();
        surahHeader.setAttribute('transform', `translate(${(quranLeft! - box.x).toFixed(2)} 36)`);
      }
      if (juzHeader && Number.isFinite(quranRight)) {
        const box = juzHeader.getBBox();
        juzHeader.setAttribute(
          'transform',
          `translate(${(quranRight! - box.x - box.width).toFixed(2)} 36)`,
        );
      }
      // Pull the folio number upward; the shortened mobile viewBox removes the
      // remaining paper-only whitespace above and below the useful page area.
      svg.querySelector<SVGGElement>('#md-non-quranic-page-number')
        ?.setAttribute('transform', 'translate(0 -22)');
    } else {
      // Physical Mushaf spreads alternate a wider binding gutter between the
      // left and right edges. In a single-page desktop reader that makes the
      // Quran block appear to jump sideways. Shift the viewport by the
      // measured text center so both sides have equal visual padding.
      const desktopWidth = 382.68;
      const desktopHeight = 547.09;
      const desktopX = quranCenter - desktopWidth / 2;
      svg.setAttribute('viewBox', `${desktopX.toFixed(2)} 0 ${desktopWidth} ${desktopHeight}`);

      const surahHeader = svg.querySelector<SVGGElement>('#md-non-quranic-header-surah-name');
      const juzHeader = svg.querySelector<SVGGElement>('#md-non-quranic-header-juz-name');
      const pageNumber = svg.querySelector<SVGGElement>('#md-non-quranic-page-number');
      const headerGap = 7;
      if (surahHeader && Number.isFinite(quranLeft) && Number.isFinite(quranTop)) {
        const box = surahHeader.getBBox();
        const dx = quranLeft! - box.x;
        const dy = quranTop! - headerGap - box.y - box.height;
        surahHeader.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
      }
      if (juzHeader && Number.isFinite(quranRight) && Number.isFinite(quranTop)) {
        const box = juzHeader.getBBox();
        const dx = quranRight! - box.x - box.width;
        const dy = quranTop! - headerGap - box.y - box.height;
        juzHeader.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
      }
      if (pageNumber && Number.isFinite(quranBottom)) {
        const box = pageNumber.getBBox();
        const dx = quranCenter - (box.x + box.width / 2);
        const dy = quranBottom! + 8 - box.y;
        pageNumber.setAttribute('transform', `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
      }
    }

    pageInner.querySelector('[data-qc-highlights]')?.remove();
    pageInner.querySelector('[data-qc-hit-areas]')?.remove();
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('data-qc-highlights', '');
    layer.setAttribute('pointer-events', 'none');
    const hitLayer = document.createElementNS(SVG_NS, 'g');
    hitLayer.setAttribute('data-qc-hit-areas', '');

    const groups = Array.from(
      pageInner.querySelectorAll<SVGGElement>('g[data-surah][data-aya][data-line-number]')
    );
    const segments = new Map<string, { key: string; boxes: DOMRect[]; marker?: VerseMarker }>();

    for (const group of groups) {
      const surah = Number(group.dataset.surah);
      const ayah = Number(group.dataset.aya);
      const key = `${surah}:${ayah}`;
      group.dataset.verseKey = key;
      group.classList.add('svg-mushaf-word');
      const segmentKey = `${key}-${group.dataset.lineNumber}`;
      const current = segments.get(segmentKey) ?? { key, boxes: [], marker: markers.get(key) };
      current.boxes.push(group.getBBox() as unknown as DOMRect);
      segments.set(segmentKey, current);
    }

    for (const segment of segments.values()) {
      const left = Math.min(...segment.boxes.map((box) => box.x));
      const top = Math.min(...segment.boxes.map((box) => box.y));
      const right = Math.max(...segment.boxes.map((box) => box.x + box.width));
      const bottom = Math.max(...segment.boxes.map((box) => box.y + box.height));
      const selected = isSelected(segment.key);
      const noted = segment.marker?.hasNote === true;
      const categorized = (segment.marker?.categoryCount ?? 0) > 0;
      const qa = (segment.marker?.qaCount ?? 0) > 0;
      const hovered = hoverKey === segment.key && !selected;
      const searched = searchedVerse === segment.key;
      const kind = selected ? 'selected' : searched ? 'searched' : noted ? 'noted' : categorized ? 'categorized' : hovered ? 'hover' : null;

      // Each verse can contain several separate word groups. A transparent
      // rectangle spanning those words makes the whitespace around and between
      // them interactive too, so users do not have to target an exact glyph.
      // Use a path instead of an SVG rect for the invisible touch target.
      // Android WebView can expose dynamically-created rects as native focus
      // boxes (the small black rectangle/triangle seen at the page edge), even
      // when they have no paint. This closed path preserves the generous verse
      // hit area without producing that native rectangle artefact.
      const hitArea = document.createElementNS(SVG_NS, 'path');
      const hitLeft = left - 2;
      const hitTop = top - 3;
      const hitRight = right + 2;
      const hitBottom = bottom + 3;
      hitArea.setAttribute('d', `M ${hitLeft} ${hitTop} H ${hitRight} V ${hitBottom} H ${hitLeft} Z`);
      hitArea.setAttribute('fill', '#fffdf8');
      hitArea.setAttribute('fill-opacity', '0.001');
      hitArea.setAttribute('stroke', 'none');
      hitArea.setAttribute('pointer-events', 'fill');
      hitArea.setAttribute('cursor', 'pointer');
      hitArea.setAttribute('data-verse-key', segment.key);
      hitArea.setAttribute('aria-hidden', 'true');
      hitArea.setAttribute('focusable', 'false');
      hitLayer.appendChild(hitArea);

      if (kind) {
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', String(left - 1.5));
        rect.setAttribute('y', String(top - 1));
        rect.setAttribute('width', String(right - left + 3));
        rect.setAttribute('height', String(bottom - top + 2));
        rect.setAttribute('rx', '2');
        const alternateCategoryTone = kind === 'categorized' && categoryToneByVerse.get(segment.key) === 'dark'
          ? ' svg-verse-highlight--categorized-alt'
          : '';
        rect.setAttribute('class', `svg-verse-highlight svg-verse-highlight--${kind}${alternateCategoryTone}`);
        layer.appendChild(rect);
      }

      if (segment.marker?.hasBookmark && !selected) {
        const underline = document.createElementNS(SVG_NS, 'line');
        underline.setAttribute('x1', String(left));
        underline.setAttribute('x2', String(right));
        underline.setAttribute('y1', String(bottom + 1.1));
        underline.setAttribute('y2', String(bottom + 1.1));
        underline.setAttribute('class', 'svg-bookmark-line');
        underline.setAttribute('stroke', segment.marker.bookmarkColor || '#8a6d3b');
        layer.appendChild(underline);
      }

      if (qa) {
        const qaUnderline = document.createElementNS(SVG_NS, 'line');
        qaUnderline.setAttribute('x1', String(left));
        qaUnderline.setAttribute('x2', String(right));
        qaUnderline.setAttribute('y1', String(bottom + 2.4));
        qaUnderline.setAttribute('y2', String(bottom + 2.4));
        qaUnderline.setAttribute('class', 'svg-qa-line');
        layer.appendChild(qaUnderline);
      }
    }
    pageInner.insertBefore(layer, pageInner.firstChild);
    pageInner.appendChild(hitLayer);
  }, [markup, markers, hoverKey, isSelected, categoryToneByVerse, compactMobile, searchedVerse, active]);

  const verseTargetAt = (target: EventTarget | null) =>
    (target as Element | null)?.closest<SVGElement>('[data-verse-key]') ?? null;

  const verseKeyAtPoint = (target: EventTarget | null, clientX: number, clientY: number) => {
    const directKey = verseTargetAt(target)?.dataset.verseKey;
    if (directKey) return directKey;

    // Mobile SVG hit-testing is inconsistent close to a cropped viewBox edge:
    // a touch on the first line may be reported against the page container
    // instead of the transparent verse path. Resolve it from the generated hit
    // areas' screen bounds as a fallback, with a small allowance for diacritics
    // and the whitespace immediately around the line.
    const hitAreas = hostRef.current?.querySelectorAll<SVGGraphicsElement>(
      '[data-qc-hit-areas] [data-verse-key]'
    );
    if (!hitAreas) return undefined;

    let nearest: { key: string; distance: number } | null = null;
    for (const area of hitAreas) {
      const key = area.dataset.verseKey;
      if (!key) continue;
      const box = area.getBoundingClientRect();
      const verticalDistance = clientY < box.top ? box.top - clientY
        : clientY > box.bottom ? clientY - box.bottom : 0;
      if (verticalDistance > 10) continue;
      const horizontalDistance = clientX < box.left ? box.left - clientX
        : clientX > box.right ? clientX - box.right : 0;
      if (horizontalDistance > 18) continue;
      const distance = verticalDistance * 2 + horizontalDistance;
      if (!nearest || distance < nearest.distance) nearest = { key, distance };
    }
    return nearest?.key;
  };

  if (error) {
    return (
      <MushafPage page={page} meta={meta} markers={markers} selectedVerse={selectedVerse}
        searchedVerse={searchedVerse} range={range} onVerseTap={onVerseTap} />
    );
  }
  if (!markup) return <div className="svg-mushaf-page animate-pulse" aria-label={`Loading Quran page ${page}`} />;

  return (
    <div
      ref={setHostRef}
      className="svg-mushaf-page"
      data-page={page}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse') {
          setHoverKey(verseTargetAt(event.target)?.dataset.verseKey ?? null);
          return;
        }
        const start = longPressStart.current;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
          cancelLongPress();
        }
      }}
      onPointerLeave={(event) => {
        setHoverKey(null);
        if (event.pointerType !== 'touch') cancelLongPress();
      }}
      onPointerDown={(event) => {
        const key = event.pointerType === 'touch'
          ? verseKeyAtPoint(event.target, event.clientX, event.clientY)
          : verseTargetAt(event.target)?.dataset.verseKey;
        if (!key) return;
        longPressTriggered.current = false;
        if (event.pointerType === 'touch') {
          touchPointerActive.current = true;
          cancelLongPress();
          longPressStart.current = { x: event.clientX, y: event.clientY };
          // Keep the gesture attached to the stable page host even when the
          // selection highlight causes SVG hit paths to be regenerated.
          event.currentTarget.setPointerCapture(event.pointerId);
          longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null;
            longPressTriggered.current = true;
            suppressClickUntil.current = Date.now() + 800;
            onRangeStart(key);
          }, 450);
          return;
        }
        if (event.pointerType !== 'mouse') {
          cancelLongPress();
          longPressStart.current = { x: event.clientX, y: event.clientY };
          longPressTimer.current = setTimeout(() => {
            longPressTimer.current = null;
            longPressTriggered.current = true;
            onRangeStart(key);
          }, 450);
          return;
        }
        setDragVerseKey(key);
        listeners?.onPointerDown?.(event);
      }}
      onPointerUp={(event) => {
        if (event.pointerType === 'touch') {
          touchPointerActive.current = false;
          if (longPressTriggered.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }
        cancelLongPress();
      }}
      onPointerCancel={(event) => {
        if (event.pointerType === 'touch') touchPointerActive.current = false;
        cancelLongPress();
      }}
      onTouchStart={(event) => {
        // Pointer events are the primary mobile path. Keep this fallback for
        // older WebViews that do not dispatch touch pointer events.
        if (touchPointerActive.current) return;
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        const key = touch ? verseKeyAtPoint(event.target, touch.clientX, touch.clientY) : undefined;
        if (!key || !touch) return;
        longPressTriggered.current = false;
        cancelLongPress();
        longPressStart.current = { x: touch.clientX, y: touch.clientY };
        longPressTimer.current = setTimeout(() => {
          longPressTimer.current = null;
          longPressTriggered.current = true;
          suppressClickUntil.current = Date.now() + 800;
          onRangeStart(key);
        }, 450);
      }}
      onTouchMove={(event) => {
        const start = longPressStart.current;
        const touch = event.touches[0];
        if (start && touch && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 18) {
          cancelLongPress();
        }
      }}
      onTouchEnd={(event) => {
        if (longPressTriggered.current) {
          // Prevent the compatibility mouse/click event generated after a
          // completed touch hold. Without this, it may activate the Read tab.
          event.preventDefault();
          event.stopPropagation();
        }
        cancelLongPress();
      }}
      onTouchCancel={cancelLongPress}
      onContextMenu={(event) => {
        if (!dragEnabled) event.preventDefault();
      }}
      onClick={(event) => {
        if (longPressTriggered.current) {
          longPressTriggered.current = false;
          event.preventDefault();
          return;
        }
        if (isDragging) return;
        const target = verseTargetAt(event.target);
        const key = target?.dataset.verseKey;
        if (target && key) onVerseTap(key, target as unknown as HTMLElement, event.shiftKey);
      }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Meta, PageDoc, VerseMarker } from '@/lib/types';
import { fetchPage } from '@/lib/db/bootstrap';
import { fontFamily, glyphOf, isFontReady, loadPageFont } from '@/lib/mushaf/fonts';
import { verseKeyInRange } from '@/lib/mushaf/verseRange';

interface Props {
  page: number;
  meta: Meta;
  markers: Map<string, VerseMarker>;
  selectedVerse: string | null;
  /** Multi-verse selection, inclusive of both ends. */
  range: { from: string; to: string } | null;
  onVerseTap: (verseKey: string, el: HTMLElement, additive: boolean) => void;
}

/** Fraction of the measure the glyphs occupy; the rest becomes inter-word space. */
const INK_RATIO = 0.94;
/** Below this fill fraction a line is closing a surah — centre it, don't stretch it. */
const STRETCH_FLOOR = 0.55;

interface Band {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * One Mushaf page.
 *
 * Four rules that are easy to get wrong and expensive to discover late:
 *
 *  1. Lines, not verses, are the unit of layout. Verses straddle lines and pages.
 *
 *  2. QPC glyph codes are Arabic Presentation Forms codepoints scoped to THIS
 *     page's font. They must go in via dangerouslySetInnerHTML — textContent
 *     renders the wrong characters entirely.
 *
 *  3. A printed Mushaf line fills its measure. The QCF fonts are cut so that the
 *     full lines of a page share a natural width, so the faithful way to size the
 *     type is to measure the page's widest line and solve for the size that makes
 *     it fill — one size for the whole page, exactly as the press did it. Sizing
 *     per line would balloon a three-word closing line to the width of the page.
 *
 *  4. A verse is the unit of *selection*, but it is not one element — it is a run
 *     of word spans, often split across lines and pages. Highlighting is therefore
 *     drawn as bands behind the words rather than styled on them: see `bandsFor`.
 */
export default function MushafPage({
  page,
  meta,
  markers,
  selectedVerse,
  range,
  onVerseTap,
}: Props) {
  const [doc, setDoc] = useState<PageDoc | null>(null);
  const [fontReady, setFontReady] = useState(() => isFontReady(page));
  const [fitPx, setFitPx] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const [bands, setBands] = useState<{ selected: Band[]; hovered: Band[] }>({
    selected: [],
    hovered: [],
  });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setError(false);
    fetchPage<PageDoc>(page)
      .then((d) => live && setDoc(d))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [page]);

  useEffect(() => {
    let live = true;
    setFontReady(isFontReady(page));
    loadPageFont(page).then(() => live && setFontReady(isFontReady(page)));
    return () => {
      live = false;
    };
  }, [page]);

  // Page-level type fitting.
  //
  // Measured at whatever size the lines currently render at, then scaled — the
  // relationship is linear so one pass lands it. Note what this deliberately does
  // NOT do: write to a line's style.fontSize. React owns that property, and
  // clearing it after a probe silently wipes the value React just set, leaving
  // the fit permanently unapplied. `data-stretch` is the one exception — it is
  // pure presentation, so the measure pass owns it outright and React never
  // renders it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !fontReady || !doc) return;

    let raf = 0;
    const measure = () => {
      const lines = root.querySelectorAll<HTMLElement>('.mushaf-line');
      if (!lines.length) return;

      let inkPerPx = 0; // widest line's glyph width per 1px of font-size
      let avail = 0;
      const perLine: { el: HTMLElement; ink: number }[] = [];

      lines.forEach((el) => {
        const w = el.clientWidth;
        if (!w) return;
        avail = w;
        const size = parseFloat(getComputedStyle(el).fontSize) || 1;
        let ink = 0;
        for (const child of Array.from(el.children)) {
          ink += (child as HTMLElement).getBoundingClientRect().width;
        }
        if (ink <= 0) return;
        perLine.push({ el, ink: ink / size });
        inkPerPx = Math.max(inkPerPx, ink / size);
      });

      if (!inkPerPx || !avail) return;

      const target = Math.max(8, Math.min((avail * INK_RATIO) / inkPerPx, avail / 4));
      for (const { el, ink } of perLine) {
        el.dataset.stretch = String((ink * target) / avail >= STRETCH_FLOOR);
      }
      // Tolerance stops the ResizeObserver our own resize triggers from oscillating.
      setFitPx((prev) => (prev !== null && Math.abs(prev - target) < 0.4 ? prev : target));
    };

    raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(root);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [fontReady, doc, page]);

  const inSelection = useCallback(
    (key: string) =>
      selectedVerse === key || (!!range && verseKeyInRange(key, range.from, range.to)),
    [selectedVerse, range]
  );

  /**
   * Highlight geometry.
   *
   * A background on each word span reads as a row of disconnected chips, because
   * a justified Mushaf line spaces its words with variable gaps — the words are
   * flex items in a `space-between` row, so the gaps belong to the line, not to
   * any word. Painting one band per (verse × line) instead gives a single
   * continuous mark that spans the gaps, which is what makes a verse look like
   * one selected thing rather than several highlighted words.
   */
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !doc) return;

    let raf = 0;
    const compute = () => {
      const rootRect = root.getBoundingClientRect();

      const bandsFor = (test: (key: string) => boolean): Band[] => {
        const byLine = new Map<Element, DOMRect[]>();
        root.querySelectorAll<HTMLElement>('.mushaf-word').forEach((w) => {
          const key = w.dataset.verseKey;
          if (!key || !test(key)) return;
          const line = w.closest('.mushaf-line');
          if (!line) return;
          const list = byLine.get(line);
          if (list) list.push(w.getBoundingClientRect());
          else byLine.set(line, [w.getBoundingClientRect()]);
        });

        return Array.from(byLine.values()).map((rects) => {
          const left = Math.min(...rects.map((r) => r.left));
          const right = Math.max(...rects.map((r) => r.right));
          const top = Math.min(...rects.map((r) => r.top));
          const bottom = Math.max(...rects.map((r) => r.bottom));
          const padY = (bottom - top) * 0.12;
          return {
            left: left - rootRect.left,
            top: top - rootRect.top - padY,
            width: right - left,
            height: bottom - top + padY * 2,
          };
        });
      };

      setBands({
        selected: bandsFor(inSelection),
        hovered: hoverKey && !inSelection(hoverKey) ? bandsFor((k) => k === hoverKey) : [],
      });
    };

    raf = requestAnimationFrame(compute);
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    });
    ro.observe(root);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [doc, fitPx, fontReady, hoverKey, inSelection]);

  // Hover is resolved on the page, not per word: the target is the whole verse,
  // and a verse is many spans. Delegating also means one listener per page
  // instead of two per word.
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-verse-key]');
    setHoverKey(el?.dataset.verseKey ?? null);
  }, []);

  if (error) {
    return (
      <div className="mushaf-page min-h-[50vh] items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
          Page {page} could not be loaded.
        </p>
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="mushaf-page" style={{ aspectRatio: '1 / 1.5' }}>
        <div className="flex flex-1 flex-col justify-around" aria-hidden>
          {Array.from({ length: 15 }).map((_, i) => (
            <div
              key={i}
              style={{
                height: '2.2em',
                background: 'var(--paper-edge)',
                opacity: 0.5,
                borderRadius: 4,
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  const surahByNumber = new Map(meta.surahs.map((s) => [s.number, s]));

  return (
    <div
      className="mushaf-page"
      ref={rootRef}
      data-page={page}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => setHoverKey(null)}
    >
      <div className="verse-bands" aria-hidden>
        {bands.hovered.map((b, i) => (
          <div key={`h${i}`} className="verse-band" data-kind="hover" style={b} />
        ))}
        {bands.selected.map((b, i) => (
          <div key={`s${i}`} className="verse-band" data-kind="selected" style={b} />
        ))}
      </div>

      <div className="mushaf-body flex flex-1 flex-col justify-center">
        {doc.lines.map((line) => {
          if (line.t === 'surah') {
            const s = surahByNumber.get(line.s);
            return (
              <div className="surah-band" dir="rtl" key={`${page}-${line.n}`}>
                <span style={{ opacity: 0.55 }}>﴿</span>
                <span>سورة {s?.nameArabic}</span>
                <span style={{ opacity: 0.55 }}>﴾</span>
                <span dir="ltr" className="surah-band-en">
                  {s?.nameSimple}
                </span>
              </div>
            );
          }
          if (line.t === 'basmala') {
            return (
              <div className="basmala-line" key={`${page}-${line.n}`}>
                بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ
              </div>
            );
          }
          return (
            <div
              key={`${page}-${line.n}`}
              className="mushaf-line"
              data-fallback={!fontReady}
              style={{
                ...(fontReady ? { fontFamily: `'${fontFamily(page)}'` } : {}),
                ...(fontReady && fitPx ? { fontSize: `${fitPx}px` } : {}),
              }}
            >
              {line.w.map((w, i) => (
                <Word
                  key={`${w.k}-${i}`}
                  verseKey={w.k}
                  glyph={glyphOf(w)}
                  text={w.t}
                  useGlyph={fontReady}
                  marker={markers.get(w.k)}
                  selected={inSelection(w.k)}
                  onTap={onVerseTap}
                />
              ))}
            </div>
          );
        })}
      </div>
      <div className="page-number">{page}</div>
    </div>
  );
}

/**
 * Memoised because selection re-renders the page: a range spanning a juz would
 * otherwise reconcile every word span on every page it touches. With this, only
 * the words whose `selected` actually flipped do any work.
 */
const Word = memo(function Word({
  verseKey,
  glyph,
  text,
  useGlyph,
  marker,
  selected,
  onTap,
}: {
  verseKey: string;
  glyph: string;
  text: string;
  useGlyph: boolean;
  marker?: VerseMarker;
  selected: boolean;
  onTap: (verseKey: string, el: HTMLElement, additive: boolean) => void;
}) {
  return (
    <span
      className="mushaf-word"
      data-verse-key={verseKey}
      data-marked={marker ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      style={
        marker?.bookmarkColor
          ? ({ ['--marker' as string]: marker.bookmarkColor } as React.CSSProperties)
          : undefined
      }
      role="button"
      tabIndex={-1}
      aria-label={`Verse ${verseKey}`}
      // Shift-click extends a selection, the way it does in any list — the
      // action sheet's "Select range" is the same thing for a touchscreen.
      onClick={(e) => onTap(verseKey, e.currentTarget as HTMLElement, e.shiftKey)}
      // QPC glyph codes are page-scoped Arabic Presentation Forms codepoints.
      // textContent would render the wrong characters — this must be innerHTML.
      {...(useGlyph ? { dangerouslySetInnerHTML: { __html: glyph } } : { children: text })}
    />
  );
});

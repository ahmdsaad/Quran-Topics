'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Reader from '@/components/mushaf/Reader';
import TopBar from '@/components/layout/TopBar';
import CategoriesPane from '@/components/categories/CategoriesPane';
import VerseActionSheet from '@/components/verse/VerseActionSheet';
import NoteEditorModal from '@/components/verse/NoteEditorModal';
import AssignSheet from '@/components/verse/AssignSheet';
import SelectionBar from '@/components/verse/SelectionBar';
import SearchPanel from '@/components/search/SearchPanel';
import BookmarksPanel from '@/components/BookmarksPanel';
import SettingsPanel from '@/components/SettingsPanel';
import Toast from '@/components/Toast';
import DragLayer from '@/components/dnd/DragLayer';
import { ensureCorpus, loadMeta } from '@/lib/db/bootstrap';
import { allMarkers, getReadingState, getSettings } from '@/lib/db/repo';
import { db } from '@/lib/db/schema';
import type { Meta, VerseMarker } from '@/lib/types';
import { useUI } from '@/lib/store';
import { normalizeRange } from '@/lib/mushaf/verseRange';

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState({ pct: 0, label: 'Starting…' });
  const [errorMsg, setErrorMsg] = useState('');
  const [initialPage, setInitialPage] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [dual, setDual] = useState(false);

  const {
    jumpPage,
    jumpToken,
    jumpTo,
    mobilePane,
    setMobilePane,
    activeVerse,
    openVerse,
    selectionAnchor,
    selectionFocus,
    startRange,
    extendRange,
  } = useUI();

  // ------------------------------------------------------------------- boot
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await ensureCorpus((pct, label) => live && setProgress({ pct, label }));
        const [m, rs, st] = await Promise.all([loadMeta(), getReadingState(), getSettings()]);
        if (!live) return;
        setMeta(m);
        const deep = Number(new URLSearchParams(location.search).get('page'));
        const page = Number.isFinite(deep) && deep >= 1 && deep <= m.pages ? deep : (rs?.page ?? 1);
        setInitialPage(page);
        setCurrentPage(page);
        if (st?.pageScale) setScale(st.pageScale);
        if (st?.theme) document.documentElement.dataset.theme = st.theme;
        setPhase('ready');
      } catch (e) {
        if (!live) return;
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setPhase('error');
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // ------------------------------------------------------- responsive layout
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setDual(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // ------------------------------------------------------------ verse markers
  const markerRows = useLiveQuery(
    () => (phase === 'ready' ? allMarkers() : Promise.resolve([] as VerseMarker[])),
    [phase],
    [] as VerseMarker[]
  );
  const markers = useMemo(() => {
    const m = new Map<string, VerseMarker>();
    (markerRows ?? []).forEach((r) => m.set(r.verseKey, r));
    return m;
  }, [markerRows]);

  // One tap does one of three things, in priority order:
  //   1. shift-click, or a tap while a range is pending -> close the range
  //   2. shift-click with nothing pending -> start a range at the last verse
  //   3. plain tap -> the usual single-verse action sheet
  const handleVerseTap = useCallback(
    (verseKey: string, el: HTMLElement, additive: boolean) => {
      if (selectionAnchor && !selectionFocus) {
        extendRange(verseKey);
        return;
      }
      if (additive) {
        // Order matters: startRange clears the focus, so the anchor has to be
        // promoted before the range is closed, never after.
        const anchor = selectionAnchor ?? activeVerse;
        if (!anchor) {
          startRange(verseKey);
          return;
        }
        if (!selectionAnchor) startRange(anchor);
        extendRange(verseKey);
        return;
      }
      const r = el.getBoundingClientRect();
      openVerse(verseKey, { x: r.left + r.width / 2, y: r.bottom });
    },
    [openVerse, selectionAnchor, selectionFocus, activeVerse, startRange, extendRange]
  );

  const range =
    selectionAnchor && selectionFocus
      ? (() => {
          const [from, to] = normalizeRange(selectionAnchor, selectionFocus);
          return { from, to };
        })()
      : selectionAnchor
        ? { from: selectionAnchor, to: selectionAnchor }
        : null;

  // ------------------------------------------------------------------ states
  if (phase === 'loading') {
    return (
      <div
        className="flex h-dvh flex-col items-center justify-center gap-5 px-8"
        style={{ background: 'var(--surface-2)' }}
      >
        <div className="text-center">
          <div className="mb-1 text-2xl" style={{ color: 'var(--accent)' }} dir="rtl">
            ﴾ القرآن ﴿
          </div>
          <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
            {progress.label}
          </p>
        </div>
        <div
          className="h-1.5 w-full max-w-xs overflow-hidden rounded-full"
          style={{ background: 'var(--border)' }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${Math.round(progress.pct * 100)}%`, background: 'var(--accent)' }}
          />
        </div>
        <p className="max-w-xs text-center text-xs" style={{ color: 'var(--ink-soft)' }}>
          The Quran is stored on this device the first time. After that it opens offline.
        </p>
      </div>
    );
  }

  if (phase === 'error' || !meta) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-base font-medium">Could not load the Quran text.</p>
        <p className="max-w-sm text-sm" style={{ color: 'var(--ink-soft)' }}>
          {errorMsg || 'Unknown error.'}
        </p>
        <button className="btn btn-primary" onClick={() => location.reload()}>
          Try again
        </button>
        <button
          className="btn btn-ghost text-xs"
          onClick={async () => {
            await db().delete();
            location.reload();
          }}
        >
          Reset local data and reload
        </button>
      </div>
    );
  }

  // ------------------------------------------------------------------- shell
  const readerPane = (
    <Reader
      meta={meta}
      markers={markers}
      selectedVerse={activeVerse}
      range={range}
      onVerseTap={handleVerseTap}
      initialPage={jumpToken > 0 ? jumpPage : initialPage}
      jumpToken={jumpToken}
      scale={scale}
      onPageChange={setCurrentPage}
    />
  );

  const sidePane = (
    <>
      {mobilePane === 'search' ? (
        <SearchPanel meta={meta} onClose={() => setMobilePane('reader')} />
      ) : mobilePane === 'bookmarks' ? (
        <BookmarksPanel meta={meta} onClose={() => setMobilePane('reader')} />
      ) : mobilePane === 'settings' ? (
        <SettingsPanel
          scale={scale}
          onScale={setScale}
          onClose={() => setMobilePane('reader')}
        />
      ) : (
        <CategoriesPane meta={meta} />
      )}
    </>
  );

  return (
    <DragLayer meta={meta}>
      <div className="flex h-dvh flex-col" style={{ background: 'var(--surface-2)' }}>
        <TopBar
          meta={meta}
          currentPage={currentPage}
          dual={dual}
          onJump={jumpTo}
          scale={scale}
          onScale={setScale}
        />

        <div className="flex min-h-0 flex-1">
          {dual ? (
            <>
              <aside
                className="flex w-[380px] shrink-0 flex-col border-r xl:w-[440px]"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                {sidePane}
              </aside>
              <main className="min-w-0 flex-1">{readerPane}</main>
            </>
          ) : (
            <main className="min-w-0 flex-1">
              {mobilePane === 'reader' ? (
                readerPane
              ) : (
                <div className="h-full" style={{ background: 'var(--surface)' }}>
                  {sidePane}
                </div>
              )}
            </main>
          )}
        </div>

        {!dual && <MobileTabs />}
      </div>

      <VerseActionSheet meta={meta} />
      <NoteEditorModal meta={meta} />
      <AssignSheet meta={meta} />
      <SelectionBar meta={meta} />
      <Toast />
    </DragLayer>
  );
}

function MobileTabs() {
  const { mobilePane, setMobilePane } = useUI();
  const tabs = [
    { id: 'reader', label: 'Read', icon: '☰' },
    { id: 'categories', label: 'Categories', icon: '▤' },
    { id: 'search', label: 'Search', icon: '⌕' },
    { id: 'bookmarks', label: 'Marks', icon: '⚑' },
    { id: 'settings', label: 'Settings', icon: '⚙' },
  ] as const;

  return (
    <nav
      className="flex shrink-0 border-t"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--surface)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setMobilePane(t.id)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium"
          style={{
            color: mobilePane === t.id ? 'var(--accent)' : 'var(--ink-soft)',
          }}
          aria-current={mobilePane === t.id}
        >
          <span className="text-base leading-none">{t.icon}</span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

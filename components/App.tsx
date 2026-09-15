'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import RecitePanel, { type RecitationPosition } from '@/components/recite/RecitePanel';
import Toast from '@/components/Toast';
import DragLayer from '@/components/dnd/DragLayer';
import SyncManager from '@/components/auth/SyncManager';
import AutoUpdate from '@/components/auth/AutoUpdate';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { syncNow } from '@/lib/supabase/sync';
import { ensureCorpus, loadMeta } from '@/lib/db/bootstrap';
import { allMarkers, getReadingState, getSettings, rebuildMarkers } from '@/lib/db/repo';
import { db } from '@/lib/db/schema';
import type { Meta, TranslationLanguage, VerseMarker } from '@/lib/types';
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
  const [translationLanguage, setTranslationLanguage] = useState<TranslationLanguage>('en');
  const [categoryArabicFontSize, setCategoryArabicFontSize] = useState(22.5);
  const [categoryTranslationFontSize, setCategoryTranslationFontSize] = useState(24);
  const [categoryTitleFontSize, setCategoryTitleFontSize] = useState(14);
  const [recentSearchFontSize, setRecentSearchFontSize] = useState(11);
  const [searchHighlight, setSearchHighlight] = useState<{
    key: string;
    page: number;
    arrived: boolean;
  } | null>(null);
  const [searchPage, setSearchPage] = useState(1);
  const [searchJumpToken, setSearchJumpToken] = useState(0);
  const [mobileSearchReader, setMobileSearchReader] = useState(false);
  const [topicHighlight, setTopicHighlight] = useState<{ key: string; page: number } | null>(null);
  const [topicPage, setTopicPage] = useState(1);
  const [topicJumpToken, setTopicJumpToken] = useState(0);
  const [mobileTopicReader, setMobileTopicReader] = useState(false);
  const [qaHighlight, setQaHighlight] = useState<{ key: string; page: number } | null>(null);
  const [qaPage, setQaPage] = useState(1);
  const [qaJumpToken, setQaJumpToken] = useState(0);
  const [mobileQaReader, setMobileQaReader] = useState(false);
  const [marksHighlight, setMarksHighlight] = useState<{ key: string; page: number } | null>(null);
  const [marksPage, setMarksPage] = useState(1);
  const [marksJumpToken, setMarksJumpToken] = useState(0);
  const [mobileMarksReader, setMobileMarksReader] = useState(false);
  const [recitePage, setRecitePage] = useState(1);
  const [reciteJumpToken, setReciteJumpToken] = useState(0);
  const [recitationPosition, setRecitationPosition] = useState<RecitationPosition | null>(null);
  const recitePageRef = useRef(1);
  const [dual, setDual] = useState(false);

  const {
    jumpPage,
    jumpToken,
    jumpTo,
    mobilePane,
    setMobilePane,
    activeVerse,
    actionAnchor,
    noteVerse,
    assignVerses,
    assignSpace,
    openCategoryId,
    openQaCategoryId,
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
        // Reading position is account state. Pull it before choosing the first
        // page so a newly opened device starts on the newest cloud page rather
        // than briefly restoring its stale local position.
        const supabase = getSupabaseBrowserClient();
        if (supabase) {
          try {
            if (live) setProgress({ pct: 1, label: 'Checking your last Quran page…' });
            const { data } = await supabase.auth.getSession();
            if (data.session?.user) await syncNow(data.session.user);
          } catch (syncError) {
            // Offline-first fallback: opening the reader must still work when
            // the network is unavailable; SyncManager retries after boot.
            console.error('[initial reading sync]', syncError);
          }
        }
        const [m, rs, st] = await Promise.all([loadMeta(), getReadingState(), getSettings()]);
        if (!live) return;
        setMeta(m);
        const bootUrl = new URL(location.href);
        const deep = Number(bootUrl.searchParams.get('page'));
        const hasValidDeepPage = Number.isFinite(deep) && deep >= 1 && deep <= m.pages;
        const page = hasValidDeepPage ? deep : (rs?.page ?? 1);
        setInitialPage(page);
        setCurrentPage(page);
        setRecitePage(page);
        recitePageRef.current = page;
        // The updater uses `page` as a one-time, synchronous hand-off across a
        // mobile refresh. Remove it after consuming it so a later launch can
        // resume from whichever device most recently updated the cloud state.
        if (hasValidDeepPage) {
          bootUrl.searchParams.delete('page');
          history.replaceState(history.state, '', `${bootUrl.pathname}${bootUrl.search}${bootUrl.hash}`);
        }
        if (st?.pageScale) setScale(st.pageScale);
        if (st?.translationLanguage) setTranslationLanguage(st.translationLanguage);
        if (st?.categoryArabicFontSize) setCategoryArabicFontSize(st.categoryArabicFontSize);
        if (st?.categoryTranslationFontSize) {
          setCategoryTranslationFontSize(st.categoryTranslationFontSize);
        }
        if (st?.categoryTitleFontSize) setCategoryTitleFontSize(st.categoryTitleFontSize);
        if (st?.recentSearchFontSize) setRecentSearchFontSize(st.recentSearchFontSize);
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

  // Android's system Back action is delivered to an installed PWA as browser
  // history navigation. Mirror meaningful mobile UI steps into that history so
  // Back closes a sheet, returns from a Quran reference to its list, closes a
  // topic, or returns to the previous mode in the same order the user opened it.
  // Quran scrolling itself is intentionally excluded: it remains reading state,
  // not browser navigation history.
  const restoringMobileHistory = useRef(false);
  const mobileHistoryReady = useRef(false);
  const mobileSnapshot = useMemo(() => ({
    pane: mobilePane,
    searchReader: mobileSearchReader,
    topicReader: mobileTopicReader,
    qaReader: mobileQaReader,
    marksReader: mobileMarksReader,
    openCategoryId,
    openQaCategoryId,
    activeVerse,
    actionAnchor,
    noteVerse,
    assignVerses,
    assignSpace,
    selectionAnchor,
    selectionFocus,
  }), [
    mobilePane, mobileSearchReader, mobileTopicReader, mobileQaReader, mobileMarksReader,
    openCategoryId, openQaCategoryId, activeVerse, actionAnchor, noteVerse,
    assignVerses, assignSpace, selectionAnchor, selectionFocus,
  ]);
  const mobileSnapshotJson = JSON.stringify(mobileSnapshot);

  useEffect(() => {
    if (phase !== 'ready' || window.matchMedia('(min-width: 1024px)').matches) return;

    const restore = (snapshot: typeof mobileSnapshot) => {
      restoringMobileHistory.current = JSON.stringify(snapshot) !== mobileSnapshotJson;
      setMobileSearchReader(snapshot.searchReader);
      setMobileTopicReader(snapshot.topicReader);
      setMobileQaReader(snapshot.qaReader);
      setMobileMarksReader(snapshot.marksReader);
      useUI.setState({
        mobilePane: snapshot.pane,
        openCategoryId: snapshot.openCategoryId,
        openQaCategoryId: snapshot.openQaCategoryId,
        activeVerse: snapshot.activeVerse,
        actionAnchor: snapshot.actionAnchor,
        noteVerse: snapshot.noteVerse,
        assignVerses: snapshot.assignVerses,
        assignSpace: snapshot.assignSpace,
        selectionAnchor: snapshot.selectionAnchor,
        selectionFocus: snapshot.selectionFocus,
      });
    };

    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { qcRoot?: boolean; qcNavigation?: boolean; snapshot?: typeof mobileSnapshot } | null;
      if (state?.qcNavigation && state.snapshot) {
        restore(state.snapshot);
        return;
      }
      if (state?.qcRoot) {
        restore(state.snapshot ?? mobileSnapshot);
        if (window.confirm('Do you really want to close the app?')) {
          window.removeEventListener('popstate', onPopState);
          history.back();
        } else {
          history.pushState({ qcNavigation: true, snapshot: state.snapshot ?? mobileSnapshot }, '');
        }
      }
    };

    if (!mobileHistoryReady.current) {
      history.replaceState({ ...history.state, qcRoot: true, snapshot: mobileSnapshot }, '');
      history.pushState({ qcNavigation: true, snapshot: mobileSnapshot }, '');
      mobileHistoryReady.current = true;
    } else if (restoringMobileHistory.current) {
      restoringMobileHistory.current = false;
    } else {
      history.pushState({ qcNavigation: true, snapshot: mobileSnapshot }, '');
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // The serialized value changes only for meaningful mobile navigation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mobileSnapshotJson]);

  useEffect(() => {
    document.documentElement.style.setProperty('--category-title-font-size', `${categoryTitleFontSize}px`);
  }, [categoryTitleFontSize]);

  // ------------------------------------------------------- responsive layout
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setDual(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Desktop changes the width of the Quran viewport between modes. Whenever a
  // reference mode is shown again, explicitly return to its still-selected
  // ayah instead of relying on a pixel scroll offset from the previous width.
  useEffect(() => {
    if (!dual) return;
    if (mobilePane === 'search' && searchHighlight) {
      setSearchPage(searchHighlight.page);
      setSearchJumpToken((token) => token + 1);
    } else if (mobilePane === 'categories' && topicHighlight) {
      setTopicPage(topicHighlight.page);
      setTopicJumpToken((token) => token + 1);
    } else if (mobilePane === 'qa' && qaHighlight) {
      setQaPage(qaHighlight.page);
      setQaJumpToken((token) => token + 1);
    } else if (mobilePane === 'bookmarks' && marksHighlight) {
      setMarksPage(marksHighlight.page);
      setMarksJumpToken((token) => token + 1);
    }
  }, [dual, mobilePane, searchHighlight?.key, searchHighlight?.page, topicHighlight?.key, topicHighlight?.page, qaHighlight?.key, qaHighlight?.page, marksHighlight?.key, marksHighlight?.page]);

  // ------------------------------------------------------------ verse markers
  // Rebuild once after an upgrade so older local marker rows gain any newly
  // derived fields. Do not rebuild inside the live query: that query reruns
  // whenever a marker changes, and writing the whole marker table from inside
  // its own observer can create a costly feedback loop on mobile browsers.
  useEffect(() => {
    if (phase !== 'ready') return;
    void rebuildMarkers().catch((error) => console.error('[marker migration]', error));
  }, [phase]);

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
      searchedVerse={null}
      range={range}
      onVerseTap={handleVerseTap}
      onRangeStart={startRange}
      initialPage={jumpToken > 0 && jumpPage !== currentPage ? jumpPage : currentPage}
      jumpToken={jumpToken}
      scale={scale}
      active={mobilePane === 'reader'}
      onPageChange={(page) => {
        if (mobilePane === 'reader') setCurrentPage(page);
      }}
    />
  );

  const openSearchPage = (page: number, key: string | null = null) => {
    setSearchPage(page);
    setSearchHighlight(key ? { key, page, arrived: true } : null);
    setSearchJumpToken((token) => token + 1);
  };

  const searchReaderPane = (
    <Reader
      meta={meta}
      markers={markers}
      selectedVerse={activeVerse}
      searchedVerse={searchHighlight?.key ?? null}
      range={range}
      onVerseTap={handleVerseTap}
      onRangeStart={startRange}
      initialPage={searchHighlight?.page ?? searchPage}
      jumpToken={searchJumpToken}
      scale={scale}
      persistReading={false}
      active={mobilePane === 'search'}
      onPageChange={setSearchPage}
    />
  );

  const openTopicPage = (page: number, key: string | null = null) => {
    setTopicPage(page);
    setTopicHighlight(key ? { key, page } : null);
    setTopicJumpToken((token) => token + 1);
  };

  const topicReaderPane = (
    <Reader
      meta={meta}
      markers={markers}
      selectedVerse={activeVerse}
      searchedVerse={topicHighlight?.key ?? null}
      range={range}
      onVerseTap={handleVerseTap}
      onRangeStart={startRange}
      initialPage={topicHighlight?.page ?? topicPage}
      jumpToken={topicJumpToken}
      scale={scale}
      persistReading={false}
      active={mobilePane === 'categories'}
      onPageChange={setTopicPage}
    />
  );

  const openQaPage = (page: number, key: string | null = null) => {
    setQaPage(page);
    setQaHighlight(key ? { key, page } : null);
    setQaJumpToken((token) => token + 1);
  };

  const qaReaderPane = (
    <Reader
      meta={meta}
      markers={markers}
      selectedVerse={activeVerse}
      searchedVerse={qaHighlight?.key ?? null}
      range={range}
      onVerseTap={handleVerseTap}
      onRangeStart={startRange}
      initialPage={qaHighlight?.page ?? qaPage}
      jumpToken={qaJumpToken}
      scale={scale}
      persistReading={false}
      active={mobilePane === 'qa'}
      onPageChange={setQaPage}
    />
  );

  const openMarksPage = (page: number, key: string | null = null) => {
    setMarksPage(page);
    setMarksHighlight(key ? { key, page } : null);
    setMarksJumpToken((token) => token + 1);
  };

  const marksReaderPane = (
    <Reader
      meta={meta}
      markers={markers}
      selectedVerse={activeVerse}
      searchedVerse={marksHighlight?.key ?? null}
      range={range}
      onVerseTap={handleVerseTap}
      onRangeStart={startRange}
      initialPage={marksHighlight?.page ?? marksPage}
      jumpToken={marksJumpToken}
      scale={scale}
      persistReading={false}
      active={mobilePane === 'bookmarks'}
      onPageChange={setMarksPage}
    />
  );

  const openRecitePage = (page: number) => {
    recitePageRef.current = page;
    setRecitePage(page);
    setReciteJumpToken((token) => token + 1);
  };

  const reciteReaderPane = (
    <Reader
      meta={meta}
      markers={markers}
      selectedVerse={null}
      searchedVerse={null}
      recitingWord={recitationPosition
        ? { verseKey: recitationPosition.verseKey, wordIndex: recitationPosition.wordIndex }
        : null}
      range={null}
      onVerseTap={handleVerseTap}
      onRangeStart={startRange}
      initialPage={recitePage}
      jumpToken={reciteJumpToken}
      scale={scale}
      persistReading={false}
      active={mobilePane === 'recite'}
      onPageChange={(page) => {
        recitePageRef.current = page;
        setRecitePage(page);
      }}
    />
  );

  const handleRecitationPosition = (position: RecitationPosition) => {
    setRecitationPosition(position);
    if (position.page !== recitePageRef.current) openRecitePage(position.page);
  };

  const reciteControls = (
    <RecitePanel
      meta={meta}
      active={mobilePane === 'recite'}
      onPosition={handleRecitationPosition}
      onReset={() => setRecitationPosition(null)}
    />
  );

  const mobileRecitePane = (
    <div className="relative h-full">
      {reciteReaderPane}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30">
        <div className="pointer-events-auto">
          <RecitePanel
            meta={meta}
            compact
            active={mobilePane === 'recite'}
            onPosition={handleRecitationPosition}
            onReset={() => setRecitationPosition(null)}
          />
        </div>
      </div>
    </div>
  );

  const topicsPane = (
    <div className="h-full">
      <div className={!dual && mobileTopicReader ? 'hidden' : 'h-full'}>
        <CategoriesPane
          meta={meta}
          translationLanguage={translationLanguage}
          arabicFontSize={categoryArabicFontSize}
          translationFontSize={categoryTranslationFontSize}
          selectedVerseKey={topicHighlight?.key}
          onVerseOpen={(verse) => {
            openTopicPage(verse.page, verse.key);
            if (!dual) setMobileTopicReader(true);
          }}
        />
      </div>
      {!dual && mobileTopicReader ? (
        <div className="flex h-full flex-col">
          <div className="shrink-0 border-b p-2" style={{ borderColor: 'var(--border)' }}>
            <button className="btn btn-ghost px-2 text-xs" onClick={() => setMobileTopicReader(false)}>
              ‹ Topic verses
            </button>
          </div>
          <div className="min-h-0 flex-1">{topicReaderPane}</div>
        </div>
      ) : null}
    </div>
  );

  const qaPane = (
    <div className="h-full">
      <div className={!dual && mobileQaReader ? 'hidden' : 'h-full'}>
        <CategoriesPane
          space="qa"
          meta={meta}
          translationLanguage={translationLanguage}
          arabicFontSize={categoryArabicFontSize}
          translationFontSize={categoryTranslationFontSize}
          selectedVerseKey={qaHighlight?.key}
          onVerseOpen={(verse) => {
            openQaPage(verse.page, verse.key);
            if (!dual) setMobileQaReader(true);
          }}
        />
      </div>
      {!dual && mobileQaReader ? (
        <div className="flex h-full flex-col">
          <div className="shrink-0 border-b p-2" style={{ borderColor: 'var(--border)' }}>
            <button className="btn btn-ghost px-2 text-xs" onClick={() => setMobileQaReader(false)}>
              ‹ Q/A verses
            </button>
          </div>
          <div className="min-h-0 flex-1">{qaReaderPane}</div>
        </div>
      ) : null}
    </div>
  );

  const searchPane = (
    <div className="h-full">
          <div className={!dual && mobileSearchReader ? 'hidden' : 'h-full'}>
            <SearchPanel
              meta={meta}
              selectedVerseKey={searchHighlight?.key}
              recentSearchFontSize={recentSearchFontSize}
              onVerseResult={(verse) => {
                openSearchPage(verse.page, verse.key);
                if (!dual) setMobileSearchReader(true);
              }}
            />
          </div>
          {!dual && mobileSearchReader ? (
            <div className="flex h-full flex-col">
              <div className="shrink-0 border-b p-2" style={{ borderColor: 'var(--border)' }}>
                <button className="btn btn-ghost px-2 text-xs" onClick={() => setMobileSearchReader(false)}>
                  ‹ Search results
                </button>
              </div>
              <div className="min-h-0 flex-1">{searchReaderPane}</div>
            </div>
          ) : null}
    </div>
  );

  const marksPane = (
    <div className="h-full">
      <div className={!dual && mobileMarksReader ? 'hidden' : 'h-full'}>
        <BookmarksPanel
          meta={meta}
          selectedVerseKey={marksHighlight?.key}
          onClose={() => setMobilePane('reader')}
          onVerseOpen={(verse) => {
            openMarksPage(verse.page, verse.key);
            if (!dual) setMobileMarksReader(true);
          }}
        />
      </div>
      {!dual && mobileMarksReader ? (
        <div className="flex h-full flex-col">
          <div className="shrink-0 border-b p-2" style={{ borderColor: 'var(--border)' }}>
            <button className="btn btn-ghost px-2 text-xs" onClick={() => setMobileMarksReader(false)}>
              ‹ Marks
            </button>
          </div>
          <div className="min-h-0 flex-1">{marksReaderPane}</div>
        </div>
      ) : null}
    </div>
  );

  const sidePane = (
    <>
      {mobilePane === 'search' ? (
        searchPane
      ) : mobilePane === 'qa' ? (
        qaPane
      ) : mobilePane === 'bookmarks' ? (
        marksPane
      ) : mobilePane === 'recite' ? (
        reciteControls
      ) : mobilePane === 'settings' ? (
        <SettingsPanel
          scale={scale}
          onScale={setScale}
          translationLanguage={translationLanguage}
          onTranslationLanguage={setTranslationLanguage}
          categoryArabicFontSize={categoryArabicFontSize}
          onCategoryArabicFontSize={setCategoryArabicFontSize}
          categoryTranslationFontSize={categoryTranslationFontSize}
          onCategoryTranslationFontSize={setCategoryTranslationFontSize}
          categoryTitleFontSize={categoryTitleFontSize}
          onCategoryTitleFontSize={setCategoryTitleFontSize}
          recentSearchFontSize={recentSearchFontSize}
          onRecentSearchFontSize={setRecentSearchFontSize}
          onClose={() => setMobilePane('reader')}
        />
      ) : (
        topicsPane
      )}
    </>
  );

  return (
    <DragLayer meta={meta}>
      <SyncManager />
      <AutoUpdate currentPage={currentPage} />
      <div className="flex h-dvh flex-col" style={{ background: 'var(--surface-2)' }}>
        <TopBar
          meta={meta}
          currentPage={mobilePane === 'search' && (dual || mobileSearchReader)
            ? searchPage
            : mobilePane === 'categories' && (dual || mobileTopicReader)
              ? topicPage
              : mobilePane === 'qa' && (dual || mobileQaReader)
                ? qaPage
              : mobilePane === 'bookmarks' && (dual || mobileMarksReader)
                ? marksPage
              : mobilePane === 'recite'
                ? recitePage
              : currentPage}
          dual={dual}
          onJump={(page) => {
            if (mobilePane === 'search') {
              openSearchPage(page);
              if (!dual) setMobileSearchReader(true);
            } else if (mobilePane === 'categories') {
              openTopicPage(page);
              if (!dual) setMobileTopicReader(true);
            } else if (mobilePane === 'qa') {
              openQaPage(page);
              if (!dual) setMobileQaReader(true);
            } else if (mobilePane === 'bookmarks') {
              openMarksPage(page);
              if (!dual) setMobileMarksReader(true);
            } else if (mobilePane === 'recite') {
              setRecitationPosition(null);
              openRecitePage(page);
            } else {
              jumpTo(page);
            }
          }}
          scale={scale}
          onScale={setScale}
        />

        <div className="flex min-h-0 flex-1">
          {dual ? (
            <>
              <aside
                className={`${mobilePane === 'reader' ? 'hidden' : 'flex'} w-[60%] shrink-0 flex-col border-r`}
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                {/* Keep Search and Topics mounted while switching workspaces so
                    their query, results, selection, and scroll position survive. */}
                <div className={mobilePane === 'search' ? 'h-full' : 'hidden'}>{searchPane}</div>
                <div className={mobilePane === 'categories' ? 'h-full' : 'hidden'}>{topicsPane}</div>
                <div className={mobilePane === 'qa' ? 'h-full' : 'hidden'}>{qaPane}</div>
                <div className={mobilePane === 'bookmarks' ? 'h-full' : 'hidden'}>{marksPane}</div>
                <div className={mobilePane === 'recite' ? 'h-full' : 'hidden'}>{reciteControls}</div>
                {mobilePane === 'settings' ? (
                  <SettingsPanel
                    scale={scale}
                    onScale={setScale}
                    translationLanguage={translationLanguage}
                    onTranslationLanguage={setTranslationLanguage}
                    categoryArabicFontSize={categoryArabicFontSize}
                    onCategoryArabicFontSize={setCategoryArabicFontSize}
                    categoryTranslationFontSize={categoryTranslationFontSize}
                    onCategoryTranslationFontSize={setCategoryTranslationFontSize}
                    categoryTitleFontSize={categoryTitleFontSize}
                    onCategoryTitleFontSize={setCategoryTitleFontSize}
                    recentSearchFontSize={recentSearchFontSize}
                    onRecentSearchFontSize={setRecentSearchFontSize}
                    onClose={() => setMobilePane('reader')}
                  />
                ) : null}
              </aside>
              <main className="relative min-w-0 flex-1 overflow-hidden">
                {/* Desktop mirrors mobile: each Quran mode remains mounted so
                    its page, scroll position, and temporary green highlight
                    survive tab changes. */}
                <div
                  className={mobilePane !== 'search' && mobilePane !== 'categories' && mobilePane !== 'qa' && mobilePane !== 'bookmarks' && mobilePane !== 'recite'
                    ? 'h-full'
                    : 'invisible absolute inset-0 h-full pointer-events-none'}
                >
                  {readerPane}
                </div>
                <div
                  className={mobilePane === 'search'
                    ? 'h-full'
                    : 'invisible absolute inset-0 h-full pointer-events-none'}
                >
                  {searchReaderPane}
                </div>
                <div
                  className={mobilePane === 'categories'
                    ? 'h-full'
                    : 'invisible absolute inset-0 h-full pointer-events-none'}
                >
                  {topicReaderPane}
                </div>
                <div
                  className={mobilePane === 'qa'
                    ? 'h-full'
                    : 'invisible absolute inset-0 h-full pointer-events-none'}
                >
                  {qaReaderPane}
                </div>
                <div
                  className={mobilePane === 'bookmarks'
                    ? 'h-full'
                    : 'invisible absolute inset-0 h-full pointer-events-none'}
                >
                  {marksReaderPane}
                </div>
                <div
                  className={mobilePane === 'recite'
                    ? 'h-full'
                    : 'invisible absolute inset-0 h-full pointer-events-none'}
                >
                  {reciteReaderPane}
                </div>
              </main>
            </>
          ) : (
            <main className="relative min-w-0 flex-1 overflow-hidden">
              {/* Read and Search stay mounted as independent workspaces. Hiding
                  one must not reset the other's query, results, or scroll. */}
              <div className={mobilePane === 'reader' ? 'h-full' : 'invisible absolute inset-0 h-full pointer-events-none'}>
                {readerPane}
              </div>
              <div className={mobilePane === 'search' ? 'h-full' : 'invisible absolute inset-0 h-full pointer-events-none'}>
                {searchPane}
              </div>
              <div className={mobilePane === 'categories' ? 'h-full' : 'invisible absolute inset-0 h-full pointer-events-none'}>
                {topicsPane}
              </div>
              <div className={mobilePane === 'qa' ? 'h-full' : 'invisible absolute inset-0 h-full pointer-events-none'}>
                {qaPane}
              </div>
              <div className={mobilePane === 'bookmarks' ? 'h-full' : 'invisible absolute inset-0 h-full pointer-events-none'}>
                {marksPane}
              </div>
              <div className={mobilePane === 'recite' ? 'h-full' : 'invisible absolute inset-0 h-full pointer-events-none'}>
                {mobileRecitePane}
              </div>
              {mobilePane !== 'reader' && mobilePane !== 'search' && mobilePane !== 'categories' && mobilePane !== 'qa' && mobilePane !== 'bookmarks' && mobilePane !== 'recite' ? (
                <div className="h-full" style={{ background: 'var(--surface)' }}>
                  {sidePane}
                </div>
              ) : null}
            </main>
          )}
        </div>

        {!dual && <MobileTabs />}
      </div>

      <VerseActionSheet meta={meta} translationLanguage={translationLanguage} />
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
    { id: 'categories', label: 'Topics', icon: '▤' },
    { id: 'qa', label: 'Q/A', icon: '?' },
    { id: 'recite', label: 'Recite', icon: '◉' },
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
            background: mobilePane === t.id ? 'var(--accent-soft)' : 'transparent',
            boxShadow: mobilePane === t.id ? 'inset 0 3px 0 var(--accent)' : 'none',
            fontWeight: mobilePane === t.id ? 700 : 500,
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

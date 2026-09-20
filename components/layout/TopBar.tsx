'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Meta } from '@/lib/types';
import { useUI } from '@/lib/store';
import { getVerseByKey, listCategories } from '@/lib/db/repo';
import {
  exportAllCategoriesDocx,
  exportAllCategoriesXlsx,
} from '@/lib/export/exporters';
import AccountButton from '@/components/auth/AccountButton';

export default function TopBar({
  meta,
  currentPage,
  dual,
  onJump,
  scale,
  onScale,
  reciteControls,
}: {
  meta: Meta;
  currentPage: number;
  dual: boolean;
  onJump: (page: number) => void;
  scale: number;
  onScale: (v: number) => void;
  reciteControls?: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  const [exporting, setExporting] = useState<'docx' | 'xlsx' | null>(null);
  const { setMobilePane, mobilePane, showToast } = useUI();

  const exportAll = async (kind: 'docx' | 'xlsx') => {
    setExporting(kind);
    try {
      const categories = await listCategories('all');
      const exporter = kind === 'docx' ? exportAllCategoriesDocx : exportAllCategoriesXlsx;
      await exporter(categories, meta);
      showToast(`All topics exported as ${kind === 'docx' ? 'Word' : 'Excel'}`);
    } catch (error) {
      console.error('[export all] failed', error);
      showToast('Export failed');
    } finally {
      setExporting(null);
    }
  };

  const surahOfPage = useMemo(() => {
    const range = meta.pageIndex[String(currentPage)];
    const n = range ? Number(range.from.split(':')[0]) : 1;
    return meta.surahs.find((s) => s.number === n) ?? meta.surahs[0];
  }, [meta, currentPage]);

  const juzOfPage = useMemo(() => {
    const range = meta.pageIndex[String(currentPage)];
    if (!range) return 1;
    const [s, a] = range.from.split(':').map(Number);
    let juz = 1;
    meta.juzStarts.forEach((k, i) => {
      const [js, ja] = k.split(':').map(Number);
      if (s > js || (s === js && a >= ja)) juz = i + 1;
    });
    return juz;
  }, [meta, currentPage]);

  return (
    <>
      <header
        className="relative flex shrink-0 items-center gap-2 border-b px-3 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          {dual ? (
            <div className="flex items-center gap-1">
            <TabBtn active={mobilePane === 'reader'} onClick={() => setMobilePane('reader')}>
              Read
            </TabBtn>
            <TabBtn active={mobilePane === 'categories'} onClick={() => setMobilePane('categories')}>
              Topics
            </TabBtn>
            <TabBtn active={mobilePane === 'qa'} onClick={() => setMobilePane('qa')}>
              Q/A
            </TabBtn>
            <TabBtn active={mobilePane === 'recite'} onClick={() => setMobilePane('recite')}>
              Test recitation
            </TabBtn>
            <TabBtn active={mobilePane === 'search'} onClick={() => setMobilePane('search')}>
              Search
            </TabBtn>
            <TabBtn active={mobilePane === 'bookmarks'} onClick={() => setMobilePane('bookmarks')}>
              Bookmarks
            </TabBtn>
            <TabBtn active={mobilePane === 'settings'} onClick={() => setMobilePane('settings')}>
              Settings
            </TabBtn>
            </div>
          ) : null}
          <div className="hidden items-center gap-1 sm:flex" aria-label="Export all topics">
            <button className="btn btn-ghost px-2 text-[12px]" disabled={exporting !== null}
              onClick={() => exportAll('docx')} title="Export all topics to Word">
              {exporting === 'docx' ? 'Exporting…' : 'Word'}
            </button>
            <button className="btn btn-ghost px-2 text-[12px]" disabled={exporting !== null}
              onClick={() => exportAll('xlsx')} title="Export all topics to Excel">
              {exporting === 'xlsx' ? 'Exporting…' : 'Excel'}
            </button>
          </div>
          <AccountButton compact={!dual && mobilePane === 'recite'} />
        </div>

        {reciteControls ? (
          <div
            className={mobilePane === 'recite'
              ? 'absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2'
              : 'hidden'}
          >
            {reciteControls}
          </div>
        ) : null}

        <button className="btn btn-ghost shrink-0 gap-2 px-2" onClick={() => setNavOpen(true)}
          aria-label="Jump to surah, page or juz">
          <span className="hidden text-right sm:block">
            <span className="block text-[13px] font-semibold leading-tight">{surahOfPage.nameSimple}</span>
            <span className="block text-[11px] leading-tight" style={{ color: 'var(--ink-soft)' }}>
              Page {currentPage} · Juz {juzOfPage}
            </span>
          </span>
          <span className="hidden text-lg sm:block" dir="rtl"
            style={{ color: 'var(--accent)', fontFamily: "'Scheherazade New', serif" }}>
            {surahOfPage.nameArabic}
          </span>
          <span className="text-base leading-none">☰</span>
        </button>
      </header>

      {navOpen ? (
        <NavigatorModal
          meta={meta}
          currentPage={currentPage}
          onClose={() => setNavOpen(false)}
          onJump={(p) => {
            onJump(p);
            setNavOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="btn btn-ghost px-2.5 text-[13px]"
      onClick={onClick}
      style={active ? { color: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}
    >
      {children}
    </button>
  );
}

function NavigatorModal({
  meta,
  currentPage,
  onClose,
  onJump,
}: {
  meta: Meta;
  currentPage: number;
  onClose: () => void;
  onJump: (page: number) => void;
}) {
  const [tab, setTab] = useState<'surah' | 'page' | 'juz'>('surah');
  const [q, setQ] = useState('');
  const [verseInput, setVerseInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const surahs = meta.surahs.filter((s) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      s.nameSimple.toLowerCase().includes(needle) ||
      s.nameEnglish.toLowerCase().includes(needle) ||
      s.nameArabic.includes(q) ||
      String(s.number) === q.trim()
    );
  });

  const jumpToVerse = async () => {
    const m = verseInput.trim().match(/^(\d{1,3})\s*[:\s.]\s*(\d{1,3})$/);
    if (!m) return;
    const key = `${Number(m[1])}:${Number(m[2])}`;
    const v = await getVerseByKey(key);
    if (v) onJump(v.page);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 sm:p-8" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgb(0 0 0 / 0.35)' }} />
      <div
        className="panel relative flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 gap-1 border-b p-2" style={{ borderColor: 'var(--border)' }}>
          {(['surah', 'page', 'juz'] as const).map((t) => (
            <button
              key={t}
              className="btn btn-ghost flex-1 capitalize"
              style={tab === t ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'surah' ? (
          <>
            <div className="shrink-0 border-b p-3" style={{ borderColor: 'var(--border)' }}>
              <input
                ref={inputRef}
                className="field"
                dir="auto"
                placeholder="Search surah by name or number…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <input
                  className="field"
                  placeholder="Or jump to a verse, e.g. 2:255"
                  value={verseInput}
                  onChange={(e) => setVerseInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && jumpToVerse()}
                />
                <button className="btn btn-primary shrink-0" onClick={jumpToVerse}>
                  Go
                </button>
              </div>
            </div>
            <div className="scroll-y flex-1">
              {surahs.map((s) => (
                <button
                  key={s.number}
                  className="flex w-full items-center gap-3 border-b px-4 py-2.5 text-left"
                  style={{ borderColor: 'var(--border)' }}
                  onClick={() => onJump(s.firstPage)}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {s.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.nameSimple}</span>
                    <span className="block truncate text-xs" style={{ color: 'var(--ink-soft)' }}>
                      {s.nameEnglish} · {s.versesCount} verses · page {s.firstPage}
                    </span>
                  </span>
                  <span
                    dir="rtl"
                    className="shrink-0 text-lg"
                    style={{ fontFamily: "'Scheherazade New', serif" }}
                  >
                    {s.nameArabic}
                  </span>
                </button>
              ))}
              {!surahs.length ? (
                <p className="p-6 text-center text-sm" style={{ color: 'var(--ink-soft)' }}>
                  No surah matches “{q}”.
                </p>
              ) : null}
            </div>
          </>
        ) : tab === 'page' ? (
          <div className="scroll-y flex-1 p-3">
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8">
              {Array.from({ length: meta.pages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  className="btn px-0 text-xs"
                  style={
                    p === currentPage
                      ? { borderColor: 'var(--accent)', color: 'var(--accent)' }
                      : undefined
                  }
                  onClick={() => onJump(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="scroll-y flex-1 p-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {meta.juzStarts.map((key, i) => (
                <button
                  key={key}
                  className="btn flex-col gap-0 py-2 text-xs"
                  onClick={async () => {
                    const v = await getVerseByKey(key);
                    if (v) onJump(v.page);
                  }}
                >
                  <span className="font-semibold">Juz {i + 1}</span>
                  <span style={{ color: 'var(--ink-soft)' }}>{key}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

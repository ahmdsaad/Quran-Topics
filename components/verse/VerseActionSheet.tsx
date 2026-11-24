'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDraggable } from '@dnd-kit/core';
import type {
  Bookmark,
  Category,
  Meta,
  TafsirEditionId,
  TranslationLanguage,
  Verse,
} from '@/lib/types';
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
import { exportVerseImage } from '@/lib/export/verseImage';
import { tafsirEdition as getTafsirEdition } from '@/lib/tafsir';

export default function VerseActionSheet({
  meta,
  translationLanguage,
  tafsirEdition,
}: {
  meta: Meta;
  translationLanguage: TranslationLanguage;
  tafsirEdition: TafsirEditionId;
}) {
  const {
    activeVerse,
    actionAnchor,
    closeVerse,
    openNote,
    openAssign,
    showToast,
    startRange,
    setOpenCategory,
    setOpenQaCategory,
    setMobilePane,
  } = useUI();
  const [verse, setVerse] = useState<Verse | null>(null);
  const [copyOptionsOpen, setCopyOptionsOpen] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [tafsir, setTafsir] = useState<{ text: string; loading: boolean; error: boolean }>({
    text: '',
    loading: false,
    error: false,
  });

  useEffect(() => {
    if (!activeVerse) {
      setVerse(null);
      setCopyOptionsOpen(false);
      return;
    }
    let live = true;
    getVerseByKey(activeVerse).then((v) => live && setVerse(v ?? null));
    return () => {
      live = false;
    };
  }, [activeVerse]);

  useEffect(() => {
    if (!verse) {
      setTafsir({ text: '', loading: false, error: false });
      return;
    }
    const controller = new AbortController();
    setTafsir({ text: '', loading: true, error: false });
    const query = new URLSearchParams({
      edition: tafsirEdition,
      surah: String(verse.surah),
      ayah: String(verse.ayah),
    });
    fetch(`/api/tafsir?${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { text?: string; error?: string };
        if (!response.ok) throw new Error(body.error || `Tafsir ${response.status}`);
        setTafsir({ text: body.text ?? '', loading: false, error: false });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error('[tafsir]', error);
        setTafsir({ text: '', loading: false, error: true });
      });
    return () => controller.abort();
  }, [tafsirEdition, verse]);

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
  const cats = useLiveQuery(() => listCategories('all'), [], [] as Category[]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeVerse();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeVerse]);

  if (!activeVerse || !verse) return null;

  const surah = meta.surahs.find((s) => s.number === verse.surah);
  const assigned = (cats ?? []).filter((c) => (catIds ?? []).includes(c.id));
  const assignedTopics = assigned.filter((c) => c.description !== '__quran_categories_qa__');
  const assignedQa = assigned.filter((c) => c.description === '__quran_categories_qa__');
  const bookmarked = (bookmarks ?? []).length > 0;

  const copy = async (withTranslation: boolean) => {
    const translation = verse.translations?.[translationLanguage]?.trim();
    const text = [
      verse.text,
      withTranslation && translation ? translation : '',
      `— ${surah?.nameSimple ?? ''} ${verse.key}`,
    ].filter(Boolean).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast(withTranslation ? 'Verse and translation copied' : 'Verse copied');
    } catch {
      showToast('Copy is blocked in this browser');
    }
    closeVerse();
  };

  const createImage = async () => {
    if (exportingImage) return;
    setExportingImage(true);
    try {
      const copied = await exportVerseImage({
        verses: [{
          arabic: verse.text,
          translation: verse.translations?.[translationLanguage] ?? '',
          page: verse.page,
          verseKey: verse.key,
        }],
        arabicReference: `${surah?.nameArabic ?? ''} · ${verse.ayah}`,
        translationReference: `${surah?.nameSimple ?? ''} · ${verse.ayah}`,
        filename: `Quran-${verse.key.replace(':', '-')}.jpg`,
      });
      showToast(copied ? 'Image copied and JPG downloaded' : 'JPG downloaded');
      closeVerse();
    } catch (error) {
      console.error('[verse image]', error);
      showToast('Could not create the image');
    } finally {
      setExportingImage(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={closeVerse} />
      <div
        className="verse-action-sheet panel fixed z-[61] max-h-[80dvh] overflow-y-auto overscroll-contain lg:max-h-[90dvh]"
        style={anchorStyle(actionAnchor)}
        role="dialog"
        aria-label={`Actions for verse ${verse.key}`}
      >
        <button
          className="btn btn-ghost absolute right-1.5 top-1.5 z-10 h-11 min-h-0 w-11 rounded-full p-0 text-2xl leading-none"
          style={{ background: 'var(--surface)' }}
          onClick={closeVerse}
          aria-label="Close verse popup"
          title="Close"
        >
          ×
        </button>
        {/* Identification: chapter, juz and verse, per the requirements */}
        <div className="border-b px-4 py-3 pr-14" style={{ borderColor: 'var(--border)' }}>
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
          <p
            dir="ltr"
            className="verse-popup-translation mt-2 border-t pt-2 text-left leading-normal"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-soft)' }}
          >
            {verse.translations?.[translationLanguage]}
          </p>
          <div className="mt-3 border-t pt-2.5" style={{ borderColor: 'var(--border)' }}>
            <p dir="rtl" className="mb-1 text-right text-xs font-semibold" style={{ color: 'var(--accent)' }}>
              {getTafsirEdition(tafsirEdition).label}
            </p>
            <p
              dir="rtl"
              className="whitespace-pre-line text-right text-[15px] leading-relaxed"
              style={{ color: 'var(--ink)' }}
            >
              {tafsir.loading
                ? 'جارٍ تحميل المعنى…'
                : tafsir.error
                  ? 'تعذر تحميل المعنى الآن.'
                  : tafsir.text || 'لا يوجد شرح مختصر لهذه الآية.'}
            </p>
          </div>
        </div>

        {assigned.length ? (
          <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
            <p
              className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--ink-soft)' }}
            >
              Added to {assigned.length === 1 ? 'collection' : `${assigned.length} collections`}
            </p>
            <div className="space-y-1">
              {assigned.map((category) => (
                <button
                  key={category.id}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  onClick={() => {
                    const qa = category.description === '__quran_categories_qa__';
                    (qa ? setOpenQaCategory : setOpenCategory)(category.id);
                    setMobilePane(qa ? 'qa' : 'categories');
                    closeVerse();
                  }}
                  title="Open topic"
                >
                  <span className="shrink-0">▤</span>
                  <span dir="auto" className="min-w-0 flex-1 truncate">
                    {categoryPath(category, cats ?? [])}
                  </span>
                  <span aria-hidden>›</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-3 gap-1 p-2">
          <Action onClick={() => openAssign(verse.key, 'topics')}>
            ▤ Topic{assignedTopics.length ? ` (${assignedTopics.length})` : ''}
          </Action>
          {/* The touchscreen equivalent of shift-click: mark this verse as the
              start, then the next verse tapped closes the range. */}
          <Action onClick={() => startRange(verse.key)}>⇥ Range to</Action>
          <Action onClick={() => openAssign(verse.key, 'qa')}>
            ? Q/A{assignedQa.length ? ` (${assignedQa.length})` : ''}
          </Action>
          <Action onClick={() => openNote(verse.key)}>
            {note && note.deletedAt === null && note.contentText.trim() ? '✎ Edit note' : '✎ Note'}
          </Action>
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
          <Action onClick={() => setCopyOptionsOpen((open) => !open)}>⧉ Copy</Action>
          <Action onClick={() => { void createImage(); }}>
            {exportingImage ? 'Creating…' : '▣ Image'}
          </Action>
        </div>

        {copyOptionsOpen ? (
          <div className="grid grid-cols-2 gap-2 border-t px-3 py-3" style={{ borderColor: 'var(--border)' }}>
            <button className="btn btn-ghost text-xs" onClick={() => { void copy(false); }}>
              Arabic only
            </button>
            <button className="btn btn-primary text-xs" onClick={() => { void copy(true); }}>
              Arabic + translation
            </button>
          </div>
        ) : null}

        <DragGrip verseKey={verse.key} verseId={verse.id} />
      </div>
    </>
  );
}

function categoryPath(category: Category, categories: Category[]): string {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const names = [category.name];
  const visited = new Set([category.id]);
  let parentId = category.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return names.join(' › ');
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
      className="verse-popup-drag-grip flex cursor-grab items-center justify-center gap-2 border-t py-2.5 text-[11px] active:cursor-grabbing"
      style={{
        borderColor: 'var(--border)',
        color: 'var(--ink-soft)',
        background: 'var(--surface-2)',
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
      }}
      title="Drag into a topic"
      aria-label="Drag verse into a topic"
    >
      <span style={{ letterSpacing: '0.2em' }}>⠿</span>
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
  const tabletPortrait = window.matchMedia('(pointer: coarse) and (min-width: 600px) and (max-width: 1023px)').matches;
  const w = tabletPortrait ? window.innerWidth - 24 : Math.min(416, window.innerWidth - 24);
  const left = Math.min(Math.max(12, anchor.x - w / 2), window.innerWidth - w - 12);
  return { left, top: '50%', transform: 'translateY(-50%)' };
}

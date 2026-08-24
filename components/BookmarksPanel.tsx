'use client';

import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Bookmark, Meta, Note, Verse } from '@/lib/types';
import { getVersesByKeys, listBookmarks, listNotes, removeBookmark } from '@/lib/db/repo';
import { useUI } from '@/lib/store';
import { PanelHeader } from '@/components/SettingsPanel';

export default function BookmarksPanel({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const { jumpTo, setMobilePane, openNote, showToast } = useUI();
  const [tab, setTab] = useState<'bookmarks' | 'notes'>('bookmarks');

  const bookmarks = useLiveQuery(() => listBookmarks(), [], [] as Bookmark[]);
  const notes = useLiveQuery(() => listNotes(), [], [] as Note[]);
  const [verses, setVerses] = useState<Map<string, Verse>>(new Map());

  useEffect(() => {
    const keys = [
      ...new Set([...(bookmarks ?? []).map((b) => b.verseKey), ...(notes ?? []).map((n) => n.verseKey)]),
    ];
    if (!keys.length) return;
    let live = true;
    getVersesByKeys(keys).then((rows) => live && setVerses(new Map(rows.map((v) => [v.key, v]))));
    return () => {
      live = false;
    };
  }, [bookmarks, notes]);

  const sortedNotes = [...(notes ?? [])].sort(
    (a, b) => (verses.get(a.verseKey)?.id ?? 0) - (verses.get(b.verseKey)?.id ?? 0)
  );

  const go = (key: string) => {
    const v = verses.get(key);
    if (v) {
      jumpTo(v.page);
      setMobilePane('reader');
    }
  };

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Saved" onClose={onClose} />
      <div className="flex shrink-0 gap-1 border-b p-2" style={{ borderColor: 'var(--border)' }}>
        {(
          [
            ['bookmarks', `Bookmarks (${(bookmarks ?? []).length})`],
            ['notes', `Notes (${(notes ?? []).length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className="btn btn-ghost flex-1 text-[12px]"
            style={tab === id ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="scroll-y flex-1">
        {tab === 'bookmarks' ? (
          (bookmarks ?? []).length ? (
            (bookmarks ?? []).map((b) => {
              const v = verses.get(b.verseKey);
              const s = v ? meta.surahs.find((x) => x.number === v.surah) : null;
              return (
                <div
                  key={b.id}
                  className="group flex items-start gap-2 border-b px-3 py-2.5"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span
                    className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: b.color }}
                  />
                  <button className="min-w-0 flex-1 text-left" onClick={() => go(b.verseKey)}>
                    <span className="flex items-baseline gap-2">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                        {s?.nameSimple} {v?.ayah}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--ink-soft)' }}>
                        Juz {v?.juz} · p.{v?.page}
                      </span>
                    </span>
                    <span
                      dir="rtl"
                      className="mt-0.5 line-clamp-2 block text-[15px] leading-loose"
                      style={{ fontFamily: "'Scheherazade New', serif" }}
                    >
                      {v?.text ?? '…'}
                    </span>
                  </button>
                  <button
                    className="btn btn-ghost h-7 min-h-0 shrink-0 px-1.5 text-[11px] opacity-0 transition group-hover:opacity-100"
                    style={{ color: '#b4483f' }}
                    onClick={async () => {
                      await removeBookmark(b.id);
                      showToast('Bookmark removed');
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })
          ) : (
            <Empty text="No bookmarks yet. Tap a verse and choose ⚑ Bookmark." />
          )
        ) : sortedNotes.length ? (
          sortedNotes.map((n) => {
            const v = verses.get(n.verseKey);
            const s = v ? meta.surahs.find((x) => x.number === v.surah) : null;
            return (
              <button
                key={n.id}
                className="block w-full border-b px-3 py-2.5 text-left"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => openNote(n.verseKey)}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                    {s?.nameSimple} {v?.ayah}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--ink-soft)' }}>
                    p.{v?.page}
                  </span>
                </span>
                <span className="mt-0.5 line-clamp-3 block text-xs" style={{ color: 'var(--ink-soft)' }}>
                  {n.contentText}
                </span>
              </button>
            );
          })
        ) : (
          <Empty text="No notes yet. Tap a verse and choose ✎ Add note." />
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="mx-auto max-w-[20rem] p-10 text-center text-sm" style={{ color: 'var(--ink-soft)' }}>
      {text}
    </p>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MiniSearch from 'minisearch';
import type { Meta, Verse } from '@/lib/types';
import { db } from '@/lib/db/schema';
import { listCategories, listNotes } from '@/lib/db/repo';
import { normalizeArabic } from '@/lib/search/normalize';
import { useUI } from '@/lib/store';
import { PanelHeader } from '@/components/SettingsPanel';

type Hit =
  | { kind: 'verse'; verse: Verse; score: number }
  | { kind: 'note'; verseKey: string; text: string; score: number }
  | { kind: 'category'; id: string; name: string; score: number };

let quranIndex: MiniSearch<{ id: number; key: string; simple: string }> | null = null;
let indexBuilding: Promise<void> | null = null;

/**
 * Builds the Quran index once per session.
 *
 * Indexing 6,236 verses takes a moment, so it happens on first search rather
 * than at boot — the reader should not wait for it.
 */
async function ensureIndex(onProgress?: (s: string) => void) {
  if (quranIndex) return;
  if (indexBuilding) return indexBuilding;
  indexBuilding = (async () => {
    onProgress?.('Preparing search…');
    const verses = await db().verses.toArray();
    const mi = new MiniSearch<{ id: number; key: string; simple: string }>({
      fields: ['simple'],
      storeFields: ['key'],
      searchOptions: { prefix: true, fuzzy: 0.1, combineWith: 'AND' },
    });
    mi.addAll(verses.map((v) => ({ id: v.id, key: v.key, simple: v.simple })));
    quranIndex = mi;
  })();
  return indexBuilding;
}

export default function SearchPanel({ meta, onClose }: { meta: Meta; onClose: () => void }) {
  const { jumpTo, setMobilePane, openNote, setOpenCategory } = useUI();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<'all' | 'quran' | 'mine'>('all');
  const [hits, setHits] = useState<Hit[]>([]);
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    void ensureIndex(setStatus).then(() => setStatus(''));
  }, []);

  useEffect(() => {
    const term = q.trim();
    const mine = ++seq.current;
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(async () => {
      await ensureIndex(setStatus);
      setStatus('');
      if (seq.current !== mine) return;

      const out: Hit[] = [];

      if (scope !== 'mine' && quranIndex) {
        // Normalize the query with exactly the function the corpus was built
        // with. If these ever diverge, search silently returns nothing.
        const needle = normalizeArabic(term);
        if (needle) {
          const raw = quranIndex.search(needle).slice(0, 80);
          const keys = raw.map((r) => (r as unknown as { key: string }).key);
          const verses = await db().verses.where('key').anyOf(keys).toArray();
          const byKey = new Map(verses.map((v) => [v.key, v]));
          raw.forEach((r) => {
            const v = byKey.get((r as unknown as { key: string }).key);
            if (v) out.push({ kind: 'verse', verse: v, score: r.score });
          });
        }
      }

      if (scope !== 'quran') {
        const lower = term.toLowerCase();
        const [notes, cats] = await Promise.all([listNotes(), listCategories()]);
        notes
          .filter((n) => n.contentText.toLowerCase().includes(lower))
          .slice(0, 40)
          .forEach((n) => out.push({ kind: 'note', verseKey: n.verseKey, text: n.contentText, score: 5 }));
        cats
          .filter((c) => c.name.toLowerCase().includes(lower))
          .slice(0, 20)
          .forEach((c) => out.push({ kind: 'category', id: c.id, name: c.name, score: 4 }));
      }

      if (seq.current === mine) setHits(out);
    }, 220);
    return () => window.clearTimeout(t);
  }, [q, scope]);

  const grouped = useMemo(() => {
    return {
      verses: hits.filter((h) => h.kind === 'verse') as Extract<Hit, { kind: 'verse' }>[],
      notes: hits.filter((h) => h.kind === 'note') as Extract<Hit, { kind: 'note' }>[],
      categories: hits.filter((h) => h.kind === 'category') as Extract<Hit, { kind: 'category' }>[],
    };
  }, [hits]);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Search" onClose={onClose} />

      <div className="shrink-0 space-y-2 border-b p-3" style={{ borderColor: 'var(--border)' }}>
        <input
          ref={inputRef}
          className="field"
          placeholder="Search the Quran, your notes and categories…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-1">
          {(
            [
              ['all', 'Everything'],
              ['quran', 'Quran'],
              ['mine', 'My notes'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className="btn btn-ghost flex-1 px-2 py-1 text-[11px]"
              style={scope === id ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
              onClick={() => setScope(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>
          {status ||
            (q.trim().length >= 2
              ? `${hits.length} result${hits.length === 1 ? '' : 's'}`
              : 'Arabic matches ignore vowel marks — type الرحمن to find ٱلرَّحۡمَٰنِ.')}
        </p>
      </div>

      <div className="scroll-y flex-1">
        {grouped.categories.length ? (
          <Group title="Categories">
            {grouped.categories.map((h) => (
              <button
                key={h.id}
                className="flex w-full items-center gap-2 border-b px-4 py-2.5 text-left"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => {
                  setOpenCategory(h.id);
                  setMobilePane('categories');
                }}
              >
                <span className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>▤</span>
                <span dir="auto" className="truncate text-sm">{h.name}</span>
              </button>
            ))}
          </Group>
        ) : null}

        {grouped.notes.length ? (
          <Group title="Your notes">
            {grouped.notes.map((h) => (
              <button
                key={h.verseKey}
                className="block w-full border-b px-4 py-2.5 text-left"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => openNote(h.verseKey)}
              >
                <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                  {h.verseKey}
                </span>
                <span className="mt-0.5 line-clamp-2 block text-xs" style={{ color: 'var(--ink-soft)' }}>
                  {h.text}
                </span>
              </button>
            ))}
          </Group>
        ) : null}

        {grouped.verses.length ? (
          <Group title="Quran">
            {grouped.verses.map((h) => {
              const s = meta.surahs.find((x) => x.number === h.verse.surah);
              return (
                <button
                  key={h.verse.key}
                  className="block w-full border-b px-4 py-2.5 text-left"
                  style={{ borderColor: 'var(--border)' }}
                  onClick={() => {
                    jumpTo(h.verse.page);
                    setMobilePane('reader');
                  }}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--accent)' }}>
                      {s?.nameSimple} {h.verse.ayah}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--ink-soft)' }}>
                      Juz {h.verse.juz} · p.{h.verse.page}
                    </span>
                  </span>
                  <span
                    dir="rtl"
                    className="mt-0.5 line-clamp-3 block text-[15px] leading-loose"
                    style={{ fontFamily: "'Scheherazade New', serif" }}
                  >
                    {h.verse.text}
                  </span>
                </button>
              );
            })}
          </Group>
        ) : null}

        {q.trim().length >= 2 && !hits.length && !status ? (
          <p className="p-8 text-center text-sm" style={{ color: 'var(--ink-soft)' }}>
            Nothing found for “{q}”.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3
        className="sticky top-0 z-10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide backdrop-blur"
        style={{ color: 'var(--ink-soft)', background: 'color-mix(in srgb, var(--surface) 88%, transparent)' }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

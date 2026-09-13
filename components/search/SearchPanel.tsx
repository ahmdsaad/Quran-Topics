'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MiniSearch from 'minisearch';
import type { Meta, Verse } from '@/lib/types';
import { db } from '@/lib/db/schema';
import { normalizeArabic } from '@/lib/search/normalize';
import { useUI } from '@/lib/store';

type Hit =
  | { kind: 'verse'; verse: Verse; score: number }
  | { kind: 'note'; verseKey: string; text: string; score: number }
  | { kind: 'category'; id: string; name: string; score: number };

let quranIndex: MiniSearch<{ id: number; key: string; simple: string }> | null = null;
let indexBuilding: Promise<void> | null = null;
const SEARCH_HISTORY_KEY = 'quran-search-history';
const SEARCH_HISTORY_LIMIT = 12;

type TextOffset = { start: number; end: number };

function normalizedTextWithOffsets(text: string) {
  let normalized = '';
  const offsets: TextOffset[] = [];

  for (let index = 0; index < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(index)!);
    const end = index + character.length;
    if (/\s/u.test(character)) {
      if (normalized && !normalized.endsWith(' ')) {
        normalized += ' ';
        offsets.push({ start: index, end });
      }
      index = end;
      continue;
    }
    const value = normalizeArabic(character);

    if (!value && offsets.length) {
      offsets[offsets.length - 1].end = end;
    }
    for (const normalizedCharacter of value) {
      normalized += normalizedCharacter;
      offsets.push({ start: index, end });
    }
    index = end;
  }

  return { normalized, offsets };
}

function HighlightedSearchText({ text, query }: { text: string; query: string }) {
  const needles = normalizeArabic(query).split(' ').filter(Boolean);
  if (!needles.length) return text;

  const { normalized, offsets } = normalizedTextWithOffsets(text);
  const ranges: TextOffset[] = [];
  needles.forEach((needle) => {
    let searchFrom = 0;
    while (searchFrom < normalized.length) {
      const matchStart = normalized.indexOf(needle, searchFrom);
      if (matchStart === -1) break;
      const matchEnd = matchStart + needle.length;
      const first = offsets[matchStart];
      const last = offsets[matchEnd - 1];
      if (first && last) ranges.push({ start: first.start, end: last.end });
      searchFrom = matchEnd;
    }
  });

  if (!ranges.length) return text;

  const mergedRanges = ranges
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce<TextOffset[]>((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        merged.push({ ...range });
      }
      return merged;
    }, []);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  mergedRanges.forEach((range, index) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <mark
        key={`${range.start}-${range.end}-${index}`}
        className="rounded-[0.2em] px-[0.06em] text-inherit"
        style={{ background: '#fff0a8' }}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return parts;
}

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

export default function SearchPanel({
  meta,
  onVerseResult,
  selectedVerseKey,
  recentSearchFontSize,
}: {
  meta: Meta;
  onVerseResult: (verse: Verse) => void;
  selectedVerseKey?: string | null;
  recentSearchFontSize: number;
}) {
  const { jumpTo, setMobilePane, openNote, setOpenCategory } = useUI();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [status, setStatus] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [editingHistory, setEditingHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    try {
      const saved = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) ?? '[]');
      if (Array.isArray(saved)) {
        setHistory(saved.filter((item): item is string => typeof item === 'string').slice(0, SEARCH_HISTORY_LIMIT));
      }
    } catch {
      localStorage.removeItem(SEARCH_HISTORY_KEY);
    }
    void ensureIndex(setStatus).then(() => setStatus(''));
  }, []);

  const rememberSearch = (value = q) => {
    const keyword = value.trim();
    if (keyword.length < 2) return;
    setHistory((current) => {
      const next = [keyword, ...current.filter((item) => item.toLocaleLowerCase() !== keyword.toLocaleLowerCase())]
        .slice(0, SEARCH_HISTORY_LIMIT);
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  };

  const removeSearch = (keyword: string) => {
    setHistory((current) => {
      const next = current.filter((item) => item !== keyword);
      localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
      if (!next.length) setEditingHistory(false);
      return next;
    });
  };

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

      if (quranIndex) {
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

      if (seq.current === mine) setHits(out);
    }, 220);
    return () => window.clearTimeout(t);
  }, [q]);

  const grouped = useMemo(() => {
    return {
      verses: hits.filter((h) => h.kind === 'verse') as Extract<Hit, { kind: 'verse' }>[],
      notes: hits.filter((h) => h.kind === 'note') as Extract<Hit, { kind: 'note' }>[],
      categories: hits.filter((h) => h.kind === 'category') as Extract<Hit, { kind: 'category' }>[],
    };
  }, [hits]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3"
        style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold">Search</h2>
        {history.length ? (
          <button className="btn btn-ghost px-2 py-1 text-xs"
            style={editingHistory ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : undefined}
            onClick={() => setEditingHistory((editing) => !editing)}>
            {editingHistory ? 'Done' : 'Edit'}
          </button>
        ) : null}
      </header>

      <div className="shrink-0 space-y-2 border-b p-3" style={{ borderColor: 'var(--border)' }}>
        <input
          ref={inputRef}
          className="field"
          placeholder="Search the whole Quran…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') rememberSearch();
          }}
        />
        {history.length ? (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-soft)' }}>
                Recent searches
              </span>
              <button
                className="text-[10px]"
                style={{ color: 'var(--ink-soft)' }}
                onClick={() => {
                  setHistory([]);
                  localStorage.removeItem(SEARCH_HISTORY_KEY);
                }}
              >
                Clear
              </button>
            </div>
            <div className="flex gap-1 overflow-x-auto pb-1">
              {history.map((keyword) => (
                <div key={keyword} className="flex shrink-0 overflow-hidden rounded-full border"
                  style={{ borderColor: editingHistory ? '#b4483f' : 'var(--border)', background: 'var(--surface)' }}>
                  <button className="px-2 py-1" style={{ fontSize: recentSearchFontSize }}
                    onClick={() => {
                      if (editingHistory) removeSearch(keyword);
                      else {
                        setQ(keyword);
                        rememberSearch(keyword);
                      }
                    }}>
                    {keyword}
                  </button>
                  {editingHistory ? (
                    <button className="flex min-h-8 min-w-8 items-center justify-center border-s text-base"
                      style={{ borderColor: '#e1b4af', color: '#b4483f' }}
                      aria-label={`Remove recent search ${keyword}`}
                      onClick={() => removeSearch(keyword)}>
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <p className="text-[11px]" style={{ color: 'var(--ink-soft)' }}>
          {status ||
            (q.trim().length >= 2
              ? `${hits.length} result${hits.length === 1 ? '' : 's'}`
              : 'Arabic matches ignore vowel marks — type الرحمن to find ٱلرَّحۡمَٰنِ.')}
        </p>
      </div>

      <div className="scroll-y flex-1">
        {grouped.categories.length ? (
          <Group title="Topics">
            {grouped.categories.map((h) => (
              <button
                key={h.id}
                className="flex w-full items-center gap-2 border-b px-4 py-2.5 text-left"
                style={{ borderColor: 'var(--border)' }}
                onClick={() => {
                  rememberSearch();
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
                onClick={() => {
                  rememberSearch();
                  openNote(h.verseKey);
                }}
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
                  style={h.verse.key === selectedVerseKey
                    ? {
                        borderColor: 'var(--border)',
                        background: 'var(--accent-soft)',
                        boxShadow: 'inset 3px 0 0 var(--accent)',
                      }
                    : { borderColor: 'var(--border)' }}
                  aria-current={h.verse.key === selectedVerseKey ? 'true' : undefined}
                  onClick={() => {
                    rememberSearch();
                    onVerseResult(h.verse);
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
                    <HighlightedSearchText text={h.verse.text} query={q} />
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

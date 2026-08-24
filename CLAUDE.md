@AGENTS.md

# Quran Classification

Tablet-first Next.js app: page-perfect Mushaf reader, verse annotation, infinitely
nested categories. Everything runs in the browser against IndexedDB — no server,
no account, works offline after first load.

**Read `docs/PROJECT_STATE.md` before describing status or planning work.** It is
the source of truth and is updated at the end of each session. `docs/ARCHITECTURE.md`
and `docs/DATA_MODEL.md` have the reasoning behind the structure.

## Running it

```bash
npm install
npm run setup     # once: downloads Mushaf layout + 604 page fonts, builds the corpus
npm run dev       # http://localhost:3000   (dev:lan to reach it from a tablet)
```

`npm run setup` writes `.cache/`, `public/fonts/v1/` (48 MB) and `public/data/`
(7 MB) — all git-ignored and regenerable, none of it committed. It is resumable:
re-run it if it stops partway. `npm run build` runs it automatically via `prebuild`.

The corpus is a **build artifact, not a runtime dependency** — nothing fetches the
Quran at runtime. If `public/data` is missing, run `npm run setup`, don't add a
fetch.

## Five things that will bite you

1. **No component touches Dexie directly.** Reads go through `useLiveQuery` on a
   function in `lib/db/repo.ts`; writes go through a function there, which stamps
   the sync envelope and appends to `outbox` in the same transaction. That is what
   makes cloud sync (Phase 7) an addition rather than a rewrite. Do not bypass it
   for "just one quick query".

2. **Lines, not verses, are the unit of page layout.** Verses straddle lines and
   pages. Any renderer that iterates verses to build a page is wrong. Pages 1 and
   2 carry 8 lines, not 15 — read the count from the data, never hard-code it.

3. **QPC glyph codes must be injected with `innerHTML`** (React:
   `dangerouslySetInnerHTML`). They are Arabic Presentation Forms codepoints
   (U+FB50–U+FDFF) scoped to a single page's font; `textContent` renders entirely
   different characters. They are *not* Private Use Area — that is QCF v4.

4. **Never write `el.style.fontSize` during a measure pass.** React owns that
   property; clearing it after a probe wipes the value React just set and the fit
   silently never applies. `components/mushaf/MushafPage.tsx` measures at the
   current size and scales — the relation is linear, so one pass lands it.

5. **`lib/search/normalize.ts` is shared with `scripts/build-corpus.mjs`.** The
   corpus is normalized at build time with the same rules the query uses. If the
   two drift, search silently returns nothing rather than erroring. Use `\uXXXX`
   escapes in the character classes — an early draft used a literal range that
   deleted real Arabic letters from U+06EE onward.

## Upstream data is not trustworthy

`zonetecde/mushaf-layout` labels each `surah-header` line with the *preceding*
surah (page 76 line 15 is An-Nisa's header, labelled "آل عمران"), giving 13
duplicated surahs and 17 with none, and drops three lines each from pages 586 and
590. `scripts/build-corpus.mjs` therefore **discards every source header and
basmala line** and re-derives all 114 + 112 from verse data, then validates.
Do not "restore" the source values.

## Verifying changes

There is no test runner yet. The reader is visual and the interactions are
gestural, so check work in a real browser — and for drag-and-drop, with real
drags: two bugs in that code were completely silent (no error, the tree just
didn't change). Drag activation is press-and-hold 200 ms / 8 px tolerance, so a
scripted drag must hold before moving.

## Not built

Google auth, cross-device sync, public share URLs. The schema is already shaped
for them; `docs/ARCHITECTURE.md` §9 has the intended design.

**Licensing gate:** the QPC fonts are King Fahd Glorious Quran Printing Complex
copyright, not open source. Resolve redistribution terms before any public
hosting or app-store build.

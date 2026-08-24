# Quran Classification

A tablet-first web app for reading the Quran in a page-perfect Mushaf layout,
annotating verses with rich media, and organising them into an arbitrarily deep
tree of categories. Everything runs locally in the browser — no account, no
server, no network after first load.

## Run it

```bash
npm install
npm run setup     # downloads the Mushaf layout + fonts, builds the corpus (~2 min)
npm run dev       # http://localhost:3000
```

`npm run setup` is only needed once. It writes to `.cache/` (layout source),
`public/fonts/v1/` (604 page fonts, 48 MB) and `public/data/` (the built corpus,
7 MB) — all git-ignored, all regenerable. `npm run build` re-runs it
automatically, so a clean CI or Vercel build needs no extra step.

## What's here

| Area | Where |
|---|---|
| Mushaf page renderer | `components/mushaf/MushafPage.tsx` |
| 604-page virtual scroll | `components/mushaf/Reader.tsx` |
| Data model + all writes | `lib/db/repo.ts`, `lib/db/schema.ts` |
| Category tree, drag and drop | `components/categories/`, `components/dnd/` |
| Arabic search normalisation | `lib/search/normalize.ts` |
| Corpus build | `scripts/build-corpus.mjs` |

## Three rules the code depends on

1. **No component touches Dexie directly.** Reads go through `useLiveQuery` on a
   function in `lib/db/repo.ts`; writes go through a function there, which stamps
   the sync envelope and appends to `outbox` in the same transaction. That is
   what makes cloud sync an addition later rather than a rewrite.

2. **Lines, not verses, are the unit of page layout.** Verses straddle lines and
   pages. Any renderer that iterates verses to build a page is wrong. Pages 1–2
   carry 8 lines, not 15 — never hard-code the count.

3. **QPC glyph codes go in via `innerHTML`.** They are Arabic Presentation Forms
   codepoints scoped to a single page's font; `textContent` renders the wrong
   characters. The real Unicode text lives alongside them for copy, search and
   export.

## Mushaf editions

Ships with **QPC v1** (King Fahd Complex 1405H), fetched at build time — about
80 KB per page, nothing committed.

**QPC v2** (1423H) is sharper but is only published as TTF, so it must be
converted locally:

```bash
git clone --depth 1 https://github.com/nuqayah/qpc-fonts /tmp/qpc-fonts
QPC_SRC=/tmp/qpc-fonts/mushaf-v2 npm run fonts:v2      # ~116 MB out
NEXT_PUBLIC_MUSHAF_EDITION=v2 npm run dev
```

The corpus carries glyph codes for both, so switching is config only.

> **Licensing gate.** The QPC fonts are King Fahd Glorious Quran Printing Complex
> copyright, not open source. Confirm redistribution terms for your distribution
> model before shipping publicly or to an app store.

## Not built yet

Google auth, cross-device sync, and public share URLs. The schema is already
shaped for them (`SyncEnvelope` + `outbox` on every user table); see
`docs/ARCHITECTURE.md` §9.

# PROJECT STATE

**Source of truth for project status. Trust this file over memory.**
Update at the end of every working session.

- **Last updated:** 2026-08-24
- **Current phase:** Phases 0–6 built and running locally. Not deployed.
- **Repo state:** source in `Desktop/quran-classification`, no git repo initialised yet.
  `.gitignore` now actually excludes `.cache/`, `public/data/` and `public/fonts/`
  — it previously did not, so a first `git add .` would have committed the
  licence-gated QPC fonts.

---

## Where things stand

The app is built and verified in a browser. It runs locally; there is no public
URL and no git remote yet.

```bash
npm install
npm run setup     # fetches Mushaf layout + fonts, builds the corpus (~3 min, once)
npm run dev       # http://localhost:3000
```

`npm run setup` writes to `.cache/`, `public/fonts/v1/` (48 MB) and
`public/data/` (7 MB) — all git-ignored and regenerable. `npm run build` runs it
automatically via `prebuild`.

**Verified in Chromium** (1366×1024 and iPad 1024×1366): create category, tap
verse → action sheet with surah/juz/page, bookmark → verse tints in the reader,
assign to category, category detail lists the verse, note editor saves,
unvocalised Arabic search (`الرحمن` → 68 verse hits), note search, bookmarks
panel, jump to 2:255 → lands on page 42, and everything survives a reload.
Word export produces a valid .docx with nested headings and RTL Arabic runs.

---

## What was built

| SRS section | Status |
|---|---|
| §2 Reading interface | ✅ 604 pages, vertical scroll, jump to surah/verse/page/juz, resume position, multiple coloured bookmarks with highlighting |
| §3 Verse management | ✅ Tap → action sheet, Tiptap notes with links + YouTube, marked verses tinted, surah/juz/verse shown. Selection is whole-verse and multi-verse: shift-click or “Select range from here” selects a passage across lines, surahs and pages, and files it into a category in one action |
| §4 Categories | ✅ Infinite nesting, accordion, expand/collapse all, multi-category assignment, Quran-order vs manual order |
| §5 Search | ✅ Offline, Arabic-normalised, grouped across Quran / notes / categories |
| §5 Google auth + sync | ❌ Phase 7 — schema is ready (`SyncEnvelope` + `outbox` on every user table) |
| §6 Dual layout | ✅ Categories left, Quran right at ≥1024px; tabbed single pane below |
| §6 Drag and drop | ✅ Verse → category, reorder within a category, re-parent categories (dnd-kit, 200 ms/8 px activation) |
| §7 Word/Excel export | ✅ Both verified end to end in a real browser: file downloads, opens, and carries Arabic. Excel was in fact broken — see below |
| §7 Public share URL | ❌ Phase 7 — needs a server |

Beyond the SRS: light/sepia/dark themes, page-size control, JSON backup and
restore (there is no account yet, so an export is the only safety net), and a
PWA manifest so it installs to an iPad home screen.

---

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Framework | Next.js 16 + React 19 + TS + Tailwind 4 | Tablet PWA story; server available when Phase 7 needs it |
| Backend | None — IndexedDB (Dexie) | Ships faster; sync envelope means no rewrite later |
| Mushaf edition | **QPC v1** (1405H) by default | Only edition published as WOFF2, so it can be fetched at build time. v2 (1423H) is sharper but TTF-only → 116 MB after local conversion; `npm run fonts:v2` + `NEXT_PUBLIC_MUSHAF_EDITION=v2` switches. Corpus ships glyph codes for both. |
| Type sizing | Measured per page, not fixed | A printed Mushaf line fills its measure. Measure the page's widest line, solve for the size that fills it, apply to the whole page. Per-line fitting would balloon a short closing line. |
| Page size | Fits the viewport height by default | Reading a Mushaf is page-at-a-time, not a scrolling ribbon. The size slider scales up from there. |
| Drag & drop | `@dnd-kit` over `pragmatic-drag-and-drop` | Pragmatic's touch reliability is community-disputed and unaddressed through v3.0.0 |
| Ordering | Fractional indexing | One write per drag; merges cleanly when sync arrives |
| Corpus | Static build artifact | Avoids the Quran Foundation API's OAuth + approval + network dependency |

---

## Things that bit us — do not re-learn these

- **The upstream layout dataset mislabels surah headers.** `zonetecde/mushaf-layout`
  tags each `surah-header` line with the *preceding* surah (page 76 line 15 is
  An-Nisa's header, labelled "آل عمران"), yielding 13 duplicated surahs and 17
  with no header. It also drops three lines each from pages 586 and 590. The
  build now **discards every source header/basmala line** and re-derives them
  from verse data: 114 headers, 112 basmala, validated. Cost: a header sometimes
  lands at the top of the surah's first page where print floats it to the foot of
  the previous one, so 21 pages carry 16 lines and 21 carry 14.
- **A verse is the unit of selection but never a single element.** It is a run of
  word spans, usually split across lines and often across pages. Highlighting it
  with a background per word reads as a row of disconnected chips, because a
  justified line is a `space-between` flex row whose gaps belong to the line and
  cannot be covered by any word. `MushafPage` therefore measures the word rects
  and paints one band per (verse × line) behind the text — which is also what
  makes a multi-verse range read as one continuous mark. Anything that tries to
  style selection onto the words themselves will look wrong at the gaps.
- **`write-excel-file` v4 changed its API, and a type cast hid it.** v4 dropped
  `schema` for `columns` and now always returns `{ toBlob, toFile }` rather than
  varying its return by option. The call site still used the v3 `schema` shape
  and was cast to `(...) => Promise<Blob>`, so the compiler could not see the
  mismatch and `URL.createObjectURL` threw on every single export. The export had
  never worked. Casting an external API to the shape you expect removes the one
  check that would have caught the upgrade.
- **A category's expanded/collapsed flag is view state, not user data.** It used
  to go through `updateCategory`, which stamps a revision and logs a sync op per
  row: six clicks on a 140-category tree wrote 840 outbox entries and would have
  synced one device's twirl state onto another. `setCategoriesExpanded` now
  writes the whole set in one transaction, without the envelope or the outbox.
- **`direction: rtl` and `flex-direction: row-reverse` do not compose — they cancel.**
  `.mushaf-line` carried both, so the main axis ran left-to-right and every line
  was painted with its words in reverse order: page 1 line 1 read
  `ٱلرَّحِيمِ ٱلرَّحْمَٰنِ ٱللَّهِ بِسْمِ`. The corpus was never wrong — page JSON, verse text
  and per-surah counts all validated — the layout mirrored correct data at paint
  time, which is why every build check passed. In an RTL container use
  `flex-direction: row`. `build-corpus.mjs` now also asserts that every verse
  reconstructs exactly from its page words, so an ordering fault in the data
  cannot pass silently either.
- **QPC glyph codes are Arabic Presentation Forms (U+FB50–U+FDFF), not Private
  Use Area.** PUA is QCF v4, a different scheme. They must be injected with
  `innerHTML`; `textContent` renders the wrong characters.
- **Do not write `el.style.fontSize` during a measure pass.** React owns that
  property; clearing it after a probe wipes the value React just set and the fit
  never applies. Measure at the current size and scale — the relation is linear.
- **The Arabic normalizer must use `\uXXXX` escapes.** An early draft used a
  literal range that silently deleted real Arabic letters from U+06EE onward.
  Fixtures in `docs/ARCHITECTURE.md` §6 guard this.
- **jsDelivr answers bursts with 403, not 429**, and a 403 is indistinguishable
  from a missing file. `scripts/fetch-sources.mjs` sweeps repeatedly with backoff
  and fails loudly rather than leaving blank pages.
- **`write-excel-file` never attaches its download anchor to the document**, so
  some browsers ignore it. The exporter takes a Blob and downloads it itself.
- **StarterKit v3 bundles Link** — registering `@tiptap/extension-link`
  separately warns about a duplicate and can drop marks.
- Pages 1 and 2 have 8 lines, not 15. Never hard-code the count.

---

## Blockers and gates

| Item | Impact | Status |
|---|---|---|
| **QPC font licensing** | King Fahd Complex copyright, not open source. Blocks app-store distribution; may constrain public web hosting | ❗ Unresolved — read the QUL terms of use |
| Excel export download | ~~Unverified~~ — was throwing on every attempt | ✅ Fixed and verified: valid .xlsx, 8 columns, Arabic intact |
| Deployment | No git remote, no public URL | Session's GitHub token is scoped to existing repos only. Create a repo, then push and connect Vercel. |

---

## Next up

1. Run it locally and use it properly on the iPad — the interactions want real
   fingers, especially the 200 ms drag threshold.
2. Resolve font licensing before anything public.
3. Phase 7: Google auth, Postgres mirror with RLS, outbox drain, `/s/{slug}`
   share pages. `docs/ARCHITECTURE.md` §9 has the shape.

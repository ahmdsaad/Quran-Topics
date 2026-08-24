# Architecture

> Status: proposed, not yet implemented. Last updated 2026-08-24.
> Companion docs: [DATA_MODEL.md](./DATA_MODEL.md), [PROJECT_STATE.md](./PROJECT_STATE.md)

## 0. What this app is

A tablet-first web app for reading the Quran in a page-perfect Mushaf layout,
annotating verses with rich media, and organising verses into an arbitrarily deep
tree of categories. Everything works offline. Cloud sync, Google auth, and public
share links come later, but the schema is built for them from day one.

**Locked decisions** (2026-08-24):

| Decision | Choice |
|---|---|
| Framework | Next.js 16 + React 19 + TypeScript + Tailwind 4 |
| Data | Local-only for now — IndexedDB via Dexie, sync-ready schema |
| Mushaf rendering | Page-perfect, QPC v2 per-page glyph fonts |
| Primary device | Tablet (portrait single-pane, landscape dual-pane) |

---

## 1. Stack

All versions verified on npm 2026-08-24.

| Concern | Choice | Version | Notes |
|---|---|---|---|
| Framework | `next` | 16.3.2 | App Router. See §7 for the Turbopack caveat. |
| UI runtime | `react` / `react-dom` | 19.2.8 | |
| Styling | `tailwindcss` | 4.3.3 | |
| Local DB | `dexie` + `dexie-react-hooks` | 4.4.5 | `liveQuery` makes the dual-pane UI reactive with no state plumbing |
| UI state | `zustand` | 5.0.15 | Ephemeral only — open sheets, selection, pane split. Never persisted data. |
| Rich text | `@tiptap/react` + `starter-kit` + `extension-link` + `extension-youtube` | 3.30.3 | All MIT. Tiptap Pro is not needed. |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` | 6.3.1 / 10.0.0 | See §5 — this choice is load-bearing for tablet |
| Virtual scroll | `@tanstack/react-virtual` | 3.14.10 | 604 pages, fixed aspect ratio per page |
| Ordering | `fractional-indexing` | 4.0.0 | See DATA_MODEL §4 |
| IDs | `uuid` (v7) | 14.0.2 | Time-sortable, sync-friendly |
| Search | `minisearch` | 7.2.0 | ~1 MB index over 6,236 verses + notes, built client-side |
| Word export | `docx` | 9.7.1 | Runs in the browser, actively maintained |
| Excel export | `write-excel-file` | 4.1.1 | Browser-first. Chosen over `exceljs`, unmaintained since Dec 2024. |
| PWA | `@serwist/next` + `@serwist/turbopack` | 9.5.12 | Serwist 9 supports Turbopack — the old `--webpack` opt-out is obsolete (§7) |
| Native shell (later) | `@capacitor/core` | 8.5.0 | Phase 8, optional |

**Deliberately absent:** no backend, no ORM, no auth library, no state-management
framework beyond Zustand. Phase 1–6 ship as a static-capable Next app.

---

## 2. The corpus pipeline

The single most important structural decision: **the Quran is a build artifact,
not a runtime dependency.**

```
QUL (qul.tarteel.ai)                    build time                 runtime
┌──────────────────────┐          ┌────────────────────┐      ┌──────────────┐
│ mushaf-layout.sqlite │──────────▶│                    │      │              │
│  pages, words        │          │  scripts/build-     │      │  /public/    │
│                      │          │  corpus.ts          │─────▶│  data/*.json │
│ QPC v2 fonts         │──────────▶│                    │      │  fonts/*.woff2│
│  604 × woff2         │          │  (runs once,        │      │              │
└──────────────────────┘          │   output committed) │      └──────┬───────┘
                                  └────────────────────┘             │
                                                              first launch
                                                                     ▼
                                                              ┌──────────────┐
                                                              │  Dexie /     │
                                                              │  IndexedDB   │
                                                              └──────────────┘
```

**Why not the Quran Foundation API?** It requires OAuth2 client-credentials with
a server-held secret, new apps start in a pre-live sandbox pending approval, and
it is a network dependency. None of that fits an offline-first tablet app with no
backend. We take the same underlying data as static files instead.

**Sources:**

- Mushaf layout + word text: QUL mushaf-layout SQLite export (`pages` and `words`
  tables — schema in DATA_MODEL §1). Alternative: `zonetecde/mushaf-layout`,
  which ships 604 pre-built `page-NNN.json` files with `qpcV1`/`qpcV2` glyph
  codes already mapped.
- Fonts: QPC v2, 604 per-page files, WOFF2. Available from QUL's font resources
  or the `nuqayah/qpc-fonts` mirror.

**Output shape:** `/public/data/pages/{1..604}.json` (one fetch per page,
cache-friendly) plus `/public/data/index/{surahs,verses}.json` for navigation and
search. On first launch a bootstrap routine streams these into Dexie and flips a
`corpusVersion` flag; subsequent launches skip it.

**⚠️ Licensing — resolve before shipping.** The QPC fonts are King Fahd Glorious
Quran Printing Complex copyright, not open-source. QUL states its font resources
are "for web platforms only" and links separate terms of use. Read those terms
and confirm redistribution rights for your distribution model (web-only vs. an
app-store binary) before Phase 8. This is a real gate, not a formality.

---

## 3. Rendering a page

A Mushaf page is **15 lines**, and lines — not verses — are the unit of layout.
Verses straddle lines and pages; rendering verse-by-verse cannot reproduce the
printed page.

**Pages 1 and 2 are 8-line exceptions**, not 15 — Al-Fatihah and the opening of
Al-Baqarah are set larger. Never hard-code 15. Read the line count from
`pageLines`, and use page 1 as the first render target so the assumption cannot
creep in.

```
for each line in pageLines(page N):     # 15 lines — except pages 1 and 2, which have 8
  ├─ lineType 'surah_name'  → centered surah header (ornamental frame + name)
  ├─ lineType 'basmallah'   → centered basmallah glyph
  └─ lineType 'ayah'        → <div dir="rtl" class="justify-mushaf"
                                   style="font-family: 'p{N}-v2'">
                                 words[firstWordId..lastWordId]
                                   → <span data-verse-key data-word-id>
                               </div>
```

Four non-obvious rules:

1. **Each page needs its own font.** QPC v2 maps whole words to single glyphs and
   is cut per page — page 1's font contains only page 1's words. Load
   `p{N}-v2` on demand via the `FontFace` API; prefetch N±2 while scrolling;
   evict beyond a window of ~20 pages. (QCF **v4** abandons this scheme: 47 files
   plus a header font, with tajweed colouring baked in. Worth revisiting if the
   604-file payload proves painful — but v4 was still being proofread as of the
   last QUL note, so v2 is the safe choice today.)
2. **Glyph codes must be injected as `innerHTML`, not `textContent`**
   (React: `dangerouslySetInnerHTML`). `textContent` renders the wrong
   characters. The codes are **Arabic Presentation Forms-A** codepoints
   (U+FB50–U+FDFF) — page 1, page 300 and page 604 all begin at U+FC41, because
   each page reuses the same codepoints against its own font. They are *not*
   Private Use Area; that is QCF v4, a different scheme.
3. **Justification is the layout.** Mushaf lines are fully justified to a fixed
   measure. Use `text-align: justify` with `text-align-last: justify` on ayah
   lines, and center on the other two types. Verify per-line, not per-page.
4. **The visible text is not selectable text.** Native selection and browser
   Ctrl-F return glyph garbage. Provide an explicit *Copy verse* action backed
   by `verses.textUthmani`, and build in-app search over `textSimple`. Do not
   rely on browser text selection anywhere.

**Scroll and navigation.** Every page renders into a fixed-aspect-ratio box, so
total scroll height is deterministic and jump-to-page is arithmetic, not a
search. Jump-to-surah and jump-to-verse resolve through the `verses` index to a
page + line, then scroll to that line's offset. Reading position persists as
`{page, verseKey, scrollOffsetInPage}` — a 0–1 fraction, so resuming works across
screen sizes and orientations.

**Fallback path.** Until a page's font resolves, render `words[].textUthmani`
with a standard Uthmani webfont in the same line boxes. The layout shifts
slightly, then snaps. This also means the app degrades to readable — never
blank — if the font pipeline fails.

---

## 4. Layout modes

| Viewport | Layout |
|---|---|
| Tablet portrait (< 1024px) | Single pane. Reader full-screen; categories as a slide-over sheet. |
| Tablet landscape / desktop (≥ 1024px) | Dual pane — **categories left, Quran right**, per the SRS. Resizable split, persisted in settings. |
| Phone | Single pane, same as portrait. Not a target, but not broken. |

Both panes render the same components; the split is a layout concern, not a
separate code path. Drag-and-drop between panes (§5) only exists in dual mode.

**Verse interaction.** Tap a verse → action sheet anchored to the verse:
Add note · Bookmark · Add to category · Copy · Share · Play (future). The sheet
shows Surah name, Juz, and verse key for identification, as the SRS requires.
Long-press initiates drag instead (§5).

---

## 5. Drag and drop — why dnd-kit, specifically

The SRS needs three drag interactions, all primarily on a touchscreen:

1. Drag a verse from the reader into a category (cross-pane)
2. Reorder verses within a category
3. Reorder / re-parent categories in the tree

**Chosen: `@dnd-kit/core` 6.3.1 + `@dnd-kit/sortable` 10.0.0.**

The obvious modern alternative is Atlassian's `pragmatic-drag-and-drop` (3.0.0,
actively maintained, powers Jira and Trello). It was evaluated and **rejected on
touch risk**. Its README does claim "full feature support in Firefox, Safari and
Chrome, iOS and Android" — but it is built on native HTML5 drag events, and the
community experience contradicts the claim: the project's own *Mobile/Touch
Support?* discussion is still unanswered by maintainers, with users reporting
drops landing "about 10% of the time" and press-and-hold feeling too slow, most
recently confirmed Sept 2025. Reading the core changelog through 3.0.0 (Aug
2026), no release mentions touch, pointer events, or a touch adapter.

That is an unresolved, unacknowledged risk on the *only* input method this app
has. Not worth taking.

dnd-kit uses pointer events with a sensor abstraction, so touch is a first-class
input. Caveats, stated honestly:

- `@dnd-kit/core` has not published since Dec 2024. It is stable and widely
  deployed rather than abandoned, and its React peer range is `>=16.8`, so React
  19 is fine. The successor rewrite `@dnd-kit/react` is at 0.5.0 — pre-1.0, not
  yet a safe foundation. Revisit at its 1.0.
- Tree re-parenting is not built in. dnd-kit ships flat sortable primitives;
  nested-tree drop logic (depth from horizontal offset, collision against
  collapsed nodes) is ours to write. Budget for it.

**The tablet-critical detail:** drag and scroll compete for the same gesture.
Configure `PointerSensor` with
`activationConstraint: { delay: 200, tolerance: 8 }` so a short press scrolls and
a long press drags. Without this the reader is unusable — every scroll attempt
starts a drag. Test on real hardware before building on top of it.

Every drop resolves to exactly one fractional-index write (DATA_MODEL §4).

---

## 6. Search

Two scopes, one implementation, both fully offline.

**Arabic normalization is the whole problem.** A user typing `الرحمن` must match
`ٱلرَّحۡمَٰنِ`. Normalize both the corpus (at build time, into `verses.textSimple`)
and the query (at search time) with the same function:

```ts
export const normalizeArabic = (s: string) =>
  s.normalize('NFC')
   // Combining marks, in three blocks:
   //   U+0610-U+061A  honorific signs (the sallallahu-alayhi-wasallam mark etc.)
   //   U+064B-U+065F  tashkeel + additional Arabic marks
   //   U+06D6-U+06ED  Quranic annotation signs (incl. U+06DD end-of-ayah)
   .replace(/[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]/g, '')
   // U+0670 dagger alif (falls outside the range above); U+0640 tatweel, which
   // is a letter MODIFIER, not a combining mark - a 'strip category Mn' rule
   // silently misses it.
   .replace(/[\u0670\u0640]/g, '')
   .replace(/[\u0671\u0622\u0623\u0625]/g, '\u0627')  // alef variants -> alef
   .replace(/[\u0624\u0626]/g, '\u0621')                // hamza carriers -> hamza
   .replace(/\u0649/g, '\u064A')                         // alef maqsura -> ya
   .replace(/\s+/g, ' ')
   .trim();
```

Ship this as one exported function used by the build script and the query path.
If the two ever diverge, search silently returns nothing — write a test that
asserts round-trip on a fixture set of verses.

Use `\uXXXX` escapes, never literal Arabic inside character classes. Literal
ranges are unreviewable in a diff and easy to get wrong: an early draft of this
file carried `\u06EA-\u06FC`, which quietly deletes real Arabic letters
(U+06EE onwards) along with the marks it was aiming at. That bug produces no
error — just search results that are subtly, permanently wrong.

The function above was executed against these fixtures and passes; use them as
the Phase 4 test:

| Input | Expected |
|---|---|
| `بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ` | `بسم الله الرحمن الرحيم` |
| `قُلْ هُوَ ٱللَّهُ أَحَدٌ` | `قل هو الله احد` |
| `الرحمن` (already plain) | `الرحمن` (idempotent) |
| text ending in U+06DD ۝ | mark stripped |
| `ۯۺ` (letters U+06EF, U+06FA) | **unchanged** — this is the case the buggy range failed |

`minisearch` indexes `verses.textSimple` (~1 MB, built once at first launch and
cached) plus `notes.contentText` and `categories.name`. Results are grouped:
Quran matches and user-content matches are different intents and must not be
interleaved.

---

## 7. Offline and PWA

Serwist precaches the app shell; `/public/data` and the page fonts use
cache-first with a versioned cache name. User data is already local by
definition, so "offline" needs no special handling in application code — a
property worth protecting when sync arrives.

**Next.js 16 + Turbopack.** Next 16 uses Turbopack by default for both
`next dev` and `next build`. Older Serwist guides tell you to opt out with
`next build --webpack` — **that advice is obsolete.** Serwist 9 added Turbopack
support (`@serwist/turbopack`, backported from the delayed Serwist 10); use
`withSerwist` from that package and stay on Turbopack. Separately, note that in
Next 16 a custom `webpack` config in `next.config.ts` makes `next build` fail
outright, so don't reach for one.

Disable the service worker in development
(`disable: process.env.NODE_ENV === 'development'`) or caching will fight you on
every reload.

Installability matters here — on iPad the app should be added to the Home Screen
so it runs standalone without Safari chrome eating vertical space that the
Mushaf page needs.

---

## 8. Project structure

```
app/
  (reader)/page.tsx            reader route, dual-pane shell
  category/[id]/page.tsx
  search/page.tsx
  settings/page.tsx
  s/[slug]/page.tsx            public share view — Phase 7, server-rendered
  manifest.ts
  sw.ts
components/
  mushaf/                      Page, Line, Word, SurahHeader, Basmallah
  verse/                       ActionSheet, NoteEditor, Highlight
  categories/                  Tree, TreeNode, VerseList, DropZone
  layout/                      DualPane, Splitter, SlideOver
lib/
  db/
    schema.ts                  Dexie declaration
    repositories/              categories.ts, notes.ts, bookmarks.ts, …
                               ← ALL writes go through here; each appends to outbox
    bootstrap.ts               first-run corpus load
  mushaf/
    fonts.ts                   FontFace loader, prefetch window, eviction
    layout.ts                  page → lines → words
  search/
    normalize.ts               the function in §6 — single source of truth
    index.ts
  export/
    docx.ts                    Tiptap JSON → docx
    xlsx.ts
  ordering.ts                  fractional-index helpers + rebalance
scripts/
  build-corpus.ts              QUL sqlite → /public/data/*.json
  build-fonts.ts               fetch + subset + name the 604 woff2 files
public/
  data/                        committed build output
  fonts/quran/v2/p{1..604}.woff2
docs/
```

**The one architectural rule to enforce in review:** no component touches Dexie
directly. Reads go through `dexie-react-hooks` `useLiveQuery` on a repository
function; writes go through a repository function that also appends to `outbox`.
This is what makes Phase 7 an addition instead of a rewrite.

---

## 9. Phase 7 preview — sync, auth, sharing

Not being built now, but the shape it must fit into:

- **Auth:** Google OAuth. Supabase Auth or Auth.js — decide at Phase 7, both fit.
- **Sync:** drain `outbox` → server; pull `WHERE updated_at > since`. Last-write-
  wins per field for scalars; fractional indexes merge without a resolver;
  tombstones propagate deletes. Note bodies are the only real conflict risk —
  keep both versions and let the user pick rather than silently losing one.
- **Dexie Cloud** is the shortcut: a drop-in addon over the existing Dexie schema.
  Free tier is 3 production users / 100 MB; Pro is ~€0.12/user/month; on-prem is a
  one-time €3,495. Cheap to prototype with, and swappable — the outbox pattern
  means a custom Postgres backend remains equally viable.
- **Public share URLs** (`/s/{slug}`) are the one genuinely server-side feature.
  They render a category subtree read-only, joining stored `verseKey`s against the
  same static corpus files the app uses. No user data leaves except what the share
  explicitly includes.

---

## 10. Open questions

1. **Font licensing** (§2) — the only item that can block shipping. Resolve early.
2. **Font payload size** — 604 TTFs average ~337 KB in the `nuqayah/qpc-fonts`
   mirror. WOFF2 is materially smaller, but measure the actual total before
   deciding what the service worker precaches vs. fetches on demand.
3. **Which QUL layout edition** — QUL offers 12+ layouts. Confirm the exact
   KFGQPC Hafs 15-line edition and pin its version in `build-corpus.ts`.
4. **Translations** — absent from the SRS. If they are wanted later, the corpus
   pipeline should be shaped to accept them now; retrofitting a second text
   stream into the line renderer is awkward.
5. **Tiptap JSON → docx fidelity** — YouTube embeds cannot exist in a Word file.
   Decide the degradation: link with thumbnail, or bare URL.

---

## 11. Sources

Every version number and factual claim in this document was checked on
2026-08-24. Where a claim contradicts a widely-repeated piece of advice — the
Serwist/Webpack workaround, the "PUA codepoints" belief, pragmatic-drag-and-drop's
touch support — the contradiction is deliberate and sourced below.

- [QUL — Mushaf layout docs](https://qul.tarteel.ai/docs/mushaf-layout) · [Glyph-based fonts docs](https://qul.tarteel.ai/docs/glyph-based) · [QPC V2 font resource](https://qul.tarteel.ai/resources/font/249)
- [Quran Foundation — Font rendering guide](https://api-docs.quran.foundation/docs/tutorials/fonts/font-rendering/) · [Page layout API](https://api-docs.quran.foundation/docs/tutorials/fonts/page-layout/) · [Quickstart / auth](https://api-docs.quran.foundation/docs/quickstart/)
- [nuqayah/qpc-fonts](https://github.com/nuqayah/qpc-fonts) · [zonetecde/mushaf-layout](https://github.com/zonetecde/mushaf-layout)
- [Quranic Arabic Corpus](https://corpus.quran.com/) — 6,236 verses, 77,430 words
- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) — Turbopack is the default; a custom `webpack` config now fails the build
- [Serwist issue #54](https://github.com/serwist/serwist/issues/54) — Turbopack support backported to Serwist 9 (2025-12-20) · [Turbopack guide](https://serwist.pages.dev/docs/next/turbo)
- [pragmatic-drag-and-drop discussion #93](https://github.com/atlassian/pragmatic-drag-and-drop/discussions/93) — "Mobile/Touch Support?", still unanswered · [core CHANGELOG](https://github.com/atlassian/pragmatic-drag-and-drop/blob/main/packages/core/CHANGELOG.md) — no touch work through v3.0.0
- [rocicorp/fractional-indexing](https://github.com/rocicorp/fractional-indexing) — including its own note on concurrent collisions
- [Dexie Cloud pricing](https://dexie.org/cloud/pricing)
- [Tiptap YouTube extension](https://tiptap.dev/docs/editor/extensions/nodes/youtube) — MIT, not Pro

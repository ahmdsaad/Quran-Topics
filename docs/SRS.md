# Software Requirements Specification: Quran Classification Application

> As provided by the project owner, 2026-08-24. Verbatim — the architecture docs
> interpret this, they do not replace it.

## 1. Project Overview

A cross-platform and web-based application enabling users to read the Quran,
annotate verses with rich media, categorize and reorder verses, and sync data
seamlessly across devices.

## 2. Reading Interface

- Physical Quran layout mimicking a standard Mushaf.
- Vertical scrolling for pages.
- Ability to jump directly to any specific Surah or verse.
- State persistence to resume reading from the last position.
- Multiple bookmark management system with highlighting.

## 3. Verse Management

- Tap any verse to open a menu of action options.
- Add comments with rich text support including text, YouTube videos, and URLs.
- Highlighted verses clearly indicate that comments or actions are attached.
- Chapter, Juz, and verse details are displayed for identification.

## 4. Categories & Structuring

- Creation of infinite categories and subcategories.
- Assignment of any verse to multiple categories.
- Verses can be sorted by position in the Quran or manually reordered.
- Accordion-style interface for categories, allowing collapsible or fully
  expanded views.

## 5. Search & Sync

- Cross-device search functionality to find words or sentences in both Quran
  browsing and categories modes.
- Google account authentication for user login, registration, and data
  synchronization.

## 6. Desktop & Advanced Features

- Dual layout mode for desktop viewing, splitting the screen with Quran browsing
  on the right and categories on the left.
- Drag-and-drop feature to directly place verses into categories in a specific
  order.
- Drag-to-reorder functionality for verses within a category.

## 7. Export & Sharing

- Export categories into Word documents or Excel sheets.
- Generate a unique, public URL to share categories and subcategories for viewing
  by others.

---

## Requirements → phase mapping

| SRS section | Phase |
|---|---|
| §2 Reading interface | Phase 1 (bookmarks/highlighting in Phase 2) |
| §3 Verse management | Phase 2 |
| §4 Categories | Phase 3 (manual reorder UI in Phase 5) |
| §5 Search | Phase 4 |
| §5 Google auth + sync | Phase 7 |
| §6 Dual layout + drag-and-drop | Phase 5 |
| §7 Word/Excel export | Phase 6 |
| §7 Public share URL | Phase 7 |
| §1 "cross-platform" (native shells) | Phase 8, optional — gated on font licensing |

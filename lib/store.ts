'use client';

import { create } from 'zustand';
import type { CategorySpace } from '@/lib/types';

type Pane = 'reader' | 'categories' | 'qa' | 'search' | 'bookmarks' | 'settings';

interface UIState {
  /** Verse the action sheet is open for. */
  activeVerse: string | null;
  actionAnchor: { x: number; y: number } | null;
  openVerse: (key: string, anchor: { x: number; y: number }) => void;
  closeVerse: () => void;

  /** Verse whose note editor is open. */
  noteVerse: string | null;
  openNote: (key: string) => void;
  closeNote: () => void;

  /** Verses being assigned to categories — one, or a whole selected range. */
  assignVerses: string[];
  assignSpace: CategorySpace;
  openAssign: (keys: string | string[], space?: CategorySpace) => void;
  closeAssign: () => void;

  /**
   * Multi-verse selection, as a pair of endpoints rather than a list.
   *
   * Two keys describe any range, however long, and membership is a comparison
   * (see lib/mushaf/verseRange.ts) — so selecting a whole juz costs the same as
   * selecting two verses, and the reader never holds thousands of keys in state.
   *
   * `anchor` set with `focus` still null is the pending state: the user has
   * chosen where the range starts and the next verse they tap ends it.
   */
  selectionAnchor: string | null;
  selectionFocus: string | null;
  startRange: (key: string) => void;
  extendRange: (key: string) => void;
  clearSelection: () => void;

  /** Mobile/portrait: which pane is showing. */
  mobilePane: Pane;
  setMobilePane: (p: Pane) => void;

  /** Category open in the left pane, null = the tree. */
  openCategoryId: string | null;
  setOpenCategory: (id: string | null) => void;
  openQaCategoryId: string | null;
  setOpenQaCategory: (id: string | null) => void;

  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;

  /** Bumped to force the reader to scroll to `jumpPage`. */
  jumpPage: number;
  jumpToken: number;
  jumpTo: (page: number) => void;

  toast: string | null;
  showToast: (msg: string) => void;
}

export const useUI = create<UIState>((set, get) => ({
  activeVerse: null,
  actionAnchor: null,
  openVerse: (key, anchor) => set({ activeVerse: key, actionAnchor: anchor }),
  closeVerse: () => set({ activeVerse: null, actionAnchor: null }),

  noteVerse: null,
  openNote: (key) => set({ noteVerse: key, activeVerse: null, actionAnchor: null }),
  closeNote: () => set({ noteVerse: null }),

  assignVerses: [],
  assignSpace: 'topics',
  openAssign: (keys, space = 'topics') =>
    set({
      assignVerses: typeof keys === 'string' ? [keys] : keys,
      assignSpace: space,
      activeVerse: null,
      actionAnchor: null,
    }),
  closeAssign: () => set({ assignVerses: [] }),

  selectionAnchor: null,
  selectionFocus: null,
  startRange: (key) =>
    set({ selectionAnchor: key, selectionFocus: null, activeVerse: null, actionAnchor: null }),
  extendRange: (key) => set({ selectionFocus: key, activeVerse: null, actionAnchor: null }),
  clearSelection: () => set({ selectionAnchor: null, selectionFocus: null }),

  mobilePane: 'reader',
  setMobilePane: (p) => set({ mobilePane: p }),

  openCategoryId: null,
  setOpenCategory: (id) => set({ openCategoryId: id }),
  openQaCategoryId: null,
  setOpenQaCategory: (id) => set({ openQaCategoryId: id }),

  sidebarOpen: true,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),

  jumpPage: 1,
  jumpToken: 0,
  jumpTo: (page) => set({ jumpPage: page, jumpToken: get().jumpToken + 1 }),

  toast: null,
  showToast: (msg) => {
    set({ toast: msg });
    window.setTimeout(() => {
      if (get().toast === msg) set({ toast: null });
    }, 2200);
  },
}));

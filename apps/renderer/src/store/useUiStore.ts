/** View routing, selection, dialogs and toasts. Deliberately tiny. */

import { create } from "zustand";

export type Route =
  | "home"
  | "library"
  | "browse"
  | "nowplaying"
  | "search"
  | "downloads"
  | "playlists"
  | "queue"
  | "folders"
  | "settings"
  | "stats"
  | "transcript";

/** Which facet the Browse page opens on. */
export type BrowseFacet = "authors" | "narrators" | "series" | "genres" | "tags" | "colors";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: "info" | "success" | "danger";
  action?: { label: string; run: () => void };
}

export type DialogKind =
  | { kind: "none" }
  | { kind: "import"; target: "files" | "folder" }
  | { kind: "editBook"; bookId: string }
  | { kind: "chapters"; bookId: string }
  | { kind: "coverSearch"; bookId: string; target?: "cover" | "banner" }
  | { kind: "bookmarks"; bookId: string }
  | { kind: "newFolder"; parentId?: string | null }
  /** Set or clear a folder PIN; `unlock` asks for it instead. */
  | { kind: "folderLock"; folderId: string; mode: "set" | "unlock" }
  | { kind: "newPlaylist"; bookIds?: string[] }
  | { kind: "shortcuts" }
  | { kind: "about" }
  | { kind: "sleep" }
  | { kind: "eq" }
  | { kind: "transcribe"; bookId: string }
  | { kind: "hostImport"; target: "files" | "folder" }
  | { kind: "output" };

/** What a right click landed on. */
export type ContextTarget =
  | { kind: "book"; bookId: string; x: number; y: number }
  | { kind: "folder"; folderId: string; x: number; y: number };

interface UiStore {
  /** True once the host bridge has answered and the first data load finished. */
  ready: boolean;
  /** False when the browser build has no server to talk to. */
  connected: boolean;
  setReady(ready: boolean): void;
  setConnected(connected: boolean): void;
  route: Route;
  previousRoute: Route;
  selectedBookId: string | null;
  /** Playlist open in the Playlists page (the sidebar highlights it too). */
  selectedPlaylistId: string | null;
  selectPlaylist(id: string | null): void;
  /** Books ticked in the library for bulk actions. */
  selection: string[];
  playerVisible: boolean;
  /** The immersive player: the whole window, no sidebar, no bottom bar. */
  playerFullscreen: boolean;
  /**
   * The speed/volume panel in the player's corner. It lives here rather than in
   * the component because Escape has to close the innermost thing first: with
   * this open, Escape folds the panel away and leaves the player alone.
   */
  soundPanelOpen: boolean;
  sidebarCollapsed: boolean;
  searchOpen: boolean;
  browseFacet: BrowseFacet;
  mini: boolean;
  dialog: DialogKind;
  /**
   * The right-click target.
   *
   * One menu at a time, and it can belong to a book or to a folder: the folder
   * page needs its own actions (colour, nesting, lock) and the book menu has no
   * business offering them.
   */
  contextMenu: ContextTarget | null;
  /** Folders unlocked for this session, by id. A PIN is never stored cleared. */
  toasts: Toast[];
  helpOpen: boolean;
  setRoute(route: Route, keepSelection?: boolean): void;
  back(): void;
  select(bookId: string | null): void;
  toggleSelection(bookId: string, additive?: boolean): void;
  clearSelection(): void;
  setPlayerVisible(visible: boolean): void;
  setPlayerFullscreen(fullscreen: boolean): void;
  setSoundPanelOpen(open: boolean): void;
  toggleSidebar(): void;
  setSearchOpen(open: boolean): void;
  setMini(mini: boolean): void;
  openDialog(dialog: DialogKind): void;
  closeDialog(): void;
  openContextMenu(bookId: string, x: number, y: number): void;
  openFolderMenu(folderId: string, x: number, y: number): void;
  closeContextMenu(): void;
  unlocked: string[];
  markUnlocked(folderId: string): void;
  lockAgain(folderId: string): void;
  toast(toast: Omit<Toast, "id">): void;
  dismissToast(id: string): void;
  setBrowseFacet(facet: BrowseFacet): void;
  setHelpOpen(open: boolean): void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  ready: false,
  connected: false,
  setReady: (ready) => set({ ready }),
  setConnected: (connected) => set({ connected }),
  route: "home",
  previousRoute: "library",
  selectedBookId: null,
  selectedPlaylistId: null,
  selection: [],
  playerVisible: true,
  playerFullscreen: false,
  soundPanelOpen: false,
  sidebarCollapsed: false,
  searchOpen: false,
  browseFacet: "authors",
  mini: false,
  dialog: { kind: "none" },
  contextMenu: null,
  unlocked: [],
  toasts: [],
  helpOpen: false,

  setRoute(route, keepSelection = false) {
    set({
      previousRoute: get().route,
      route,
      selection: keepSelection ? get().selection : [],
    });
  },
  back() {
    set({ route: get().previousRoute });
  },
  select(bookId) {
    set({ selectedBookId: bookId });
  },

  selectPlaylist(id) {
    set({ selectedPlaylistId: id });
  },
  toggleSelection(bookId, additive = false) {
    const selection = get().selection;
    if (!additive) {
      set({ selection: selection.includes(bookId) ? [] : [bookId] });
      return;
    }
    set({
      selection: selection.includes(bookId)
        ? selection.filter((id) => id !== bookId)
        : [...selection, bookId],
    });
  },
  clearSelection() {
    set({ selection: [] });
  },
  setPlayerVisible(visible) {
    set({ playerVisible: visible });
  },
  setPlayerFullscreen(fullscreen) {
    // Leaving the immersive player is not the same as leaving the book: the
    // route is untouched, so the page underneath is still where it was.
    set({ playerFullscreen: fullscreen, soundPanelOpen: false });
  },
  setSoundPanelOpen(open) {
    set({ soundPanelOpen: open });
  },
  toggleSidebar() {
    set({ sidebarCollapsed: !get().sidebarCollapsed });
  },
  setSearchOpen(open) {
    set({ searchOpen: open });
  },
  setMini(mini) {
    set({ mini });
    void import("../platform/bridge").then(({ getBridge }) =>
      getBridge().then((bridge) => bridge.player.setMini(mini)),
    );
  },
  openDialog(dialog) {
    set({ dialog });
  },
  closeDialog() {
    set({ dialog: { kind: "none" } });
  },
  openContextMenu(bookId, x, y) {
    // Deliberately does not touch selectedBookId. That field decides what the
    // library route renders, so setting it here meant a right click opened the
    // book as well as the menu - and the book page stayed open afterwards.
    // Right click belongs to the menu; opening a book is the left click's job.
    set({ contextMenu: { kind: "book", bookId, x, y } });
  },
  openFolderMenu(folderId, x, y) {
    set({ contextMenu: { kind: "folder", folderId, x, y } });
  },
  markUnlocked(folderId) {
    set({ unlocked: [...new Set([...get().unlocked, folderId])] });
  },
  lockAgain(folderId) {
    set({ unlocked: get().unlocked.filter((id) => id !== folderId) });
  },
  closeContextMenu() {
    set({ contextMenu: null });
  },
  toast(toast) {
    const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    // The same message twice is noise: playing a book that the audio graph
    // refuses can raise the same warning on every transport click, and two
    // identical cards over the interface say nothing a single one does not.
    const kept = get().toasts.filter((item) => item.title !== toast.title);
    set({ toasts: [...kept, { ...toast, id }] });
    window.setTimeout(() => get().dismissToast(id), toast.tone === "danger" ? 8000 : 4200);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  setBrowseFacet(facet) {
    set({ browseFacet: facet });
  },
  setHelpOpen(open) {
    set({ helpOpen: open });
  },
}));

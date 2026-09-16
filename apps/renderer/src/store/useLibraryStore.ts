/**
 * Library store: books, folders, playlists, bookmarks, queue + stats.
 * Every mutation writes straight back through the bridge so the Electron main
 * process owns the canonical .json file on disk.
 */

import { create } from "zustand";
import {
  canNestFolder,
  computeStats,
  emptyLibrary,
  filterBooks,
  hashPin,
  newId,
  normalizeLibrary,
  sortBooks,
  type AppStats,
  type Book,
  type Bookmark,
  type Chapter,
  type Folder,
  type ID,
  type LibraryState,
  type Playlist,
  type SortKey,
} from "@amp/core";
import { getBridge, type ImportResult } from "../platform/bridge";
import { useSettingsStore } from "./useSettingsStore";

/**
 * Books whose embedded cover has already been asked for this session. The point
 * is to ask once: a book with no art in its file would otherwise re-ask on
 * every render, which is a file read per frame.
 */
const embeddedAsked = new Set<ID>();
import { useUiStore } from "./useUiStore";

export interface LibraryFilter {
  text: string;
  folderId: ID | "all";
  tag: string | null;
  favorite: boolean;
  inProgress: boolean;
  /** Sidebar facets. Empty means "everything", never a fake value. */
  author: string | null;
  narrator: string | null;
  series: string | null;
  genre: string | null;
  color: string | null;
}

interface LibraryStore {
  state: LibraryState;
  ready: boolean;
  busy: boolean;
  lastImport: ImportResult | null;
  error: string | null;
  filter: LibraryFilter;
  sort: { key: SortKey; direction: "asc" | "desc" };
  view: "grid" | "list" | "shelf";
  load(): Promise<void>;
  persist(): Promise<void>;
  setFilter(patch: Partial<LibraryFilter>): void;
  setSort(key: SortKey, direction?: "asc" | "desc"): void;
  setView(view: "grid" | "list" | "shelf"): void;
  visibleBooks(): Book[];
  book(id: ID | null | undefined): Book | undefined;
  stats(): AppStats;
  importPaths(paths: string[], folderId?: ID | null, options?: { groupFolders?: boolean }): Promise<ImportResult>;
  importFromDialog(kind: "files" | "folder"): Promise<ImportResult>;
  rescan(): Promise<ImportResult>;
  patchBook(id: ID, patch: Partial<Book>): Promise<void>;
  /**
   * Fetch the cover that is inside the audio file, once per book per session.
   *
   * A library imported before Amp read embedded art - or one whose files were
   * seen by an older build - has books with no cover at all, and the shelf then
   * shows initials where a real cover belongs. Asking the host costs one read
   * per file and fills the gap for good; the answer is written onto the book, so
   * it is a one-off, not a request per render.
   */
  ensureEmbeddedCover(id: ID): Promise<void>;
  updateChapters(id: ID, chapters: Chapter[]): Promise<void>;
  removeBooks(ids: ID[]): Promise<void>;
  toggleFavorite(id: ID): Promise<void>;
  moveBook(id: ID, direction: -1 | 1): Promise<void>;
  markFinished(id: ID, finished: boolean): Promise<void>;
  setTag(id: ID, tag: string, on: boolean): Promise<void>;
  setColor(ids: ID[], color: string | null): Promise<void>;
  moveToFolder(ids: ID[], folderId: ID | null): Promise<void>;
  addFolder(name: string, parentId?: ID | null, options?: { color?: string }): Promise<Folder>;
  renameFolder(id: ID, name: string): Promise<void>;
  setFolderColor(id: ID, color: string | null): Promise<void>;
  setFolderLock(id: ID, pin: string | null): Promise<void>;
  moveFolder(id: ID, parentId: ID | null): Promise<void>;
  removeFolder(id: ID, keepBooks?: boolean): Promise<void>;
  createPlaylist(name: string, bookIds?: ID[]): Promise<Playlist>;
  updatePlaylist(id: ID, patch: Partial<Playlist>): Promise<void>;
  removePlaylist(id: ID): Promise<void>;
  addToQueue(bookId: ID): Promise<void>;
  /** Replace the queue in one write: playlists and shuffle build it wholesale. */
  setQueue(bookIds: ID[]): Promise<void>;
  removeFromQueue(bookId: ID): Promise<void>;
  reorderQueue(from: number, to: number): Promise<void>;
  clearQueue(): Promise<void>;
  addBookmark(bookmark: Omit<Bookmark, "id" | "createdAt">): Promise<Bookmark>;
  updateBookmark(id: ID, patch: Partial<Bookmark>): Promise<void>;
  removeBookmark(id: ID): Promise<void>;
  recordProgress(bookId: ID, position: number): void;
  pushHistory(bookId: ID, position: number): void;
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  state: emptyLibrary(),
  ready: false,
  busy: false,
  lastImport: null,
  error: null,
  filter: {
    text: "",
    folderId: "all",
    tag: null,
    favorite: false,
    inProgress: false,
    author: null,
    narrator: null,
    series: null,
    genre: null,
    color: null,
  },
  sort: { key: "added", direction: "desc" },
  view: "grid",

  async load() {
    const host = await getBridge();
    set({ busy: true });
    try {
      const state = await host.library.load();
      set({ state: normalizeLibrary(state), ready: true, busy: false, error: null });
    } catch (error) {
      set({ ready: true, busy: false, error: (error as Error).message });
    }
  },

  async persist() {
    const host = await getBridge();
    await host.library.save(get().state);
  },

  setFilter(patch) {
    set({ filter: { ...get().filter, ...patch } });
  },

  setSort(key, direction) {
    const current = get().sort;
    const next = direction ?? (current.key === key && current.direction === "asc" ? "desc" : "asc");
    set({ sort: { key, direction: next } });
  },

  setView(view) {
    set({ view });
  },

  visibleBooks() {
    const { state, filter, sort } = get();
    const filtered = filterBooks(state.books, {
      text: filter.text,
      folderId: filter.folderId,
      tag: filter.tag ?? undefined,
      favorite: filter.favorite || undefined,
      inProgress: filter.inProgress || undefined,
      author: filter.author ?? undefined,
      narrator: filter.narrator ?? undefined,
      series: filter.series ?? undefined,
      genre: filter.genre ?? undefined,
      color: filter.color ?? undefined,
    });
    return sortBooks(filtered, sort.key, sort.direction);
  },

  book(id) {
    if (!id) return undefined;
    return get().state.books.find((b) => b.id === id);
  },

  stats() {
    return computeStats(get().state);
  },

  async importPaths(paths, folderId = null, options: { groupFolders?: boolean } = {}) {
    const host = await getBridge();
    set({ busy: true });
    try {
      // Settings, Library decides whether sibling tracks become one book with
      // chapters or one book per file; the caller can override it per import.
      const groupFolders = options.groupFolders ?? useSettingsStore.getState().settings.library.groupFolders;
      const result = await host.library.importPaths(paths, { groupFolders, folderId });
      // Merge by id rather than reloading: on the desktop host the library file
      // is written by the renderer, so a reload straight after an import can
      // hand back the state from before it and make the import look lost.
      const byId = new Map(get().state.books.map((book) => [book.id, book]));
      for (const book of result.books) {
        const existing = byId.get(book.id);
        byId.set(book.id, existing ? { ...existing, ...book } : book);
      }
      set({ state: { ...get().state, books: [...byId.values()] }, lastImport: result, busy: false });
      await get().persist();
      return result;
    } catch (error) {
      set({ busy: false, error: (error as Error).message });
      throw error;
    }
  },

  async importFromDialog(kind) {
    const host = await getBridge();
    if (!host.capabilities.nativeImport) {
      // No file picker here (browser client): ask for a path on the host.
      useUiStore.getState().openDialog({ kind: "hostImport", target: kind });
      return { added: 0, updated: 0, skipped: 0, books: [], errors: [] };
    }
    const picked = kind === "files" ? await host.library.pickFiles() : [await host.library.pickFolder()];
    const paths = picked.filter((path): path is string => Boolean(path));
    if (paths.length === 0) return { added: 0, updated: 0, skipped: 0, books: [], errors: [] };
    return get().importPaths(paths);
  },

  async rescan() {
    const host = await getBridge();
    set({ busy: true });
    const result = await host.library.rescan();
    await get().load();
    set({ busy: false, lastImport: result });
    return result;
  },

  async ensureEmbeddedCover(id) {
    const book = get().state.books.find((item) => item.id === id);
    if (!book) return;
    if (book.coverDataUrl || book.coverUrl || book.coverPath) return;
    if (embeddedAsked.has(id)) return;
    embeddedAsked.add(id);
    try {
      const host = await getBridge();
      const extract = host.library.extractCover;
      if (!extract) return;
      const path = await extract({ id: book.id, sourcePath: book.sourcePath });
      if (!path) return;
      // patchBook persists, so the cover survives a restart instead of being
      // re-read from the audio file every session.
      await get().patchBook(id, { coverPath: path });
    } catch {
      /* no embedded art, an unreadable file, or a host without the call */
    }
  },

  async patchBook(id, patch) {
    set({
      state: {
        ...get().state,
        books: get().state.books.map((book) => (book.id === id ? { ...book, ...patch, updatedAt: Date.now() } : book)),
      },
    });
    await get().persist();
  },

  async updateChapters(id, chapters) {
    const total = chapters.reduce((acc, c) => acc + Math.max(0, c.duration), 0);
    const book = get().book(id);
    await get().patchBook(id, {
      chapters,
      duration: total || book?.duration || 0,
    });
  },

  async removeBooks(ids) {
    const remove = new Set(ids);
    set({
      state: {
        ...get().state,
        books: get().state.books.filter((b) => !remove.has(b.id)),
        bookmarks: get().state.bookmarks.filter((b) => !remove.has(b.bookId)),
        queue: get().state.queue.filter((q) => !remove.has(q.bookId)),
        playlists: get().state.playlists.map((p) => ({
          ...p,
          bookIds: p.bookIds.filter((id) => !remove.has(id)),
        })),
      },
    });
    await get().persist();
  },

  async moveBook(id, direction) {
    // Materialise an explicit manual order from the currently visible order.
    const visible = get().visibleBooks();
    const order = new Map(visible.map((book, index) => [book.id, index * 10]));
    const ranked = get().state.books.map((book) => ({
      ...book,
      manualOrder: book.manualOrder ?? order.get(book.id) ?? book.addedAt,
    }));
    const index = ranked.findIndex((book) => book.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ranked.length) return;
    const list = [...ranked];
    [list[index], list[target]] = [list[target], list[index]];
    const renumbered = list.map((book, i) => ({ ...book, manualOrder: i * 10 }));
    set({ state: { ...get().state, books: renumbered } });
    await get().persist();
  },

  async markFinished(id, finished) {
    const book = get().book(id);
    if (!book) return;
    await get().patchBook(id, { progress: finished ? book.duration : 0, lastPlayedAt: Date.now() });
  },

  async toggleFavorite(id) {
    const book = get().book(id);
    if (book) await get().patchBook(id, { favorite: !book.favorite });
  },

  async setTag(id, tag, on) {
    const book = get().book(id);
    if (!book) return;
    const tags = on ? [...new Set([...book.tags, tag])] : book.tags.filter((t) => t !== tag);
    await get().patchBook(id, { tags });
  },

  /**
   * Colour tags from the library context menu. A book carries one colour, so
   * this is a single patch rather than a list edit.
   */
  async setColor(ids, color) {
    const target = new Set(ids);
    set({
      state: {
        ...get().state,
        books: get().state.books.map((book) =>
          target.has(book.id) ? { ...book, color, updatedAt: Date.now() } : book,
        ),
      },
    });
    await get().persist();
  },

  async moveToFolder(ids, folderId) {
    const target = new Set(ids);
    set({
      state: {
        ...get().state,
        books: get().state.books.map((b) => (target.has(b.id) ? { ...b, folderId, updatedAt: Date.now() } : b)),
      },
    });
    await get().persist();
  },

  async addFolder(name, parentId = null, options = {}) {
    const folder: Folder = {
      id: newId("fd"),
      name,
      parentId: parentId ?? null,
      color: options.color,
      createdAt: Date.now(),
    };
    set({ state: { ...get().state, folders: [...get().state.folders, folder] } });
    await get().persist();
    return folder;
  },

  /** Colour a folder: the shelf, not the books on it. */
  async setFolderColor(id, color) {
    set({
      state: {
        ...get().state,
        folders: get().state.folders.map((folder) =>
          folder.id === id ? { ...folder, color: color ?? undefined } : folder,
        ),
      },
    });
    await get().persist();
  },

  /**
   * Lock a folder with a PIN, or unlock it with the PIN it already has.
   *
   * The PIN is never stored: what goes in the library file is a hash, and the
   * folder is only marked locked while a hash exists.
   */
  async setFolderLock(id, pin) {
    if (!pin) {
      set({
        state: {
          ...get().state,
          folders: get().state.folders.map((folder) =>
            folder.id === id ? { ...folder, locked: false, lockHash: undefined } : folder,
          ),
        },
      });
      await get().persist();
      return;
    }
    const lockHash = await hashPin(pin);
    set({
      state: {
        ...get().state,
        folders: get().state.folders.map((folder) =>
          folder.id === id ? { ...folder, locked: true, lockHash } : folder,
        ),
      },
    });
    await get().persist();
  },

  /** Nest a folder inside another, refusing anything that would make a loop. */
  async moveFolder(id, parentId) {
    if (!canNestFolder(get().state.folders, id, parentId)) return;
    set({
      state: {
        ...get().state,
        folders: get().state.folders.map((folder) =>
          folder.id === id ? { ...folder, parentId: parentId ?? null } : folder,
        ),
      },
    });
    await get().persist();
  },

  async renameFolder(id, name) {
    set({
      state: {
        ...get().state,
        folders: get().state.folders.map((f) => (f.id === id ? { ...f, name } : f)),
      },
    });
    await get().persist();
  },

  async removeFolder(id, keepBooks = true) {
    // Children are lifted to the top level rather than deleted with the parent:
    // a folder is a label, and losing a label should not lose the shelf inside.
    const children = get().state.folders.filter((f) => f.parentId === id).map((f) => f.id);
    set({
      state: {
        ...get().state,
        folders: get()
          .state.folders.filter((f) => f.id !== id)
          .map((f) => (children.includes(f.id) ? { ...f, parentId: null } : f)),
        books: keepBooks
          ? get().state.books.map((b) => (b.folderId === id ? { ...b, folderId: null } : b))
          : get().state.books.filter((b) => b.folderId !== id),
      },
    });
    await get().persist();
  },

  async createPlaylist(name, bookIds = []) {
    const playlist: Playlist = {
      id: newId("pl"),
      name,
      bookIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    set({ state: { ...get().state, playlists: [...get().state.playlists, playlist] } });
    await get().persist();
    return playlist;
  },

  async updatePlaylist(id, patch) {
    set({
      state: {
        ...get().state,
        playlists: get().state.playlists.map((p) =>
          p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
        ),
      },
    });
    await get().persist();
  },

  async removePlaylist(id) {
    set({ state: { ...get().state, playlists: get().state.playlists.filter((p) => p.id !== id) } });
    await get().persist();
  },

  async setQueue(bookIds) {
    const unique = [...new Set(bookIds)];
    set({ state: { ...get().state, queue: unique.map((bookId) => ({ bookId, addedAt: Date.now() })) } });
    await get().persist();
  },

  async addToQueue(bookId) {
    const queue = get().state.queue;
    if (queue.some((q) => q.bookId === bookId)) return;
    set({ state: { ...get().state, queue: [...queue, { bookId, addedAt: Date.now() }] } });
    await get().persist();
  },

  async removeFromQueue(bookId) {
    set({ state: { ...get().state, queue: get().state.queue.filter((q) => q.bookId !== bookId) } });
    await get().persist();
  },

  async reorderQueue(from, to) {
    const queue = [...get().state.queue];
    if (from < 0 || from >= queue.length) return;
    const [item] = queue.splice(from, 1);
    queue.splice(Math.max(0, Math.min(queue.length, to)), 0, item);
    set({ state: { ...get().state, queue } });
    await get().persist();
  },

  async clearQueue() {
    set({ state: { ...get().state, queue: [] } });
    await get().persist();
  },

  async addBookmark(bookmark) {
    const entry: Bookmark = { ...bookmark, id: newId("bm"), createdAt: Date.now() };
    set({ state: { ...get().state, bookmarks: [entry, ...get().state.bookmarks] } });
    await get().persist();
    return entry;
  },

  async updateBookmark(id, patch) {
    set({
      state: {
        ...get().state,
        bookmarks: get().state.bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      },
    });
    await get().persist();
  },

  async removeBookmark(id) {
    set({ state: { ...get().state, bookmarks: get().state.bookmarks.filter((b) => b.id !== id) } });
    await get().persist();
  },

  /** High frequency: updates in memory only, the player flushes periodically. */
  recordProgress(bookId, position) {
    const { state } = get();
    const book = state.books.find((b) => b.id === bookId);
    if (!book || Math.abs(book.progress - position) < 1) return;
    set({
      state: {
        ...state,
        books: state.books.map((b) => (b.id === bookId ? { ...b, progress: position, lastPlayedAt: Date.now() } : b)),
      },
    });
  },

  pushHistory(bookId, position) {
    set({
      state: {
        ...get().state,
        history: [{ bookId, at: Date.now(), position }, ...get().state.history].slice(0, 400),
      },
    });
  },
}));

export const selectBooks = (state: LibraryStore) => state.state.books;
export const selectBookmarks = (state: LibraryStore) => state.state.bookmarks;
export const selectFolders = (state: LibraryStore) => state.state.folders;
export const selectPlaylists = (state: LibraryStore) => state.state.playlists;
export const selectQueue = (state: LibraryStore) => state.state.queue;

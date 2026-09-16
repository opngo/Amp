/** Torrent search + qBittorrent download tracking. */

import { create } from "zustand";
import { sortResults, type DownloadItem, type TorrentResult } from "@amp/core";
import { useLibraryStore } from "./useLibraryStore";
import { getBridge } from "../platform/bridge";

interface DownloadsStore {
  query: string;
  results: TorrentResult[];
  downloads: DownloadItem[];
  searching: boolean;
  /** True once a request has finished, successfully or not. */
  searched: boolean;
  connected: boolean | null;
  connectionDetail: string | null;
  sort: "relevance" | "seeders" | "size" | "date";
  error: string | null;
  pollTimer: number | null;
  setQuery(query: string): void;
  setSort(sort: DownloadsStore["sort"]): void;
  search(query?: string): Promise<void>;
  testConnection(): Promise<void>;
  refresh(): Promise<void>;
  startPolling(): void;
  stopPolling(): void;
  download(result: TorrentResult): Promise<{ ok: boolean; detail?: string }>;
  pause(hash: string): Promise<void>;
  resume(hash: string): Promise<void>;
  remove(hash: string, deleteFiles?: boolean): Promise<void>;
  importFinished(): Promise<number>;
}

export const useDownloadsStore = create<DownloadsStore>((set, get) => ({
  query: "",
  results: [],
  downloads: [],
  searching: false,
  searched: false,
  connected: null,
  connectionDetail: null,
  sort: "relevance",
  error: null,
  pollTimer: null,

  setQuery(query) {
    set({ query });
  },

  setSort(sort) {
    set({ sort, results: sortResults(get().results, sort) });
  },

  async search(query) {
    // An empty query is a real request: the newest AudioBookBay releases.
    const text = (query ?? get().query).trim();
    // `searched` marks that an answer came back, so the page can tell "nothing
    // matched" apart from "nothing has happened yet". Without it a search that
    // returns nothing looks like a button that does nothing.
    set({ searching: true, error: null, query: text, searched: false });
    try {
      const host = await getBridge();
      const results = await host.torrents.search(text);
      set({ results: sortResults(results, get().sort), searching: false, searched: true });
    } catch (error) {
      set({ searching: false, searched: true, error: (error as Error).message });
    }
  },

  async testConnection() {
    const host = await getBridge();
    const probe = await host.torrents.test((await import("./useSettingsStore")).useSettingsStore.getState().settings.torrents.qbittorrent);
    set({ connected: probe.available, connectionDetail: probe.detail ?? probe.version ?? null });
  },

  async refresh() {
    try {
      const host = await getBridge();
      const downloads = await host.torrents.list();
      set({ downloads });
    } catch (error) {
      set({ error: (error as Error).message });
    }
  },

  startPolling() {
    if (get().pollTimer !== null) return;
    // Refresh also keeps the connection state (and the reason behind it) current.
    void get().refresh();
    void get().testConnection();
    const timer = window.setInterval(() => void get().refresh(), 2000);
    set({ pollTimer: timer });
  },

  stopPolling() {
    const timer = get().pollTimer;
    if (timer !== null) window.clearInterval(timer);
    set({ pollTimer: null });
  },

  async download(result) {
    const host = await getBridge();
    if (!result.magnet && !result.url && !result.infoHash) {
      const detail = "This result has no link to download from.";
      set({ error: detail });
      return { ok: false, detail };
    }
    // The host resolves the magnet from the detail page when the source only
    // publishes an info hash.
    const response = await host.torrents.add(result.magnet ?? "", {
      name: result.title,
      resultId: result.id,
      url: result.url,
      infoHash: result.infoHash,
    });
    if (!response.ok) {
      // The host could not hand the magnet to qBittorrent; say why instead of
      // reporting a download that never started.
      const detail = response.detail ?? "Could not reach qBittorrent";
      set({ error: detail, connectionDetail: detail, connected: false });
      return { ok: false, detail };
    }
    set({ error: null, connected: true });
    await get().refresh();
    return { ok: true };
  },

  async pause(hash) {
    const host = await getBridge();
    await host.torrents.pause(hash);
    await get().refresh();
  },

  async resume(hash) {
    const host = await getBridge();
    await host.torrents.resume(hash);
    await get().refresh();
  },

  async remove(hash, deleteFiles = false) {
    const host = await getBridge();
    await host.torrents.remove(hash, deleteFiles);
    await get().refresh();
  },

  async importFinished() {
    const host = await getBridge();
    const result = await host.torrents.importCompleted();
    // The books that came back belong in the library now, not on the next
    // reload: merge them the same way a normal import does.
    if (result.books.length) {
      const library = useLibraryStore.getState();
      const byId = new Map(library.state.books.map((book) => [book.id, book]));
      for (const book of result.books) {
        const existing = byId.get(book.id);
        byId.set(book.id, existing ? { ...existing, ...book } : book);
      }
      useLibraryStore.setState({ state: { ...library.state, books: [...byId.values()] } });
      await library.persist();
    }
    await get().refresh();
    return result.added;
  },
}));

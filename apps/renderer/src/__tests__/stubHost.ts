/**
 * A desktop-shaped host for the renderer tests.
 *
 * Amp ships no demo library - the app reads real files - so the tests install
 * a small in-memory host that behaves like the Electron bridge: a handful of
 * books with chapters, a queue, bookmarks and an AudioBookBay search. It is a
 * test double, not placeholder content in the product.
 */

import type { AmpBridge, Book, LibraryState } from "@amp/core";
import { emptyLibrary } from "@amp/core";

const CHAPTER_TITLES = ["Prologue", "Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4", "Epilogue"];

function makeBook(index: number, title: string, author: string, duration: number): Book {
  return {
    id: `bk_test${index}`,
    title,
    author,
    narrator: index % 2 === 0 ? "Ray Porter" : "Robin Miles",
    album: title,
    genres: [index % 2 === 0 ? "Science Fiction" : "Fantasy"],
    tags: [index % 2 === 0 ? "sci-fi" : "fantasy"],
    description: `${title} by ${author}.`,
    sourcePath: `/library/${title.toLowerCase().replace(/\s+/g, "-")}.m4b`,
    kind: "single",
    chapters: CHAPTER_TITLES.map((chapterTitle, chapterIndex) => ({
      id: `ch_${index}_${chapterIndex}`,
      index: chapterIndex,
      title: chapterTitle,
      start: chapterIndex * (duration / CHAPTER_TITLES.length),
      duration: duration / CHAPTER_TITLES.length,
    })),
    duration,
    progress: index === 1 ? duration * 0.4 : 0,
    lastPlayedAt: index === 1 ? Date.now() - 3600_000 : undefined,
    addedAt: Date.now() - index * 86_400_000,
    updatedAt: Date.now(),
    favorite: index === 2,
    sizeBytes: 180 * 1024 * 1024,
    codec: "AAC",
    bitrate: 128_000,
  };
}

export function testLibrary(): LibraryState {
  const library = emptyLibrary();
  library.books = [
    makeBook(0, "Dune", "Frank Herbert", 21 * 3600),
    makeBook(1, "Neuromancer", "William Gibson", 9 * 3600),
    makeBook(2, "Piranesi", "Susanna Clarke", 7 * 3600),
    makeBook(3, "Blindsight", "Peter Watts", 11 * 3600),
  ];
  library.folders = [{ id: "fd_scifi", name: "Sci-Fi", createdAt: Date.now() }];
  library.playlists = [
    { id: "pl_1", name: "Evening", bookIds: ["bk_test0"], createdAt: Date.now(), updatedAt: Date.now() },
  ];
  return library;
}

/** Installs the stub on `window.amp`, the way the preload script would. */
export function stubHost(): AmpBridge {
  const bridge: AmpBridge = {
    platform: "electron",
    version: "0.9.0-test",
    demo: false,
    capabilities: {
      nativeImport: true,
      importByPath: true,
      covers: true,
      torrents: true,
      transcription: true,
      server: true,
      tray: true,
      updater: true,
      writeChapters: true,
      revealFolder: true,
    },
    library: {
      async load() {
        return testLibrary();
      },
      async save() {
        /* state is kept in the store during tests */
      },
      async importPaths() {
        return { added: 0, updated: 0, skipped: 0, books: [], errors: [] };
      },
      async pickFiles() {
        return [];
      },
      async pickFolder() {
        return null;
      },
      async rescan() {
        return { added: 0, updated: 0, skipped: 0, books: [], errors: [] };
      },
      async extractCover() {
        return null;
      },
      async saveCover() {
        return null;
      },
      async removeCover() {
        /* not needed in tests */
      },
      async searchCovers() {
        return [];
      },
      fileUrl(path: string) {
        return path ? `amp-media://local/${encodeURIComponent(path)}` : "";
      },
      async revealInFolder() {
        /* not needed in tests */
      },
      async writeChapters() {
        return { ok: false };
      },
      async stats() {
        return { diskBytes: 0, dataDir: "/tmp/amp" };
      },
    },
    torrents: {
      async search(query: string) {
        return [
          {
            id: "tr_1",
            source: "audiobookbay",
            title: `${query} - Frank Herbert`,
            size: 924_655_288,
            sizeText: "881.82 MB",
            magnet: "magnet:?xt=urn:btih:ad5fae5ffda056f9f45131045d140326bbafc4dc",
            url: "https://audiobookbay.lu/abss/dune/",
            seeders: 12,
            score: 10,
          },
        ];
      },
      async test() {
        return { available: true, version: "5.0.0" };
      },
      async add() {
        return { ok: true };
      },
      async list() {
        return [];
      },
      async pause() {
        /* not needed */
      },
      async resume() {
        /* not needed */
      },
      async remove() {
        /* not needed */
      },
      async openFolder() {
        /* not needed */
      },
      async importCompleted() {
        return { added: 0, updated: 0, skipped: 0, books: [], errors: [] };
      },
    },
    transcription: {
      async probe() {
        return { available: false, detail: "Not installed in tests" };
      },
      async start() {
        throw new Error("Transcription is not available in tests");
      },
      async status() {
        return null;
      },
      async cancel() {
        /* not needed */
      },
      async get() {
        return null;
      },
      async jobs() {
        return [];
      },
    },
    player: {
      async setMini() {
        /* not needed */
      },
      async setAlwaysOnTop() {
        /* not needed */
      },
      async setMiniSize() {
        /* not needed */
      },
      async hideToTray() {
        /* not needed */
      },
      async wake() {
        /* not needed */
      },
      async quit() {
        /* not needed */
      },
      async setGlobalShortcuts() {
        return { ok: true, failed: [] };
      },
      onCommand() {
        return () => undefined;
      },
      onWindowState() {
        return () => undefined;
      },
      async setMediaSession() {
        /* jsdom has no media session */
      },
      async openExternal() {
        /* no windows in tests */
      },
      async window(action?: string) {
        void action;
        /* not needed */
      },
    },
    settings: {
      async load() {
        return (await import("@amp/core")).defaultSettings;
      },
      async save() {
        /* kept in the settings store */
      },
      async export() {
        return "{}";
      },
      async import(json: string) {
        return JSON.parse(json);
      },
    },
    server: {
      async start() {
        return { running: true, url: "http://127.0.0.1:7777" };
      },
      async stop() {
        return { running: false };
      },
      async status() {
        return { running: true, url: "http://127.0.0.1:7777" };
      },
    },
    updater: {
      async check() {
        return { available: false };
      },
      async open() {
        /* not needed */
      },
    },
    async logs() {
      return ["test host"];
    },
  };

  window.amp = bridge;
  return bridge;
}

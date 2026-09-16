/**
 * The host contract that every Amp surface implements: the Electron main
 * process (over the preload bridge), the browser demo bridge used by the
 * marketing build and by server.py, and the tests.
 *
 * Keeping it in @amp/core means the renderer, the preload script and the
 * Python-facing server all agree on the same shapes.
 */

import type {
  Book,
  Chapter,
  DownloadItem,
  LibraryState,
  QBittorrentConfig,
  Settings,
  TorrentResult,
  TranscriberJob,
  TranscriptDoc,
} from "./types";

export interface TorrentImportResult extends ImportResult {
  /** Finished transfers that were inspected. */
  examined?: number;
  /** Downloads that were imported with something missing. */
  warnings?: string[];
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  books: Book[];
  errors: string[];
  /**
   * How many audio files the import actually found.
   *
   * `books` being empty means one of two very different things - there was no
   * audio where the user pointed, or the audio is already on the shelf - and
   * without this number the interface could only report both as "imported 0
   * books", which reads as "Amp is broken".
   */
  found?: number;
}

export interface CoverCandidate {
  id: string;
  title: string;
  author?: string;
  thumbnail: string;
  full: string;
  source: string;
}

export interface ServerStatus {
  running: boolean;
  url?: string;
  clients?: number;
  error?: string;
}

export interface ProbeResult {
  available: boolean;
  version?: string;
  detail?: string;
}

export interface AmpBridge {
  readonly platform: "electron" | "web" | "server";
  readonly version: string;
  readonly demo: boolean;
  capabilities: {
    /** The host can open a native file/folder picker. */
    nativeImport: boolean;
    /** The host imports by absolute path, so a client without a picker works. */
    importByPath: boolean;
    covers: boolean;
    torrents: boolean;
    transcription: boolean;
    server: boolean;
    tray: boolean;
    updater: boolean;
    writeChapters: boolean;
    revealFolder: boolean;
  };
  library: {
    load(): Promise<LibraryState>;
    save(state: LibraryState): Promise<void>;
    importPaths(
      paths: string[],
      options?: { groupFolders?: boolean; folderId?: string | null },
    ): Promise<ImportResult>;
    pickFiles(): Promise<string[]>;
    pickFolder(): Promise<string | null>;
    rescan(): Promise<ImportResult>;
    /** Copy an embedded cover out of the audio file into the app cache. */
    extractCover(book: Pick<Book, "id" | "sourcePath">): Promise<string | null>;
    saveCover(
      bookId: string,
      image: { dataUrl?: string; url?: string; path?: string },
    ): Promise<string | null>;
    removeCover(bookId: string): Promise<void>;
    searchCovers(query: string, provider: string): Promise<CoverCandidate[]>;
    /**
     * What the operating system says about starting Amp at login. Optional:
     * only the desktop host has login items, and a browser answering "not
     * supported" is the honest answer, not a missing feature.
     */
    startup?(): Promise<{ supported: boolean; openAtLogin: boolean; startHidden: boolean }>;
    /** Playable URL for an absolute file path. */
    fileUrl(path: string): string;
    revealInFolder(path: string): Promise<void>;
    /** Rewrite embedded chapters (desktop: ffmpeg, otherwise a no-op). */
    writeChapters(bookId: string, chapters: Chapter[]): Promise<{ ok: boolean; detail?: string }>;
    stats(): Promise<{ diskBytes: number; dataDir: string }>;
  };
  torrents: {
    search(query: string, sources?: string[]): Promise<TorrentResult[]>;
    test(config: QBittorrentConfig): Promise<ProbeResult>;
    /**
     * Queue a download. `magnet` may be empty when the result came from a site
     * that only exposes the info hash on its detail page: the host then
     * resolves `meta.url` and adds the magnet it finds.
     */
    add(
      magnet: string,
      meta?: { name?: string; resultId?: string; url?: string; infoHash?: string },
    ): Promise<{ ok: boolean; detail?: string }>;
    list(): Promise<DownloadItem[]>;
    pause(hash: string): Promise<void>;
    resume(hash: string): Promise<void>;
    remove(hash: string, deleteFiles?: boolean): Promise<void>;
    openFolder(path: string): Promise<void>;
    /**
     * Import finished downloads into the library.
     *
     * `added` counts books that were not on the shelf before, `updated` those
     * that were, `examined` how many finished transfers were looked at, and a
     * download that could not be read is named in `errors` rather than being
     * swallowed - the interface needs to be able to say which of those
     * happened instead of reporting every case as "0 books imported".
     */
    importCompleted(hash?: string): Promise<TorrentImportResult>;
    /** Add a .torrent file that is already on disk. */
    addFile(filePath: string, meta?: { name?: string }): Promise<{ ok: boolean; detail?: string }>;
    /** Let the user pick .torrent files and queue them. */
    pickFiles(): Promise<{ ok: boolean; detail?: string }>;
  };
  transcription: {
    probe(): Promise<ProbeResult>;
    start(bookId: string, chapterIndexes?: number[]): Promise<TranscriberJob>;
    status(jobId: string): Promise<TranscriberJob | null>;
    cancel(jobId: string): Promise<void>;
    get(bookId: string): Promise<TranscriptDoc | null>;
    jobs(): Promise<TranscriberJob[]>;
  };
  player: {
    setMini(mini: boolean): Promise<void>;
    setAlwaysOnTop(value: boolean): Promise<void>;
    setMiniSize(size: { width: number; height: number }): Promise<void>;
    hideToTray(): Promise<void>;
    wake(): Promise<void>;
    quit(): Promise<void>;
    setGlobalShortcuts(map: Record<string, string>): Promise<{ ok: boolean; failed: string[] }>;
    /** Media keys / tray menu / global hotkeys push commands here. */
    onCommand(handler: (command: string, payload?: unknown) => void): () => void;
    /** Main process reacts to window state so the UI can mirror it. */
    onWindowState(
      handler: (state: { mini: boolean; focused: boolean; alwaysOnTop: boolean }) => void,
    ): () => void;
    setMediaSession(metadata: {
      title: string;
      artist: string;
      album: string;
      artwork?: string;
    }): Promise<void>;
    openExternal(url: string): Promise<void>;
    /**
     * Window commands. "flyout" is the compact always-on-top window that parks
     * itself next to the tray; it is a toggle, and the desktop build answers
     * with the new state.
     */
    window(action: "minimize" | "maximize" | "close" | "fullscreen" | "flyout"): Promise<void>;
  };
  settings: {
    load(): Promise<Settings>;
    save(settings: Settings): Promise<void>;
    export(): Promise<string>;
    import(json: string): Promise<Settings>;
  };
  server: {
    start(): Promise<ServerStatus>;
    stop(): Promise<ServerStatus>;
    status(): Promise<ServerStatus>;
  };
  updater: {
    check(): Promise<{ available: boolean; version?: string; url?: string }>;
    open(): Promise<void>;
  };
  logs(): Promise<string[]>;
}

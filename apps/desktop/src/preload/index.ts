/**
 * The preload bridge.
 *
 * Everything the renderer can do to the operating system passes through here,
 * one method per AmpBridge entry in @amp/core. No Node APIs leak into the
 * window: `contextBridge` copies plain functions and values only.
 */

import { contextBridge, ipcRenderer } from "electron";
import type {
  AmpBridge,
  Book,
  Chapter,
  CoverCandidate,
  DownloadItem,
  ImportResult,
  LibraryState,
  ProbeResult,
  QBittorrentConfig,
  ServerStatus,
  Settings,
  TorrentResult,
  TranscriberJob,
  TranscriptDoc,
} from "@amp/core";
import { mediaUrl } from "@amp/core";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => handler(payload);
  ipcRenderer.on(channel, listener as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void);
  return () => {
    ipcRenderer.removeListener(channel, listener as (event: Electron.IpcRendererEvent, ...args: unknown[]) => void);
  };
}

const amp: AmpBridge = {
  platform: "electron",
  version: process.env.npm_package_version ?? "1.0.0",
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
    load: () => invoke<LibraryState>("library:load"),
    save: (state) => invoke<void>("library:save", state),
    importPaths: (paths, options) => invoke<ImportResult>("library:import", paths, options),
    pickFiles: () => invoke<string[]>("library:pick-files"),
    pickFolder: () => invoke<string | null>("library:pick-folder"),
    rescan: () => invoke<ImportResult>("library:rescan"),
    extractCover: (book: Pick<Book, "id" | "sourcePath">) => invoke<string | null>("library:extract-cover", book),
    startup: () => invoke<{ supported: boolean; openAtLogin: boolean; startHidden: boolean }>("app:startup"),
    saveCover: (bookId, image) => invoke<string | null>("library:save-cover", bookId, image),
    removeCover: (bookId) => invoke<void>("library:remove-cover", bookId),
    searchCovers: (query, provider) => invoke<CoverCandidate[]>("library:search-covers", query, provider),
    // The renderer plays audio through the amp-media scheme (see main/index.ts).
    // mediaUrl knows a Windows drive letter is a path and a https URL is not.
    fileUrl: (filePath) => mediaUrl(filePath),
    revealInFolder: (target) => invoke<void>("library:reveal", target),
    writeChapters: (bookId, chapters: Chapter[]) => invoke("library:write-chapters", bookId, chapters),
    stats: () => invoke("library:stats"),
  },
  torrents: {
    search: (query, sources) => invoke<TorrentResult[]>("torrents:search", query, sources),
    test: (config: QBittorrentConfig) => invoke<ProbeResult>("torrents:test", config),
    add: (magnet, meta) => invoke("torrents:add", magnet, meta),
    list: () => invoke<DownloadItem[]>("torrents:list"),
    pause: (hash) => invoke("torrents:pause", hash),
    resume: (hash) => invoke("torrents:resume", hash),
    remove: (hash, deleteFiles) => invoke("torrents:remove", hash, deleteFiles),
    openFolder: (target) => invoke("torrents:open-folder", target),
    importCompleted: () => invoke<ImportResult>("torrents:import-completed"),
  },
  transcription: {
    probe: () => invoke<ProbeResult>("transcription:probe"),
    start: (bookId, chapterIndexes) => invoke<TranscriberJob>("transcription:start", bookId, chapterIndexes),
    status: (jobId) => invoke<TranscriberJob | null>("transcription:status", jobId),
    cancel: (jobId) => invoke("transcription:cancel", jobId),
    get: (bookId) => invoke<TranscriptDoc | null>("transcription:get", bookId),
    jobs: () => invoke<TranscriberJob[]>("transcription:jobs"),
  },
  player: {
    setMini: (mini) => invoke("player:set-mini", mini),
    setAlwaysOnTop: (value) => invoke("player:set-always-on-top", value),
    setMiniSize: (size) => invoke("player:set-mini-size", size),
    hideToTray: () => invoke("player:hide-to-tray"),
    wake: () => invoke("player:wake"),
    quit: () => invoke("player:quit"),
    setGlobalShortcuts: (map) => invoke("player:global-shortcuts", map),
    onCommand: (handler) => subscribe<{ command: string; payload?: unknown }>("player:command", (event) => handler(event.command, event.payload)),
    onWindowState: (handler) => subscribe<{ mini: boolean; focused: boolean; alwaysOnTop: boolean }>("player:window-state", handler),
    setMediaSession: (metadata) => invoke("player:media-session", metadata),
    openExternal: (url) => invoke("player:open-external", url),
    window: (action) => invoke("player:window", action),
  },
  settings: {
    load: () => invoke<Settings>("settings:load"),
    save: (settings) => invoke("settings:save", settings),
    export: () => invoke<string>("settings:export"),
    import: (json) => invoke<Settings>("settings:import", json),
  },
  server: {
    start: () => invoke<ServerStatus>("server:start"),
    stop: () => invoke<ServerStatus>("server:stop"),
    status: () => invoke<ServerStatus>("server:status"),
  },
  updater: {
    check: () => invoke("updater:check"),
    open: (url?: string) => invoke("updater:open", url),
  },
  logs: () => invoke<string[]>("logs:read"),
};

contextBridge.exposeInMainWorld("amp", amp);

export type AmpDesktop = {
  splitChapters(bookId: string, destination: string): Promise<{ ok: boolean; detail?: string }>;
  probeFile(file: string): Promise<unknown>;
  capabilities(): Promise<{ ffmpeg: boolean }>;
  transcriptionBooks(): Promise<string[]>;
  revealTranscript(bookId: string): Promise<void>;
  reportPlayback(bookId: string | null, state: unknown): void;
  sendCommand(command: string, payload?: unknown): void;
  openPath(target: string): void;
  copy(text: string): Promise<void>;
  paths(): Promise<{ data: string; settings: string; transcripts: string }>;
  logsFolder(): Promise<void>;
  ready(): void;
  windowState(): Promise<{ mini: boolean; focused: boolean; alwaysOnTop: boolean }>;
};

// Extra escape hatches the renderer uses for desktop-only extras. They are
// namespaced so the AmpBridge contract stays small.
contextBridge.exposeInMainWorld("ampDesktop", {
  splitChapters: (bookId: string, destination: string) => invoke("library:split-chapters", bookId, destination),
  probeFile: (file: string) => invoke("library:probe", file),
  capabilities: () => invoke("library:capabilities"),
  transcriptionBooks: () => invoke<string[]>("transcription:books"),
  revealTranscript: (bookId: string) => invoke("transcription:reveal", bookId),
  reportPlayback: (bookId: string | null, state: unknown) => ipcRenderer.send("renderer:playback", bookId, state),
  sendCommand: (command: string, payload?: unknown) => ipcRenderer.send("renderer:command", command, payload),
  openPath: (target: string) => ipcRenderer.send("renderer:open-path", target),
  copy: (text: string) => invoke("player:copy", text),
  paths: () => invoke("paths:show"),
  logsFolder: () => invoke("logs:open-folder"),
  ready: () => ipcRenderer.send("renderer:ready"),
  windowState: () => invoke("player:state"),
});

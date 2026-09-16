/**
 * Every IPC handler the renderer can reach, in one place.
 *
 * The channel list mirrors the AmpBridge contract in @amp/core: if a method
 * exists in the contract there is a handler here, and the preload script is a
 * thin pass-through. Nothing else is exposed to the renderer.
 */

import { BrowserWindow, app, clipboard, dialog, ipcMain, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Book,
  type Chapter,
  type ImportResult,
  type LibraryState,
  type QBittorrentConfig,
  type Settings,
  type TranscriptDoc,
} from "@amp/core";
import { appState } from "./state";
import { logLine, readLogTail, settingsStore, libraryStore } from "./store";
import { importPaths, libraryStats, rescanLibrary } from "./library";
import {
  coverSearchUrl,
  extractCover,
  removeCover,
  saveCoverFromDataUrl,
  saveCoverFromFile,
  saveCoverFromUrl,
  searchCovers,
} from "./covers";
import { hasFfmpeg, probeMedia, splitIntoChapters, writeChapters } from "./chapters";
import { applyLoginItem } from "./startup";
import { finishedAudioFiles, createQBittorrentClient } from "./torrents";
import { resolveMagnet, searchAudiobookBay } from "./abb";
import { buildMagnet } from "@amp/core";
import {
  cancelTranscription,
  jobStatus,
  listJobs,
  listTranscriptBooks,
  probeWhisper,
  readTranscript,
  transcriptDir,
  startTranscription,
} from "./whisper";
import { serverStatus, startServer, stopServer } from "./server";
import {
  currentWindowState,
  focusMainWindow,
  getMainWindow,
  sendCommand,
  setAlwaysOnTop,
  setMini,
  setMiniSize,
  windowAction,
} from "./windows";
import { registerGlobalShortcuts } from "./shortcuts";
import { existsSync } from "node:fs";

function fileUrl(filePath: string): string {
  if (!filePath) return "";
  if (filePath.startsWith("file://")) return filePath;
  return pathToFileURL(filePath).href;
}

function rendererDir(): string {
  return path.join(__dirname, "../renderer");
}

let registered = false;

export function registerIpc(): void {
  if (registered) return;
  registered = true;

  /* ---------------------------------------------------------------- library */
  ipcMain.handle("library:load", () => appState.library);
  ipcMain.handle("library:save", async (_event, state: LibraryState) => {
    await appState.setLibrary(state);
  });
  ipcMain.handle("library:pick-files", async () => {
    const result = await dialog.showOpenDialog({
      title: "Add audiobooks",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "Audiobooks", extensions: ["m4b", "m4a", "mp3", "mp4", "flac", "ogg", "opus", "aac"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("library:pick-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "Add a folder of audiobooks",
      properties: ["openDirectory", "multiSelections"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(
    "library:import",
    async (_event, paths: string[], options?: { groupFolders?: boolean; folderId?: string | null }) => {
      const result = await importPaths(paths, {
        groupFolders: options?.groupFolders ?? appState.settings.library.groupFolders,
        folderId: options?.folderId ?? null,
        settings: appState.settings,
        existing: appState.library.books,
      });
      await commitImport(result);
      return { ...result, books: result.books } satisfies ImportResult;
    },
  );
  ipcMain.handle("library:rescan", async () => {
    const result = await rescanLibrary(appState.library, appState.settings);
    await commitImport(result);
    return { ...result } satisfies ImportResult;
  });
  ipcMain.handle("library:extract-cover", async (_event, book: Pick<Book, "id" | "sourcePath">) => {
    const full =
      appState.book(book.id) ?? ({ ...book, chapters: [], kind: "single", duration: 0 } as unknown as Book);
    const cover = await extractCover(full);
    return cover?.path ?? null;
  });
  ipcMain.handle(
    "library:save-cover",
    async (_event, bookId: string, image: { dataUrl?: string; url?: string; path?: string }) => {
      try {
        if (image.dataUrl) return await saveCoverFromDataUrl(bookId, image.dataUrl);
        if (image.url) return await saveCoverFromUrl(bookId, image.url);
        if (image.path) return await saveCoverFromFile(bookId, image.path);
        return null;
      } catch (error) {
        await logLine(
          `cover: save failed for ${bookId} - ${error instanceof Error ? error.message : "unknown"}`,
        );
        return null;
      }
    },
  );
  ipcMain.handle("library:remove-cover", async (_event, bookId: string) => {
    await removeCover(bookId);
  });
  ipcMain.handle("library:search-covers", async (_event, query: string, provider: string) => {
    const results = await searchCovers(query, { limit: 24 });
    if (provider === "browser") await shell.openExternal(coverSearchUrl(query));
    return results;
  });
  ipcMain.handle("library:open-cover-search", async (_event, query: string) => {
    await shell.openExternal(coverSearchUrl(query));
  });
  ipcMain.handle("library:file-url", (_event, filePath: string) => fileUrl(filePath));
  ipcMain.handle("library:reveal", async (_event, target: string) => {
    if (!target) return;
    try {
      const stat = await fs.stat(target);
      if (stat.isDirectory()) await shell.openPath(target);
      else shell.showItemInFolder(target);
    } catch {
      await shell.openPath(path.dirname(target));
    }
  });
  ipcMain.handle("library:write-chapters", async (_event, bookId: string, chapters: Chapter[]) => {
    const book = appState.book(bookId);
    if (!book) return { ok: false, detail: "Unknown book" };
    const result = await writeChapters(book, chapters);
    return { ok: result.ok, detail: result.message };
  });
  ipcMain.handle("library:split-chapters", async (_event, bookId: string, destination: string) => {
    const book = appState.book(bookId);
    if (!book) return { ok: false, detail: "Unknown book" };
    const written = await splitIntoChapters(book, book.chapters, destination);
    return { ok: written.length > 0, detail: `${written.length} file(s) written` };
  });
  ipcMain.handle("library:probe", async (_event, file: string) => probeMedia(file));
  ipcMain.handle("library:capabilities", async () => ({ ffmpeg: await hasFfmpeg() }));
  ipcMain.handle("library:stats", async () => {
    const stats = await libraryStats(appState.library);
    return {
      diskBytes: stats.diskBytes,
      dataDir: stats.dataDir,
      books: stats.books,
      missing: stats.missing,
      covers: stats.covers,
      transcripts: stats.transcripts,
    };
  });

  /* --------------------------------------------------------------- torrents */
  ipcMain.handle("torrents:search", async (_event, query: string, sources?: string[]) => {
    const wanted = sources ?? ["audiobookbay"];
    if (wanted.includes("qbittorrent")) {
      const client = createQBittorrentClient(appState.settings.torrents.qbittorrent);
      return client.search(query).catch(() => searchAudiobookBay(query, { limit: 40 }));
    }
    return searchAudiobookBay(query, { limit: 40 });
  });
  ipcMain.handle("torrents:test", async (_event, config: QBittorrentConfig) => {
    const client = createQBittorrentClient(config);
    const result = await client.testConnection();
    return { available: result.ok, version: result.version, detail: result.message };
  });
  ipcMain.handle(
    "torrents:add",
    async (
      _event,
      magnet: string,
      meta?: { name?: string; resultId?: string; url?: string; infoHash?: string },
    ) => {
      const client = createQBittorrentClient(appState.settings.torrents.qbittorrent);
      let uri = magnet;
      if (!uri.startsWith("magnet:") && meta?.infoHash) {
        uri = buildMagnet(meta.infoHash, meta.name ?? "audiobook");
      }
      if (!uri.startsWith("magnet:") && meta?.url) {
        // Sources like AudioBookBay publish the info hash on the detail page only.
        const resolved = await resolveMagnet(meta.url);
        uri = resolved.magnet ?? "";
      }
      if (!uri) {
        return { ok: false, detail: "No magnet link was found for that release." };
      }
      if (!uri.startsWith("magnet:")) {
        // qBittorrent can also fetch a .torrent URL directly.
        return client.add({ url: uri, name: meta?.name });
      }
      return client.add({ magnet: uri, name: meta?.name });
    },
  );
  ipcMain.handle("torrents:list", async () => {
    const client = createQBittorrentClient(appState.settings.torrents.qbittorrent);
    return client.list();
  });
  ipcMain.handle("torrents:pause", async (_event, hash: string) => {
    await createQBittorrentClient(appState.settings.torrents.qbittorrent).pause(hash);
  });
  ipcMain.handle("torrents:resume", async (_event, hash: string) => {
    await createQBittorrentClient(appState.settings.torrents.qbittorrent).resume(hash);
  });
  ipcMain.handle("torrents:remove", async (_event, hash: string, deleteFiles = false) => {
    await createQBittorrentClient(appState.settings.torrents.qbittorrent).remove(hash, deleteFiles);
  });
  ipcMain.handle("torrents:open-folder", async (_event, target: string) => {
    if (target) await shell.openPath(target);
  });
  ipcMain.handle("torrents:import-completed", async (_event, hash?: string) => {
    const client = createQBittorrentClient(appState.settings.torrents.qbittorrent);
    const items = await client.list();
    const targets = hash ? items.filter((item) => item.hash === hash) : items;
    const collected: Book[] = [];
    const errors: string[] = [];
    for (const item of targets) {
      try {
        const files = await finishedAudioFiles(client, item.hash);
        if (!files.length) continue;
        const result = await importPaths(
          files.map((file) => file.path),
          {
            groupFolders: appState.settings.library.groupFolders,
            settings: appState.settings,
            existing: appState.library.books,
          },
        );
        for (const book of result.books) book.torrent = { hash: item.hash, title: item.name };
        collected.push(...result.books);
      } catch (error) {
        errors.push(`${item.name}: ${error instanceof Error ? error.message : "import failed"}`);
      }
    }
    // A download that is reported as imported has to be in the library: this is
    // the step that used to be missing, which made the toast a lie.
    const added = await commitImport({
      added: collected.length,
      updated: 0,
      skipped: 0,
      books: collected,
      errors,
    });
    return { added: added.added, updated: 0, skipped: 0, books: collected, errors };
  });

  /**
   * Fold imported books into the host library and write it out.
   *
   * Book objects are matched by id, so a re-import updates the copy that is
   * already there instead of duplicating it. Without this step the renderer is
   * told "3 books imported" while the library it reloads is empty - the books
   * never reached the file.
   */
  async function commitImport(result: ImportResult): Promise<ImportResult> {
    if (!result.books.length) return result;
    const byId = new Map(appState.library.books.map((book) => [book.id, book]));
    let added = 0;
    for (const book of result.books) {
      const existing = byId.get(book.id);
      if (existing) byId.set(book.id, { ...existing, ...book });
      else {
        byId.set(book.id, book);
        added += 1;
      }
    }
    const library: LibraryState = { ...appState.library, books: [...byId.values()] };
    await appState.setLibrary(library);
    return { ...result, added: result.added || added };
  }

  /* ---------------------------------------------------------- transcription */
  ipcMain.handle("transcription:probe", async () => {
    const probe = await probeWhisper();
    return { available: probe.available, version: probe.kind, detail: probe.message };
  });
  ipcMain.handle("transcription:start", async (_event, bookId: string, chapterIndexes?: number[]) => {
    const book = appState.book(bookId);
    if (!book) throw new Error("Unknown book");
    const input = book.chapters[0]?.file ?? book.sourcePath;
    return startTranscription({
      bookId,
      input,
      model: appState.settings.transcription.model,
      language: appState.settings.transcription.language || undefined,
      chapterIndexes,
    });
  });
  ipcMain.handle("transcription:status", async (_event, jobId: string) => jobStatus(jobId) ?? null);
  ipcMain.handle("transcription:cancel", async (_event, jobId: string) => {
    cancelTranscription(jobId);
  });
  ipcMain.handle("transcription:get", async (_event, bookId: string): Promise<TranscriptDoc | null> =>
    readTranscript(bookId, appState.settings.transcription.model),
  );
  ipcMain.handle("transcription:jobs", async () => listJobs());
  ipcMain.handle("transcription:books", async () => listTranscriptBooks());
  ipcMain.handle("transcription:reveal", async (_event, bookId: string) => {
    await shell.openPath(transcriptDir(bookId));
  });

  /* ---------------------------------------------------------------- player */
  ipcMain.handle("player:set-mini", async (_event, mini: boolean) => {
    setMini(mini, appState.settings);
    await appState.setSettings({
      ...appState.settings,
      window: { ...appState.settings.window, mini },
    });
  });
  ipcMain.handle("player:set-always-on-top", async (_event, value: boolean) => {
    setAlwaysOnTop(value, appState.settings);
    await appState.setSettings({
      ...appState.settings,
      window: { ...appState.settings.window, alwaysOnTop: value },
    });
  });
  ipcMain.handle("player:set-mini-size", async (_event, size: { width: number; height: number }) => {
    setMiniSize(size);
    await appState.setSettings({
      ...appState.settings,
      window: { ...appState.settings.window, miniSize: size },
    });
  });
  ipcMain.handle("player:hide-to-tray", async () => {
    getMainWindow()?.hide();
  });
  ipcMain.handle("player:wake", async () => {
    focusMainWindow();
  });
  ipcMain.handle("player:quit", async () => {
    app.quit();
  });
  ipcMain.handle("player:global-shortcuts", async (_event, map: Record<string, string>) =>
    registerGlobalShortcuts(map),
  );
  ipcMain.handle("player:state", async () => currentWindowState());
  ipcMain.handle("player:report", async (_event, bookId: string | null, state: unknown) => {
    const book = bookId ? (appState.book(bookId) ?? null) : null;
    appState.setPlayback(book, state as typeof appState.playback);
  });
  ipcMain.handle("player:open-external", async (_event, url: string) => {
    if (/^https?:/i.test(url)) await shell.openExternal(url);
  });
  ipcMain.handle("player:copy", async (_event, text: string) => {
    clipboard.writeText(text);
  });
  ipcMain.handle(
    "player:window",
    async (_event, action: "minimize" | "maximize" | "close" | "fullscreen" | "flyout") => {
      windowAction(action);
    },
  );
  ipcMain.handle("player:media-session", async () => {
    // Media keys are registered as global shortcuts on the desktop build.
    return { ok: true };
  });

  /* -------------------------------------------------------------- settings */
  ipcMain.handle("settings:load", async () => appState.settings);
  /**
   * What the operating system actually says about starting Amp at login.
   *
   * The checkbox reads this rather than the settings file: on Linux the answer
   * depends on the desktop environment, and a checkbox that lies about having
   * worked is worse than one that says it could not.
   */
  ipcMain.handle("app:startup", async () => {
    const item = app.getLoginItemSettings();
    return {
      supported: process.platform !== "linux" || Boolean(process.env.XDG_CURRENT_DESKTOP),
      openAtLogin: item.openAtLogin,
      startHidden: appState.settings.desktop.startHidden,
    };
  });
  ipcMain.handle("settings:save", async (_event, settings: Settings) => {
    await appState.setSettings(settings);
    // Starting with the operating system is a main-process fact, not a setting
    // the renderer can enact: the login item is written here, every time the
    // settings are, so the checkbox and the system agree.
    applyLoginItem(settings);
    // Window behaviour lives in the main process: apply it right away.
    const window = getMainWindow();
    if (window) {
      if (settings.window.mini !== appState.playback.playing && settings.window.mini) setMini(true, settings);
      window.setAlwaysOnTop(settings.window.alwaysOnTop);
    }
  });
  ipcMain.handle("settings:export", async () => {
    const result = await dialog.showSaveDialog({
      title: "Export Amp settings",
      defaultPath: path.join(app.getPath("documents"), "amp-settings.json"),
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return "";
    await fs.writeFile(result.filePath, JSON.stringify(appState.settings, null, 2), "utf8");
    return result.filePath;
  });
  ipcMain.handle("settings:import", async (_event, json?: string) => {
    if (json) {
      await appState.setSettings(JSON.parse(json) as Settings);
      return appState.settings;
    }
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return appState.settings;
    const content = await fs.readFile(result.filePaths[0], "utf8");
    await appState.setSettings(JSON.parse(content) as Settings);
    return appState.settings;
  });

  /* ---------------------------------------------------------------- server */
  ipcMain.handle("server:start", async () =>
    startServer({
      port: appState.settings.server.port,
      host: appState.settings.server.host,
      rendererDir: rendererDir(),
      loadLibrary: async () => appState.library,
      saveLibrary: async (state) => appState.setLibrary(state as LibraryState),
      loadSettings: async () => appState.settings,
    }),
  );
  ipcMain.handle("server:stop", async () => stopServer());
  ipcMain.handle("server:status", async () => serverStatus());

  /* --------------------------------------------------------------- updater */
  ipcMain.handle("updater:check", async () => {
    try {
      const response = await fetch("https://api.github.com/repos/amp-app/amp/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) return { available: false };
      const payload = (await response.json()) as { tag_name?: string; html_url?: string };
      const latest = (payload.tag_name ?? "").replace(/^v/, "");
      const current = app.getVersion();
      return {
        available: Boolean(latest) && latest !== current,
        version: latest || undefined,
        url: payload.html_url,
      };
    } catch {
      return { available: false };
    }
  });
  ipcMain.handle("updater:open", async (_event, url?: string) => {
    await shell.openExternal(url ?? "https://github.com/opngo/amp/releases");
  });

  /* ------------------------------------------------------------------ logs */
  ipcMain.handle("logs:read", async () => readLogTail(120));
  ipcMain.handle("logs:open-folder", async () => {
    await shell.openPath(logsDir());
  });
  ipcMain.handle("paths:show", async () => ({
    data: libraryStore.dir,
    settings: settingsStore.file,
    transcripts: transcriptDir(""),
  }));

  /* -------------------------------------------------------- renderer -> main */
  ipcMain.on("renderer:ready", () => {
    const window = getMainWindow();
    window?.webContents.send("player:window-state", currentWindowState());
  });
  ipcMain.on("renderer:playback", (_event, bookId: string | null, state: unknown) => {
    const book = bookId ? (appState.book(bookId) ?? null) : null;
    appState.setPlayback(book, state as typeof appState.playback);
  });
  ipcMain.on("renderer:command", (_event, command: string, payload?: unknown) => {
    sendCommand(command, payload);
  });
  ipcMain.on("renderer:open-path", async (_event, target: string) => {
    if (target && existsSync(target)) await shell.openPath(target);
  });
}

function logsDir(): string {
  return path.join(app.getPath("userData"), "logs");
}

export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

export { appState };

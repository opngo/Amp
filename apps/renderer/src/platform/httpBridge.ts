/**
 * Browser bridge: talks to a real Amp server over HTTP.
 *
 * This is what runs when the renderer is opened in a browser - either through
 * the optional remote server (`python/server.py`, or Settings > Server in the
 * desktop app) or on another machine on your tailnet. It is a thin client for
 * the same API the desktop app exposes, so there is no second implementation
 * of anything: the library, settings, covers, audio, transcripts, AudioBookBay
 * search and qBittorrent downloads all come from the machine running the
 * server.
 *
 * There is no demo data. If no server answers, the app shows a connect screen
 * with the exact URL to open instead of pretending to have a library.
 */

import type {
  AmpBridge,
  Book,
  Chapter,
  CoverCandidate,
  DownloadItem,
  LibraryState,
  QBittorrentConfig,
  Settings,
  TorrentResult,
  TranscriptDoc,
} from "@amp/core";
import { emptyLibrary, defaultSettings } from "@amp/core";

const CONNECTION_KEY = "amp.server.connection.v1";

export interface ServerConnection {
  url: string;
  token: string;
}

/** Reads `?server=...&token=...`, or the last connection saved in this browser. */
export function readConnection(): ServerConnection | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const url = params.get("server");
  const token = params.get("token") ?? "";
  if (url) {
    const connection = { url: url.replace(/\/+$/, ""), token };
    saveConnection(connection);
    return connection;
  }
  try {
    const raw = window.localStorage.getItem(CONNECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ServerConnection;
    if (!parsed.url) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveConnection(connection: ServerConnection): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
  } catch {
    /* private mode: the connection just will not be remembered */
  }
}

export function clearConnection(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CONNECTION_KEY);
}

function endpoint(base: string, path: string, token: string): string {
  const url = new URL(path, `${base}/`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

async function request(base: string, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(endpoint(base, path, token), {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  return response;
}

interface JsonOptions {
  init?: RequestInit;
  /** Treat 404 as "nothing here yet" instead of an error (transcripts, covers). */
  optional?: boolean;
}

async function json<T>(base: string, token: string, path: string, options: JsonOptions = {}): Promise<T> {
  const response = await request(base, token, path, options.init);
  if (response.status === 401) throw new Error("The server rejected the token. Check the URL you opened.");
  if (options.optional && response.status === 404) return null as T;
  if (!response.ok) {
    // The host explains failures in its body ("cannot reach qBittorrent at ..."),
    // and that reason is far more useful than the status code alone.
    const reason = await response
      .json()
      .then(
        (payload: { error?: string; detail?: string; message?: string }) =>
          payload?.error ?? payload?.detail ?? payload?.message ?? null,
      )
      .catch(() => null);
    throw new Error(reason ?? `${path} failed with ${response.status}`);
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface HttpBridgeOptions {
  connection: ServerConnection;
}

/**
 * Implements the same contract as the Electron preload bridge, over the
 * server API documented in docs/remote-server.md.
 */
export function createHttpBridge(options: HttpBridgeOptions): AmpBridge {
  const { url, token } = options.connection;
  let version = "server";
  let platform: AmpBridge["platform"] = "server";
  const ready = json<{ ok: boolean; app?: string; version?: string; platform?: string }>(
    url,
    token,
    "/api/health",
  )
    .then((health) => {
      if (health?.version) version = health.version;
      if (health?.platform === "electron") platform = "server";
    })
    .catch(() => undefined);

  /** Absolute URL of an audio file on the host, token included. */
  const audioUrl = (filePath: string) =>
    endpoint(url, `/api/audio?path=${encodeURIComponent(filePath)}`, token);

  const bridge: AmpBridge = {
    get platform() {
      return platform;
    },
    get version() {
      return version;
    },
    demo: false,
    capabilities: {
      // A browser cannot open a native picker: imports are by path on the host.
      nativeImport: false,
      importByPath: true,
      // Covers, search and finished transcripts are served by the host, so they
      // work here. Starting a job does not: Whisper runs on the host.
      covers: true,
      torrents: true,
      transcription: true,
      server: false,
      tray: false,
      updater: false,
      writeChapters: false,
      revealFolder: false,
    },
    library: {
      async load() {
        await ready;
        // Straight from the host. Cover art and banners are resolved by path
        // when the interface draws them (see platform/artwork.ts), so no URL is
        // written into the library just for display - doing that meant the URL
        // the user chose and a URL we added for display shared one field, and
        // saving had to guess which was which.
        return json<LibraryState>(url, token, "/api/library");
      },
      async save(state: LibraryState) {
        await json(url, token, "/api/library", {
          init: { method: "PUT", body: JSON.stringify(state) },
        });
      },
      async importPaths(paths) {
        const result = await json<{ added?: number; scanned?: number; books?: Book[] }>(
          url,
          token,
          "/api/import",
          {
            init: {
              method: "POST",
              body: JSON.stringify({ paths }),
            },
          },
        );
        return {
          added: result.added ?? 0,
          updated: 0,
          skipped: Math.max(0, (result.scanned ?? 0) - (result.added ?? 0)),
          books: result.books ?? [],
          errors: [],
        };
      },
      async pickFiles() {
        // A browser cannot read local paths; the server imports by path.
        return [];
      },
      async pickFolder() {
        return null;
      },
      async rescan() {
        return { added: 0, updated: 0, skipped: 0, books: [], errors: ["Rescan runs on the host machine."] };
      },
      async startup() {
        // A page cannot register a login item; the host owns that.
        return { supported: false, openAtLogin: false, startHidden: false };
      },
      async extractCover(book) {
        // The host extracts the embedded art and answers with where it put it.
        const result = await json<{ path?: string }>(url, token, "/api/cover/extract", {
          init: { method: "POST", body: JSON.stringify({ bookId: book.id }) },
        });
        return result?.path ?? null;
      },
      async saveCover(bookId, image) {
        // The page cannot write to the host's disk, so the image travels there
        // and the host stores it; the path it returns is the book's new cover.
        const result = await json<{ path?: string }>(url, token, "/api/cover", {
          init: {
            method: "POST",
            body: JSON.stringify({ bookId, which: "cover", dataUrl: image.dataUrl, url: image.url }),
          },
        });
        return result?.path ?? null;
      },
      async removeCover() {
        /* covers are managed on the host */
      },
      async searchCovers(query: string, provider: string) {
        // The host does the lookup: a page served over the network cannot call
        // Open Library itself, and the desktop app searches from its main process.
        const queryText = `/api/covers?q=${encodeURIComponent(query)}&provider=${encodeURIComponent(provider)}`;
        const payload = await json<{ candidates: CoverCandidate[] }>(url, token, queryText);
        return payload.candidates ?? [];
      },
      fileUrl(path: string) {
        if (!path) return "";
        return audioUrl(path);
      },
      async revealInFolder() {
        /* not available remotely */
      },
      async writeChapters() {
        return { ok: false, detail: "Chapter writing runs on the host machine." };
      },
      async stats() {
        const stats = await json<{ diskBytes?: number; dataDir?: string }>(url, token, "/api/stats");
        return { diskBytes: stats?.diskBytes ?? 0, dataDir: stats?.dataDir ?? url };
      },
    },
    torrents: {
      async search(query: string) {
        // No query means "what is new on AudioBookBay" - the front page.
        const payload = await json<{ results?: TorrentResult[] }>(
          url,
          token,
          `/api/search?q=${encodeURIComponent(query)}`,
        );
        return (payload?.results ?? []).map((row, index) => ({
          ...row,
          id: row.id ?? `${row.title}-${index}`,
          source: row.source ?? "audiobookbay",
        }));
      },
      async test(config: QBittorrentConfig) {
        void config;
        // The host owns the qBittorrent connection: ask it, and report what it
        // says rather than assuming a running server means a running client.
        try {
          // 503 is the normal "client is down" answer, and its body carries the
          // reason, so the status is read instead of thrown.
          const response = await request(url, token, "/api/qbittorrent");
          const payload = (await response.json().catch(() => null)) as {
            ok?: boolean;
            message?: string;
            version?: string;
          } | null;
          if (response.ok && payload?.ok) {
            return {
              available: true,
              version: payload.version,
              detail: payload.message ?? "qBittorrent is reachable.",
            };
          }
          return {
            available: false,
            detail: payload?.message ?? `qBittorrent is not reachable from ${url}. Start its Web UI there.`,
          };
        } catch (error) {
          return {
            available: false,
            detail: error instanceof Error ? error.message : "Could not ask the host about qBittorrent.",
          };
        }
      },
      async add(magnet, meta) {
        try {
          let uri = magnet;
          if (!uri.startsWith("magnet:") && (meta?.url || meta?.infoHash)) {
            // AudioBookBay shows the info hash on the detail page, so the host
            // fetches that page and hands back a magnet.
            const resolved = await json<{ magnet?: string }>(url, token, "/api/resolve", {
              init: {
                method: "POST",
                body: JSON.stringify({ url: meta?.url, infoHash: meta?.infoHash, name: meta?.name }),
              },
            });
            uri = resolved?.magnet ?? "";
          }
          if (!uri) return { ok: false, detail: "No magnet link was found for that release." };
          await json(url, token, "/api/download", {
            init: { method: "POST", body: JSON.stringify({ magnet: uri, name: meta?.name }) },
          });
          return { ok: true };
        } catch (error) {
          return { ok: false, detail: error instanceof Error ? error.message : "Download failed" };
        }
      },
      async list() {
        // Real transfers from the host's qBittorrent, so the Downloads tab
        // shows the same thing the host does. An unreachable client is not an
        // error state here: the probe already explains it above the list.
        try {
          const payload = await json<{ torrents?: DownloadItem[] }>(url, token, "/api/torrents", {
            optional: true,
          });
          return payload?.torrents ?? [];
        } catch {
          return [];
        }
      },
      async pause() {
        /* host side */
      },
      async resume() {
        /* host side */
      },
      async remove() {
        /* host side */
      },
      async openFolder() {
        /* host side */
      },
      async importCompleted() {
        return { added: 0, updated: 0, skipped: 0, books: [], errors: ["Import runs on the host machine."] };
      },
    },
    transcription: {
      async probe() {
        return {
          available: false,
          detail: "Transcription runs on the host machine. Start it there and the transcript shows up here.",
        };
      },
      async start() {
        throw new Error("Transcription runs on the host machine.");
      },
      async status() {
        return null;
      },
      async cancel() {
        /* host side */
      },
      async get(bookId: string) {
        // No transcript yet is a normal state, not an error: the host answers
        // with doc: null rather than a 404, so nothing logs as a failure.
        const payload = await json<{ doc: TranscriptDoc | null }>(
          url,
          token,
          `/api/transcript?bookId=${encodeURIComponent(bookId)}`,
          { optional: true },
        );
        return payload?.doc ?? null;
      },
      async jobs() {
        return [];
      },
    },
    player: {
      async setMini() {
        /* browser windows are not managed by Amp */
      },
      async setAlwaysOnTop() {
        /* not applicable */
      },
      async setMiniSize() {
        /* not applicable */
      },
      async hideToTray() {
        /* not applicable */
      },
      async wake() {
        /* not applicable */
      },
      async quit() {
        /* not applicable */
      },
      async setGlobalShortcuts() {
        return { ok: false, failed: [] };
      },
      onCommand() {
        return () => undefined;
      },
      onWindowState() {
        return () => undefined;
      },
      async setMediaSession(metadata) {
        if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
        const session = navigator.mediaSession;
        session.metadata = new MediaMetadata({
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          artwork: metadata.artwork ? [{ src: metadata.artwork }] : [],
        });
      },
      async openExternal(target: string) {
        if (typeof window !== "undefined") window.open(target, "_blank", "noopener");
      },
      async window(action: string) {
        // A browser can still do one of these: real fullscreen. The compact
        // flyout is a desktop idea - a small always-on-top window parked next
        // to the tray - and there is nothing to shrink in a tab.
        if (action === "fullscreen" && typeof document !== "undefined") {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen().catch(() => undefined);
        }
      },
    },
    settings: {
      async load() {
        const remote = await json<Settings | null>(url, token, "/api/settings");
        return remote ? { ...defaultSettings, ...remote } : defaultSettings;
      },
      async save() {
        /* settings are owned by the host; the browser keeps local overrides */
      },
      async export() {
        return JSON.stringify(await bridge.settings.load(), null, 2);
      },
      async import(text: string) {
        return JSON.parse(text) as Settings;
      },
    },
    server: {
      async start() {
        return { running: true, url: `${window.location.origin}${window.location.pathname}` };
      },
      async stop() {
        return { running: true, url: window.location.origin };
      },
      async status() {
        return { running: true, url: `${window.location.origin}${window.location.pathname}` };
      },
    },
    updater: {
      async check() {
        return { available: false };
      },
      async open() {
        /* not applicable */
      },
    },
    async logs() {
      return [`Browser session against ${url}`, `Token: ${token ? "set" : "missing"}`];
    },
  };

  return bridge;
}

/**
 * Artwork URL for a book on the server, if one is connected.
 *
 * One endpoint serves both kinds: the host knows which file to send from
 * `which`, so the page never has to care that banners and covers live in
 * different places on disk.
 */
export function coverUrlFor(
  bookId: string,
  connection?: ServerConnection,
  which: "cover" | "banner" = "cover",
): string {
  const active = connection ?? readConnection();
  if (!active?.url) return "";
  return endpoint(active.url, `/api/cover?bookId=${encodeURIComponent(bookId)}&which=${which}`, active.token);
}

/**
 * Bridge used when the renderer runs in a browser with no server configured.
 * It is honest about it: the library is empty and every capability is off, so
 * the app renders its connect screen instead of invented books.
 */
export function createUnconnectedBridge(): AmpBridge {
  const unsupported = (message: string): never => {
    throw new Error(message);
  };
  return {
    platform: "web",
    version: "web",
    demo: false,
    capabilities: {
      nativeImport: false,
      importByPath: false,
      covers: false,
      torrents: false,
      transcription: false,
      server: false,
      tray: false,
      updater: false,
      writeChapters: false,
      revealFolder: false,
    },
    library: {
      async load() {
        return emptyLibrary();
      },
      async save() {
        /* nothing to save */
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
      async startup() {
        return { supported: false, openAtLogin: false, startHidden: false };
      },
      async saveCover() {
        return null;
      },
      async removeCover() {
        /* not connected */
      },
      async searchCovers() {
        return [];
      },
      fileUrl() {
        return "";
      },
      async revealInFolder() {
        /* not connected */
      },
      async writeChapters() {
        return { ok: false, detail: "Not connected to a server." };
      },
      async stats() {
        return { diskBytes: 0, dataDir: "" };
      },
    },
    torrents: {
      async search() {
        return [];
      },
      async test() {
        return { available: false, detail: "Not connected to a server." };
      },
      async add() {
        return { ok: false, detail: "Not connected to a server." };
      },
      async list() {
        return [] as DownloadItem[];
      },
      async pause() {
        /* not connected */
      },
      async resume() {
        /* not connected */
      },
      async remove() {
        /* not connected */
      },
      async openFolder() {
        /* not connected */
      },
      async importCompleted() {
        return { added: 0, updated: 0, skipped: 0, books: [], errors: [] };
      },
    },
    transcription: {
      async probe() {
        return { available: false, detail: "Not connected to a server." };
      },
      async start() {
        return unsupported("Not connected to a server. Open the app through Amp's server URL.");
      },
      async status() {
        return null;
      },
      async cancel() {
        /* not connected */
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
        /* not connected */
      },
      async setAlwaysOnTop() {
        /* not connected */
      },
      async setMiniSize() {
        /* not connected */
      },
      async hideToTray() {
        /* not connected */
      },
      async wake() {
        /* not connected */
      },
      async quit() {
        /* not connected */
      },
      async setGlobalShortcuts() {
        return { ok: false, failed: [] };
      },
      onCommand() {
        return () => undefined;
      },
      onWindowState() {
        return () => undefined;
      },
      async setMediaSession() {
        /* not connected */
      },
      async openExternal(target: string) {
        if (typeof window !== "undefined") window.open(target, "_blank", "noopener");
      },
      async window(action: string) {
        // A browser can still do one of these: real fullscreen. The compact
        // flyout is a desktop idea - a small always-on-top window parked next
        // to the tray - and there is nothing to shrink in a tab.
        if (action === "fullscreen" && typeof document !== "undefined") {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen().catch(() => undefined);
        }
      },
    },
    settings: {
      async load() {
        return defaultSettings;
      },
      async save() {
        /* not connected */
      },
      async export() {
        return JSON.stringify(defaultSettings, null, 2);
      },
      async import(text: string) {
        return JSON.parse(text) as Settings;
      },
    },
    server: {
      async start() {
        return { running: false, error: "Not connected to a server." };
      },
      async stop() {
        return { running: false };
      },
      async status() {
        return { running: false };
      },
    },
    updater: {
      async check() {
        return { available: false };
      },
      async open() {
        /* not connected */
      },
    },
    async logs() {
      return ["No host connected - open Amp through its server URL or run the desktop app."];
    },
  } satisfies AmpBridge;
}

/** Cover URL for a chapter-less fallback (kept for symmetry with the desktop). */
export function chapterCover(_chapter: Chapter): string {
  return "";
}

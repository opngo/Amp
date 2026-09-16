/**
 * qBittorrent integration.
 *
 * Amp talks to the qBittorrent Web UI API (v2) directly through Electron's
 * `net` stack: login, search through the Web UI search plugins when installed,
 * add magnets or .torrent files, poll progress and hand finished files to the
 * library importer. Request shapes and payload normalisation come from
 * @amp/core so the Electron app, the Python GUI and the TUI stay in step.
 *
 * When qBittorrent is not running the client throws a readable error and the
 * GUI shows a connect panel instead of pretending to work.
 */

import { net } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  isAudioFile,
  normalizeQbTorrent,
  pickAudiobookFiles,
  qbAddMagnetRequest,
  qbBaseUrl,
  qbListRequest,
  qbLoginRequest,
  type DownloadItem,
  type QBittorrentConfig,
  type TorrentResult,
} from "@amp/core";
import { logLine } from "./store";

export interface QBFile {
  name: string;
  size: number;
  progress: number;
  path: string;
}

export interface QBittorrentClient {
  testConnection(): Promise<{ ok: boolean; version?: string; message: string }>;
  search(query: string, category?: string): Promise<TorrentResult[]>;
  add(torrent: { magnet?: string; url?: string; file?: Buffer; name?: string }): Promise<{ ok: boolean; detail?: string }>;
  list(): Promise<DownloadItem[]>;
  pause(hash: string): Promise<void>;
  resume(hash: string): Promise<void>;
  remove(hash: string, deleteFiles: boolean): Promise<void>;
  files(hash: string): Promise<QBFile[]>;
  savePath(): Promise<string>;
}

export function createQBittorrentClient(config: QBittorrentConfig): QBittorrentClient {
  const base = qbBaseUrl(config);
  let cookie: string | null = null;

  const request = async (
    endpoint: string,
    init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {},
  ): Promise<Response> => {
    const headers: Record<string, string> = { ...(cookie ? { Cookie: cookie } : {}), ...(init.headers ?? {}) };
    const url = endpoint.startsWith("http") ? endpoint : `${base}${endpoint}`;
    const response = await net.fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
    } as RequestInit);
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    return response;
  };

  const ensureLogin = async (): Promise<void> => {
    if (cookie) return;
    const login = qbLoginRequest(config);
    const body = new URLSearchParams(
      Object.entries(login.body ?? {}).map(([key, value]) => [key, String(value)]),
    );
    const response = await request(login.path, {
      method: login.method,
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: base },
    });
    const text = await response.text();
    if (!response.ok || text.trim() !== "Ok.") {
      cookie = null;
      throw new Error(
        "qBittorrent rejected the credentials. Check the URL, username and password in Settings.",
      );
    }
    await logLine(`qbittorrent: logged in to ${base}`);
  };

  const postForm = async (endpoint: string, fields: Record<string, string>): Promise<Response> => {
    await ensureLogin();
    return request(endpoint, {
      method: "POST",
      body: new URLSearchParams(fields),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  };

  return {
    async testConnection() {
      try {
        const response = await request("/api/v2/app/version");
        if (!response.ok) return { ok: false, message: `qBittorrent answered with ${response.status}` };
        const version = (await response.text()).trim();
        await ensureLogin();
        return { ok: true, version, message: `Connected to qBittorrent ${version}` };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof Error
              ? `${error.message} - is the qBittorrent Web UI enabled on ${base}?`
              : "qBittorrent is unreachable",
        };
      }
    },

    async search(query, category = "all") {
      await ensureLogin();
      const start = await request(
        `/api/v2/search/start?pattern=${encodeURIComponent(query)}&plugins=all&category=${encodeURIComponent(category)}`,
      );
      if (!start.ok) {
        throw new Error(
          "The qBittorrent search plugin is unavailable. Install the search plugin in qBittorrent, or search AudioBookBay instead.",
        );
      }
      const { id } = (await start.json()) as { id: number };
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        const status = await request(`/api/v2/search/status?id=${id}`);
        if (!status.ok) break;
        const [entry] = (await status.json()) as Array<{ status: string; total: number }>;
        if (entry && entry.status === "Stopped" && entry.total > 0) break;
      }
      const results = await request(`/api/v2/search/results?id=${id}&limit=80`);
      const payload = results.ok
        ? ((await results.json()) as { results?: Array<Record<string, unknown>> })
        : { results: [] };
      void postForm(`/api/v2/search/stop?id=${id}`, {}).catch(() => undefined);
      return (payload.results ?? []).map((raw) => ({
        id: String(raw.fileUrl ?? raw.descrLink ?? raw.name ?? ""),
        source: "qbittorrent",
        title: String(raw.fileName ?? raw.name ?? "Unknown"),
        size: Number(raw.fileSize ?? 0) || undefined,
        sizeText: raw.fileSize ? `${(Number(raw.fileSize) / 1024 ** 2).toFixed(2)} MB` : undefined,
        seeders: Number(raw.nbSeeders ?? 0),
        leechers: Number(raw.nbLeechers ?? 0),
        magnet: typeof raw.fileUrl === "string" && raw.fileUrl.startsWith("magnet:") ? raw.fileUrl : undefined,
        url: typeof raw.descrLink === "string" ? raw.descrLink : undefined,
        category: raw.category as string | undefined,
        postedAt: raw.pubDate ? Date.parse(String(raw.pubDate)) || undefined : undefined,
      }));
    },

    async add(torrent) {
      await ensureLogin();
      const form = new FormData();
      if (config.savePath) form.set("savepath", config.savePath);
      form.set("category", config.category || "amp-audiobooks");
      form.set("paused", "false");
      form.set("autoTMM", "false");
      if (config.sequential) {
        form.set("sequentialDownload", "true");
        form.set("firstLastPiecePrio", "true");
      }
      if (torrent.magnet) {
        const add = qbAddMagnetRequest(config, torrent.magnet, torrent.name);
        form.set("urls", torrent.magnet);
        void add;
      }
      if (torrent.url) form.set("urls", torrent.url);
      if (torrent.file) {
        form.set("torrents", new Blob([new Uint8Array(torrent.file)]), `${torrent.name ?? "amp.torrent"}`);
      }
      const response = await request("/api/v2/torrents/add", { method: "POST", body: form });
      const text = await response.text();
      if (!response.ok || /Fails/i.test(text)) return { ok: false, detail: text.slice(0, 200) };
      await logLine(`qbittorrent: added ${torrent.name ?? torrent.magnet?.slice(0, 60) ?? torrent.url ?? "file"}`);
      return { ok: true, detail: "Queued in qBittorrent" };
    },

    async list() {
      await ensureLogin();
      const listRequest = qbListRequest();
      const response = await request(listRequest.path);
      if (!response.ok) throw new Error("Could not read the qBittorrent transfer list");
      const payload = (await response.json()) as Array<Record<string, unknown>>;
      return payload.map((raw) => {
        const normalized = normalizeQbTorrent(raw);
        return {
          ...normalized,
          eta: normalized.eta > 0 ? normalized.eta : undefined,
          addedAt: Number(raw.added_on ?? 0) * 1000,
          bookId: undefined,
          result: undefined,
        } satisfies DownloadItem;
      });
    },

    async pause(hash) {
      await postForm("/api/v2/torrents/pause", { hashes: hash });
    },

    async resume(hash) {
      await postForm("/api/v2/torrents/resume", { hashes: hash });
    },

    async remove(hash, deleteFiles) {
      await postForm("/api/v2/torrents/delete", { hashes: hash, deleteFiles: String(deleteFiles) });
      await logLine(`qbittorrent: removed ${hash}${deleteFiles ? " with files" : ""}`);
    },

    async files(hash) {
      await ensureLogin();
      const response = await request(`/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`);
      if (!response.ok) return [];
      const payload = (await response.json()) as Array<{ name: string; size: number; progress: number }>;
      const info = await request(`/api/v2/torrents/info?hashes=${encodeURIComponent(hash)}`);
      const [entry] = info.ok
        ? ((await info.json()) as Array<{ save_path?: string; content_path?: string }>)
        : [{ save_path: "" }];
      const root = entry?.content_path ?? entry?.save_path ?? "";
      const multi = payload.length > 1;
      return payload.map((file) => ({
        name: file.name,
        size: file.size,
        progress: file.progress,
        path: multi ? path.join(root, file.name) : root,
      }));
    },

    async savePath() {
      await ensureLogin();
      const response = await request("/api/v2/app/defaultSavePath");
      return response.ok ? (await response.text()).trim() : "";
    },
  };
}

/** Audio files inside a finished torrent, verified to exist on disk. */
export async function finishedAudioFiles(
  client: QBittorrentClient,
  hash: string,
): Promise<Array<{ name: string; path: string; size: number }>> {
  const files = await client.files(hash);
  const wanted = new Set(pickAudiobookFiles(files.map((file) => file.name)));
  const audio = files.filter((file) => wanted.has(file.name) || isAudioFile(file.name));
  const missing: string[] = [];
  for (const file of audio) {
    try {
      await fs.access(file.path);
    } catch {
      missing.push(file.path);
    }
  }
  if (missing.length) {
    throw new Error(`Finished download is not readable at ${missing[0]}`);
  }
  return audio.map((file) => ({ name: file.name, path: file.path, size: file.size }));
}

/** Save a .torrent file the user dragged onto the app. */
export async function readTorrentFile(filePath: string): Promise<Buffer> {
  return fs.readFile(filePath);
}

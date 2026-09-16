/**
 * Browser bridge: keeps every screen of Amp fully interactive without
 * Electron. Used by the Vite dev server, the static web build and by
 * server.py for Tailscale access.
 *
 * The library is a realistic demo dataset (persisted to localStorage) and
 * audio comes from `demoAudio.ts`, so playback, seeking, chapters, the
 * equalizer and the visualizer all behave exactly like the desktop app.
 */

import {
  defaultSettings,
  migrateSettings,
  emptyLibrary,
  newId,
  parseSizeToBytes,
  parseTitle,
  resultId,
  buildMagnet,
  type Book,
  type Chapter,
  type DownloadItem,
  type Folder,
  type LibraryState,
  type Playlist,
  type Settings,
  type TorrentResult,
  type TranscriberJob,
  type TranscriptDoc,
} from "@amp/core";
import type { AmpBridge, CoverCandidate, ImportResult, ProbeResult, ServerStatus } from "@amp/core";
import { demoAudioUrl } from "./demoAudio";

const LIB_KEY = "amp.demo.library.v1";
const SETTINGS_KEY = "amp.settings.v1";
const DEMO_AUDIO_SECONDS = 900;

const TITLES: [string, string, string, string][] = [
  ["Dune", "Frank Herbert", "Scott Brick", "Dune #1"],
  ["Neuromancer", "William Gibson", "Robertson Dean", "Sprawl #1"],
  ["The Left Hand of Darkness", "Ursula K. Le Guin", "George Guidall", "Hainish #4"],
  ["Blindsight", "Peter Watts", "T. Ryder Smith", ""],
  ["Piranesi", "Susanna Clarke", "Chiwetel Ejiofor", ""],
  ["Project Hail Mary", "Andy Weir", "Ray Porter", ""],
  ["The Dispossessed", "Ursula K. Le Guin", "Don Leslie", "Hainish #6"],
  ["A Memory Called Empire", "Arkady Martine", "Amy Landon", "Teixcalaan #1"],
  ["Children of Time", "Adrian Tchaikovsky", "Mel Hudson", ""],
  ["The Wind-Up Bird Chronicle", "Haruki Murakami", "Rupert Degas", ""],
  ["Snow Crash", "Neal Stephenson", "Jonathan Davis", ""],
  ["Annihilation", "Jeff VanderMeer", "Carolyn McCormick", "Southern Reach #1"],
];

function svgCover(title: string, author: string, seed: number): string {
  const hue = (seed * 47) % 360;
  const hue2 = (hue + 40) % 360;
  const initials = title
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const lines = title.match(/.{1,16}(\s|$)/g)?.slice(0, 3) ?? [title];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 62% 26%)"/>
      <stop offset="55%" stop-color="hsl(${hue2} 70% 16%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 200) % 360} 55% 10%)"/>
    </linearGradient>
    <filter id="n"><feTurbulence baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
  </defs>
  <rect width="600" height="600" fill="url(#g)"/>
  <rect width="600" height="600" filter="url(#n)" opacity="0.06"/>
  <g fill="none" stroke="hsl(${hue} 80% 72%)" stroke-opacity="0.35" stroke-width="2">
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="300" cy="300" r="${40 + i * 20}"/>`).join("")}
  </g>
  <text x="48" y="110" font-family="Inter,Helvetica,sans-serif" font-size="150" font-weight="700" fill="hsl(${hue} 90% 86%)" opacity="0.9">${initials}</text>
  <g font-family="Inter,Helvetica,sans-serif" fill="#f6f7fb">
    ${lines
      .map((line, i) => `<text x="48" y="${400 + i * 46}" font-size="36" font-weight="600">${escapeXml(line.trim())}</text>`)
      .join("")}
    <text x="48" y="560" font-size="26" fill="hsl(${hue} 70% 78%)" opacity="0.9">${escapeXml(author)}</text>
  </g>
</svg>`;
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c] ?? c));
}

function makeChapters(bookId: string, duration: number, count: number): Chapter[] {
  const chapters: Chapter[] = [];
  let start = 0;
  for (let i = 0; i < count; i += 1) {
    const slice = i === count - 1 ? duration - start : Math.round(duration / count);
    chapters.push({
      id: `${bookId}:c${i}`,
      index: i + 1,
      title: i === 0 ? "Prologue" : i === count - 1 ? "Epilogue" : `Chapter ${i}`,
      start,
      duration: slice,
    });
    start += slice;
  }
  return chapters;
}

function demoLibrary(): LibraryState {
  const now = Date.now();
  const folders: Folder[] = [
    { id: "fd_scifi", name: "Sci-Fi", color: "#6c8cff", createdAt: now, watch: false },
    { id: "fd_toread", name: "To read next", color: "#f0932b", createdAt: now, watch: false },
    { id: "fd_classics", name: "Classics", color: "#4ecdc4", createdAt: now, watch: false },
  ];
  const books: Book[] = TITLES.map(([title, author, narrator, series], i) => {
    const id = `bk_demo${i}`;
    const duration = 18000 + i * 900;
    const [seriesName, seriesIndex] = series ? series.split(" #") : ["", ""];
    return {
      id,
      title,
      author,
      narrator,
      series: seriesName || undefined,
      seriesIndex: seriesIndex ? Number(seriesIndex) : undefined,
      album: title,
      year: 1965 + ((i * 7) % 55),
      genres: ["Science fiction"],
      description: `${title} by ${author}. A demo entry so the browser preview has something to play with - the desktop app imports your real files.`,
      sourcePath: `/demo/${title.replace(/\s+/g, "-").toLowerCase()}.m4b`,
      kind: "single",
      chapters: makeChapters(id, duration, 9 + (i % 7)),
      duration,
      coverDataUrl: svgCover(title, author, i + 3),
      folderId: i % 3 === 0 ? "fd_scifi" : i % 3 === 1 ? "fd_toread" : "fd_classics",
      tags: i % 4 === 0 ? ["favourite series"] : [],
      favorite: i % 5 === 0,
      progress: i % 4 === 0 ? Math.round(duration * 0.42) : i % 7 === 0 ? duration : i * 120,
      lastPlayedAt: now - i * 86_400_000,
      addedAt: now - i * 3_600_000 * 30,
      updatedAt: now - i * 3_600_000,
      sizeBytes: 220 * 1024 ** 2 + i * 1024 ** 2 * 8,
      codec: "AAC",
      bitrate: 64000,
    } satisfies Book;
  });
  const playlists: Playlist[] = [
    { id: "pl_night", name: "Night shift", description: "Slow burners for late shifts", bookIds: books.slice(0, 4).map((b) => b.id), createdAt: now, updatedAt: now },
    { id: "pl_commute", name: "Commute", description: "Short chapters only", bookIds: books.slice(6, 9).map((b) => b.id), createdAt: now, updatedAt: now },
  ];
  return {
    ...emptyLibrary(),
    books,
    folders,
    playlists,
    queue: books.slice(0, 3).map((b) => ({ bookId: b.id, addedAt: now })),
    bookmarks: [
      { id: "bm_1", bookId: books[0].id, position: 620, chapterIndex: 0, label: "The Gom Jabbar", createdAt: now - 7200_000 },
      { id: "bm_2", bookId: books[1].id, position: 1900, chapterIndex: 1, label: "Wintermute", createdAt: now - 86_400_000 },
    ],
    history: books
      .slice(0, 6)
      .map((b, i) => ({ bookId: b.id, at: now - i * 43_200_000, position: b.progress })),
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked - the UI keeps working in memory */
  }
}

export async function createWebBridge(): Promise<AmpBridge> {
  let library = readJson<LibraryState | null>(LIB_KEY, null) ?? demoLibrary();
  let settings = migrateSettings(readJson<Settings | null>(SETTINGS_KEY, null) ?? defaultSettings);
  let serverStatus: ServerStatus = { running: false };
  const jobs = new Map<string, TranscriberJob>();
  const transcripts = new Map<string, TranscriptDoc>();
  let downloads: DownloadItem[] = [];
  const commandHandlers = new Set<(command: string, payload?: unknown) => void>();
  const windowHandlers = new Set<(state: { mini: boolean; focused: boolean; alwaysOnTop: boolean }) => void>();

  const persist = () => writeJson(LIB_KEY, library);

  const bridge: AmpBridge = {
    platform: "web",
    version: "0.9.0-web",
    demo: true,
    capabilities: {
      nativeImport: false,
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
        return library;
      },
      async save(state) {
        library = state;
        persist();
      },
      async importPaths(paths, options): Promise<ImportResult> {
        const added: Book[] = [];
        for (const path of paths) {
          const name = path.split(/[\\/]/).pop() ?? "Imported book";
          const title = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ");
          const id = newId("bk");
          const duration = 3600 * 8;
          const book: Book = {
            id,
            title,
            author: "Unknown author",
            sourcePath: path,
            kind: "single",
            chapters: makeChapters(id, duration, 12),
            duration,
            genres: [],
            tags: [],
            favorite: false,
            progress: 0,
            addedAt: Date.now(),
            updatedAt: Date.now(),
            coverDataUrl: svgCover(title, "Unknown author", title.length),
            folderId: options?.folderId ?? null,
          };
          library = { ...library, books: [...library.books, book] };
          added.push(book);
        }
        persist();
        return { added: added.length, updated: 0, skipped: 0, books: added, errors: [] };
      },
      async pickFiles() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".m4b,.m4a,.mp3,.mp4,.flac,.ogg,.opus,audio/*";
        input.multiple = true;
        return new Promise((resolve) => {
          input.onchange = () => {
            const files = Array.from(input.files ?? []).map((f) => f.name);
            resolve(files);
          };
          input.oncancel = () => resolve([]);
          input.click();
        });
      },
      async pickFolder() {
        return "/demo/imported-folder";
      },
      async rescan() {
        return { added: 0, updated: 0, skipped: 0, books: [], errors: [] };
      },
      async extractCover(book) {
        const found = library.books.find((b) => b.id === book.id);
        return found?.coverDataUrl ?? null;
      },
      async saveCover(bookId, image) {
        const value = image.dataUrl ?? image.url ?? null;
        library = {
          ...library,
          books: library.books.map((b) => (b.id === bookId ? { ...b, coverDataUrl: value ?? b.coverDataUrl } : b)),
        };
        persist();
        return value;
      },
      async removeCover(bookId) {
        library = {
          ...library,
          books: library.books.map((b) => (b.id === bookId ? { ...b, coverDataUrl: undefined, coverPath: undefined } : b)),
        };
        persist();
      },
      async searchCovers(query, provider): Promise<CoverCandidate[]> {
        const seeds = [query, `${query} 2`, `${query} audiobook`];
        return seeds.map((seed, i) => ({
          id: `${provider}-${i}-${seed}`,
          title: query,
          author: i === 0 ? undefined : "Alternative art",
          thumbnail: svgCover(seed, `via ${provider}`, seed.length + i),
          full: svgCover(seed, `via ${provider}`, seed.length + i),
          source: provider,
        }));
      },
      fileUrl() {
        return demoAudioUrl("amp-demo", DEMO_AUDIO_SECONDS);
      },
      async revealInFolder() {
        /* browsers cannot open a file manager */
      },
      async writeChapters() {
        return { ok: false, detail: "Chapter writing needs the desktop app (ffmpeg)." };
      },
      async stats() {
        return {
          diskBytes: library.books.reduce((acc, b) => acc + (b.sizeBytes ?? 0), 0),
          dataDir: "browser localStorage",
        };
      },
    },
    torrents: {
      async search(query): Promise<TorrentResult[]> {
        const base = parseTitle(query);
        const variants: [string, string, number, number][] = [
          [`${base.author ?? "Unknown"} - ${base.title} (Unabridged) [M4B 64kbps]`, "1.1 GB", 148, 3],
          [`${base.title} [MP3 96kbps]`, "780 MB", 63, 12],
          [`${base.title} - narrated collection [M4B 128kbps]`, "2.4 GB", 31, 26],
        ];
        downloads = [];
        return variants.map(([title, size, seeders, dayOffset], i) => {
          const parsed = parseTitle(title);
          const infoHash = `demo${i}${"0".repeat(37)}`.slice(0, 40);
          return {
            id: resultId({ source: "demo", title, infoHash }),
            source: "demo",
            title,
            sizeText: size,
            size: parseSizeToBytes(size),
            seeders,
            leechers: Math.max(1, Math.round(seeders / 8)),
            infoHash,
            magnet: buildMagnet(infoHash, title),
            url: `https://audiobookbay.lu/?s=${encodeURIComponent(query)}`,
            postedAt: Date.now() - dayOffset * 86_400_000,
            parsed: {
              author: parsed.author,
              narrator: parsed.narrator,
              year: parsed.year,
              bitrate: parsed.bitrate,
              format: parsed.format,
            },
          };
        });
      },
      async test(): Promise<ProbeResult> {
        return { available: false, detail: "The browser demo cannot reach a local qBittorrent instance." };
      },
      async add(magnet, meta) {
        const infoHash = (magnet.match(/btih:([a-zA-Z0-9]+)/)?.[1] ?? "demo").toLowerCase();
        downloads = [
          {
            hash: infoHash,
            name: meta?.name ?? "Demo download",
            state: "downloading",
            progress: 0,
            downloadSpeed: 0,
            uploadSpeed: 0,
            size: 1024 ** 3,
            downloaded: 0,
            savePath: "/demo/downloads",
            addedAt: Date.now(),
          },
          ...downloads,
        ];
        const started = Date.now();
        const timer = setInterval(() => {
          const item = downloads.find((d) => d.hash === infoHash);
          if (!item) {
            clearInterval(timer);
            return;
          }
          const elapsed = (Date.now() - started) / 1000;
          item.progress = Math.min(1, elapsed / 12);
          item.downloaded = item.size * item.progress;
          item.downloadSpeed = item.progress < 1 ? item.size / 12 : 0;
          item.state = item.progress >= 1 ? "uploading" : "downloading";
        }, 400);
        return { ok: true, detail: "Demo download simulated in the browser." };
      },
      async list() {
        return downloads;
      },
      async pause(hash) {
        const item = downloads.find((d) => d.hash === hash);
        if (item) item.state = "pausedDL";
      },
      async resume(hash) {
        const item = downloads.find((d) => d.hash === hash);
        if (item) item.state = "downloading";
      },
      async remove(hash) {
        downloads = downloads.filter((d) => d.hash !== hash);
      },
      async openFolder() {
        /* no-op in browser */
      },
      async importCompleted() {
        const done = downloads.filter((d) => d.progress >= 1 && !d.bookId);
        const result = await bridge.library.importPaths(
          done.map((d) => `${d.savePath}/${d.name}`),
        );
        done.forEach((d) => {
          d.bookId = result.books[0]?.id;
        });
        return result;
      },
    },
    transcription: {
      async probe(): Promise<ProbeResult> {
        return { available: true, version: "demo", detail: "Simulated transcript generated in the browser." };
      },
      async start(bookId) {
        const id = newId("job");
        const job: TranscriberJob = {
          id,
          bookId,
          chapterIndexes: [],
          status: "running",
          progress: 0,
          log: ["[demo] whisper.cpp simulated"],
          startedAt: Date.now(),
        };
        jobs.set(id, job);
        const book = library.books.find((b) => b.id === bookId);
        const total = book?.chapters.length ?? 6;
        let step = 0;
        const timer = setInterval(() => {
          step += 1;
          job.progress = step;
          job.log.push(`[demo] Chapter ${step}/${total} transcribed`);
          if (step >= total) {
            clearInterval(timer);
            job.status = "done";
            job.finishedAt = Date.now();
            const cues: TranscriptDoc["cues"] = [];
            let cursor = 0;
            for (const chapter of book?.chapters ?? []) {
              const words = `${chapter.title}. This is a simulated transcript produced by the browser demo so the transcript search, chapter detection and export screens can be tried out. `.split(" ");
              let time = chapter.start;
              for (let i = 0; i < words.length; i += 8) {
                const text = words.slice(i, i + 8).join(" ");
                cues.push({ start: time, end: time + 3.4, text });
                time += 3.4;
                cursor = time;
              }
            }
            transcripts.set(bookId, {
              bookId,
              language: "en",
              model: "demo",
              createdAt: Date.now(),
              cues,
              text: cues.map((c) => c.text).join(" "),
            });
            void cursor;
          }
        }, 260);
        return job;
      },
      async status(jobId) {
        return jobs.get(jobId) ?? null;
      },
      async cancel(jobId) {
        const job = jobs.get(jobId);
        if (job) job.status = "cancelled";
      },
      async get(bookId) {
        return transcripts.get(bookId) ?? null;
      },
      async jobs() {
        return [...jobs.values()];
      },
    },
    player: {
      async setMini(mini) {
        windowHandlers.forEach((fn) => fn({ mini, focused: document.hasFocus(), alwaysOnTop: false }));
      },
      async setAlwaysOnTop() {},
      async setMiniSize() {},
      async hideToTray() {},
      async wake() {},
      async quit() {},
      async setGlobalShortcuts() {
        return { ok: false, failed: ["Browser builds cannot register system wide hotkeys"] };
      },
      onCommand(handler) {
        commandHandlers.add(handler);
        return () => commandHandlers.delete(handler);
      },
      onWindowState(handler) {
        windowHandlers.add(handler);
        return () => windowHandlers.delete(handler);
      },
      async setMediaSession(metadata) {
        // MediaMetadata does not exist in every runtime (or in tests).
        if ("mediaSession" in navigator && typeof MediaMetadata !== "undefined") {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: metadata.title,
            artist: metadata.artist,
            album: metadata.album,
            artwork: metadata.artwork ? [{ src: metadata.artwork, sizes: "512x512" }] : [],
          });
        }
      },
      async openExternal(url) {
        window.open(url, "_blank", "noopener");
      },
      async window(action) {
        if (action === "fullscreen") {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await document.documentElement.requestFullscreen();
        }
      },
    },
    settings: {
      async load() {
        return settings;
      },
      async save(next) {
        settings = next;
        writeJson(SETTINGS_KEY, settings);
      },
      async export() {
        return JSON.stringify(settings, null, 2);
      },
      async import(json) {
        settings = migrateSettings(JSON.parse(json));
        writeJson(SETTINGS_KEY, settings);
        return settings;
      },
    },
    server: {
      async start(): Promise<ServerStatus> {
        serverStatus = { running: true, url: `${location.origin}/amp`, clients: 1 };
        return serverStatus;
      },
      async stop() {
        serverStatus = { running: false };
        return serverStatus;
      },
      async status() {
        return serverStatus;
      },
    },
    updater: {
      async check() {
        return { available: false };
      },
      async open() {},
    },
    async logs() {
      return ["Amp web/demo bridge active", `Library entries: ${library.books.length}`];
    },
  };

  // Keep the demo library consistent if localStorage holds an older shape.
  if (!library.books?.length) {
    library = demoLibrary();
    persist();
  }
  return bridge;
}

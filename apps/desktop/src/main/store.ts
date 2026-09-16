/**
 * Tiny JSON persistence layer for the main process.
 *
 * Everything Amp knows lives in the app data directory as plain JSON:
 *   settings.json    - user settings (importable/exportable, git friendly)
 *   library.json     - books, folders, playlists, bookmarks, queue
 *   covers/          - cover art extracted from files or downloaded
 *   banners/         - wide banner art chosen for a book
 *   transcripts/     - Whisper output (srt/vtt/json)
 *   downloads.json   - torrent history that Amp has seen
 */

import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultSettings, emptyLibrary, migrateSettings, type LibraryState, type Settings } from "@amp/core";

export class JsonStore {
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly fileName: string) {}

  get dir(): string {
    return app.getPath("userData");
  }

  get file(): string {
    return path.join(this.dir, this.fileName);
  }

  async read<T>(fallback: T): Promise<T> {
    try {
      const raw = await fs.readFile(this.file, "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  /** Atomic write: temp file + rename so a crash never truncates the library. */
  async write(value: unknown): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const temp = `${this.file}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
      await fs.rename(temp, this.file);
    });
    return this.writeQueue;
  }

  async backup(): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = path.join(this.dir, `${this.fileName}.${stamp}.bak`);
    try {
      await fs.copyFile(this.file, target);
    } catch {
      /* nothing to back up yet */
    }
    return target;
  }
}

export const settingsStore = new JsonStore("settings.json");
export const libraryStore = new JsonStore("library.json");
export const downloadsStore = new JsonStore("downloads.json");

export const paths = {
  covers: () => path.join(app.getPath("userData"), "covers"),
  banners: () => path.join(app.getPath("userData"), "banners"),
  transcripts: () => path.join(app.getPath("userData"), "transcripts"),
  logs: () => path.join(app.getPath("userData"), "logs"),
  cache: () => path.join(app.getPath("userData"), "cache"),
};

export async function ensureDirs(): Promise<void> {
  for (const dir of [paths.covers(), paths.banners(), paths.transcripts(), paths.logs(), paths.cache()]) {
    await fs.mkdir(dir, { recursive: true });
  }
}

export async function loadSettings(): Promise<Settings> {
  const raw = await settingsStore.read<Settings | null>(null);
  return migrateSettings(raw ?? defaultSettings);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsStore.write(settings);
}

export async function loadLibrary(): Promise<LibraryState> {
  const state = await libraryStore.read<LibraryState>(emptyLibrary());
  return { ...emptyLibrary(), ...state };
}

export async function saveLibrary(state: LibraryState): Promise<void> {
  await libraryStore.write(state);
}

/** Append-only log used by the About dialog and bug reports. */
export async function logLine(message: string): Promise<void> {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    await fs.mkdir(paths.logs(), { recursive: true });
    const file = path.join(paths.logs(), `amp-${new Date().toISOString().slice(0, 10)}.log`);
    await fs.appendFile(file, line, "utf8");
  } catch {
    /* logging must never break the app */
  }
}

export async function readLogTail(lines = 80): Promise<string[]> {
  try {
    const file = path.join(paths.logs(), `amp-${new Date().toISOString().slice(0, 10)}.log`);
    const content = await fs.readFile(file, "utf8");
    return content.trim().split("\n").slice(-lines);
  } catch {
    return [];
  }
}

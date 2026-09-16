/**
 * Main-process app state.
 *
 * The renderer is the source of truth for the library while it is running, but
 * the tray, the remote server and the updater need the same data, so both
 * copies are kept in step here (the renderer pushes every change through
 * `library:save` / `settings:save`).
 */

import { EventEmitter } from "node:events";
import type { Book, LibraryState, PlaybackState, Settings } from "@amp/core";
import { defaultSettings, emptyLibrary, initialPlaybackState, migrateSettings } from "@amp/core";
import { loadLibrary, loadSettings, saveLibrary, saveSettings } from "./store";

class AppState extends EventEmitter {
  settings: Settings = defaultSettings;
  library: LibraryState = emptyLibrary();
  playback: PlaybackState = initialPlaybackState;
  currentBookId: string | null = null;
  ready = false;

  async load(): Promise<void> {
    this.settings = await loadSettings();
    this.library = await loadLibrary();
    this.ready = true;
    this.emit("loaded");
  }

  async setSettings(settings: Settings): Promise<void> {
    this.settings = migrateSettings(settings);
    await saveSettings(this.settings);
    this.emit("settings", this.settings);
  }

  async setLibrary(library: LibraryState): Promise<void> {
    this.library = library;
    await saveLibrary(library);
    this.emit("library", library);
  }

  /** The renderer reports playback so the tray can show the current title. */
  setPlayback(book: Book | null, state: PlaybackState): void {
    this.currentBookId = book?.id ?? null;
    this.playback = state;
    this.emit("playback");
  }

  nowPlaying(): { book?: Book; state: PlaybackState } {
    const book = this.library.books.find((item) => item.id === this.currentBookId);
    return { book, state: this.playback };
  }

  book(bookId: string): Book | undefined {
    return this.library.books.find((item) => item.id === bookId);
  }
}

export const appState = new AppState();

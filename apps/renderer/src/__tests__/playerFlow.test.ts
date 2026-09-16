/**
 * Playback orchestration across chapters.
 *
 * The audio engine is replaced with a recorder so the test can drive the events
 * a real element would produce (playing, ended) and check what the store asks
 * the engine to load: that is how a folder of tracks advances from file to file,
 * and how a single m4b moves inside one file.
 */

import { describe, expect, it, vi } from "vitest";
import type { Book } from "@amp/core";
import { defaultSettings } from "@amp/core";
import { useSettingsStore } from "../store/useSettingsStore";

const engineHandlers: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
const loads: Array<{ url: string; position?: number; autoplay?: boolean }> = [];
/** What the engine thinks the element is doing, for the repair paths. */
let elementPaused = false;
const repairs: string[] = [];

const fakeEngine = {
  load: vi.fn(async (url: string, options: { position?: number; autoplay?: boolean } = {}) => {
    loads.push({ url, ...options });
  }),
  play: vi.fn(async () => undefined),
  pause: vi.fn(),
  seek: vi.fn(),
  setRate: vi.fn(),
  setVolume: vi.fn(),
  setMuted: vi.fn(),
  setEq: vi.fn(),
  setBalance: vi.fn(),
  setChannelMode: vi.fn(),
  setOutputDevice: vi.fn(async () => true),
  fadeTo: vi.fn(async () => undefined),
  getAnalyser: vi.fn(() => null),
  getChannelMode: vi.fn(() => "stereo"),
  on: vi.fn((handler: (event: { type: string }) => void) => {
    engineHandlers.push(handler as never);
    return () => undefined;
  }),
  bindMediaSession: vi.fn(),
  ensureElement: vi.fn(),
  isPaused: vi.fn(() => elementPaused),
  /*
   * The repair the store reaches for when the element went quiet on its own.
   * Recorded rather than simulated: the engine's half of this is covered in
   * audioEngine.test.ts, and what matters here is when the store decides to ask.
   */
  recover: vi.fn(async (reason: string) => {
    repairs.push(reason);
    elementPaused = false;
    return true;
  }),
};

vi.mock("../audio/audioEngine", () => ({ engine: fakeEngine, AudioEngine: class {} }));

import { stubHost } from "./stubHost";
import { emptyLibrary } from "@amp/core";

const book: Book = {
  id: "bk_multi",
  title: "A Folder Of Tracks",
  author: "Somebody",
  sourcePath: "/books/tracks",
  kind: "multi",
  duration: 36,
  chapters: [
    { id: "ch_1", index: 1, title: "Chapter 01", start: 0, duration: 12, file: "/books/tracks/01.mp3" },
    { id: "ch_2", index: 2, title: "Chapter 02", start: 12, duration: 12, file: "/books/tracks/02.mp3" },
    { id: "ch_3", index: 3, title: "Chapter 03", start: 24, duration: 12, file: "/books/tracks/03.mp3" },
  ],
  genres: [],
  tags: [],
  favorite: false,
  progress: 0,
  addedAt: 1,
  updatedAt: 1,
};

const shown = (path: string) => `amp-media://local/${encodeURIComponent(path)}`;

const emit = (event: { type: string; [key: string]: unknown }) => {
  for (const handler of engineHandlers) handler(event);
};

async function setup() {
  // The store binds its engine listener once per module instance, so handlers
  // registered by earlier tests stay live; only the load log is reset.
  loads.length = 0;
  repairs.length = 0;
  elementPaused = false;
  vi.clearAllMocks();

  const host = stubHost();
  const library = emptyLibrary();
  library.books = [book];
  host.library.load = async () => library;

  const { usePlayerStore } = await import("../store/usePlayerStore");
  const { useLibraryStore } = await import("../store/useLibraryStore");
  await useLibraryStore.getState().load();
  usePlayerStore.getState().bind();
  return { usePlayerStore, host };
}

describe("chapter playback", () => {
  it("walks a multi-file book file by file, then stops at the end", async () => {
    const { usePlayerStore } = await setup();
    await usePlayerStore.getState().loadBook(book as never, { position: 0, autoplay: true });
    expect(loads.at(-1)?.url).toBe(shown("/books/tracks/01.mp3"));

    emit({ type: "ended" });
    await vi.waitFor(() => expect(loads.at(-1)?.url).toBe(shown("/books/tracks/02.mp3")));
    expect(usePlayerStore.getState().state.chapterIndex).toBe(1);

    emit({ type: "ended" });
    await vi.waitFor(() => expect(loads.at(-1)?.url).toBe(shown("/books/tracks/03.mp3")));
    expect(usePlayerStore.getState().state.chapterIndex).toBe(2);

    // The last chapter ends: playback stops instead of looping round.
    emit({ type: "ended" });
    await vi.waitFor(() => expect(usePlayerStore.getState().state.playing).toBe(false));
    expect(loads.at(-1)?.url).toBe(shown("/books/tracks/03.mp3"));
  });

  it("jumping in the chapter list moves the playhead into that chapter", async () => {
    const { usePlayerStore } = await setup();
    await usePlayerStore.getState().loadBook(book as never, { position: 0, autoplay: false });
    await usePlayerStore.getState().seekChapter(2);
    const state = usePlayerStore.getState().state;
    expect(state.chapterIndex).toBe(2);
    expect(state.position).toBe(24);
  });

  it("follows the engine's playhead", async () => {
    const { usePlayerStore } = await setup();
    await usePlayerStore.getState().loadBook(book as never, { position: 0, autoplay: true });
    emit({ type: "time", time: 5.5, duration: 12 });
    await vi.waitFor(() => expect(usePlayerStore.getState().state.position).toBeCloseTo(5.5, 5));
  });

  it("turns the engine's graph verdict into the state Settings reads", async () => {
    const { usePlayerStore } = await setup();
    await usePlayerStore.getState().loadBook(book as never, { position: 0, autoplay: true });

    // The engine gave up on the effects graph: the equalizer and the visualizer
    // are off and Settings has to say so.
    emit({ type: "graph", refused: true });
    await vi.waitFor(() => expect(usePlayerStore.getState().graphRefused).toBe(true));

    emit({ type: "graph", refused: false });
    await vi.waitFor(() => expect(usePlayerStore.getState().graphRefused).toBe(false));
  });

  it("asks the engine for the effects graph when the listener retries", async () => {
    const { usePlayerStore } = await setup();
    const retry = vi.fn(async () => true);
    (fakeEngine as { retryGraph?: unknown }).retryGraph = retry;
    await expect(usePlayerStore.getState().retryEffects()).resolves.toBe(true);
    expect(retry).toHaveBeenCalled();
    expect(usePlayerStore.getState().graphRefused).toBe(false);
  });

  it("restores the saved position of a single-file book", async () => {
    const { usePlayerStore } = await setup();
    const single: Book = { ...book, id: "bk_single", kind: "single", sourcePath: "/books/one.m4b", progress: 21 };
    await usePlayerStore.getState().loadBook(single as never, { autoplay: false });
    expect(loads.at(-1)?.url).toBe(shown("/books/one.m4b"));
    // Resuming steps back a few seconds by default (playback.resumeRewind), so
    // the sentence that was cut off is heard again.
    expect(usePlayerStore.getState().state.position).toBe(16);
  });

  it("does not repair the pause that a chapter change needs", async () => {
    const { usePlayerStore } = await setup();
    await usePlayerStore.getState().loadBook(book as never, { position: 0, autoplay: true });

    // The file runs out: the browser pauses the element and the store loads the
    // next chapter. That pause is the transition, not a failure.
    emit({ type: "ended" });
    elementPaused = true;
    emit({ type: "paused" });
    await vi.waitFor(() => expect(loads.at(-1)?.url).toBe(shown("/books/tracks/02.mp3")));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(repairs).toEqual([]);
    expect(usePlayerStore.getState().state.chapterIndex).toBe(1);
  });

  it("repairs a stop nobody asked for, without moving the chapter", async () => {
    const { usePlayerStore } = await setup();
    await usePlayerStore.getState().loadBook(book as never, { position: 5, autoplay: true });
    const chapter = usePlayerStore.getState().state.chapterIndex;

    // The element goes quiet behind the store's back: a device change, a driver
    // that dropped the stream. The listener still expects sound.
    elementPaused = true;
    emit({ type: "paused" });
    await vi.waitFor(() => expect(repairs.length).toBeGreaterThan(0), { timeout: 1500 });
    expect(repairs[0]).toBe("unexpected pause");
    expect(usePlayerStore.getState().state.chapterIndex).toBe(chapter);
    expect(usePlayerStore.getState().state.playing).toBe(true);
  });

  it("leaves a book that ran out alone", async () => {
    const { usePlayerStore } = await setup();
    await usePlayerStore.getState().loadBook(book as never, { position: 24, autoplay: true });
    emit({ type: "ended" });
    await vi.waitFor(() => expect(usePlayerStore.getState().state.playing).toBe(false));
    elementPaused = true;
    emit({ type: "paused" });
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(repairs).toEqual([]);
    expect(usePlayerStore.getState().state.chapterIndex).toBe(2);
  });

  it("reopens exactly where it stopped when rewind-on-resume is off", async () => {
    const { usePlayerStore } = await setup();
    // The setting lives in the settings store; the default rewind is 5 seconds.
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, playback: { ...defaultSettings.playback, ...state.settings.playback, resumeRewind: 0 } },
    }));
    const single: Book = { ...book, id: "bk_exact", kind: "single", sourcePath: "/books/one.m4b", progress: 21 };
    await usePlayerStore.getState().loadBook(single as never, { autoplay: false });
    expect(usePlayerStore.getState().state.position).toBe(21);
  });
});

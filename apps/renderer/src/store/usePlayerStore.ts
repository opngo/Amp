/**
 * Player store: ties the pure playback reducer (see @amp/core) to the audio
 * engine, the library store and the host (tray, media keys, global hotkeys).
 *
 * Position maths for the two book shapes:
 *   single (m4b/mp3/mp4)  -> one file, chapters are time ranges inside it
 *   multi  (folder)       -> one file per chapter, absolute position is
 *                            chapter.start + time inside the chapter file
 */

import { create } from "zustand";
import {
  chapterAt,
  chapterLocalTime,
  chapterStop,
  clampPosition,
  clampSpeed,
  initialPlaybackState,
  nextInQueue,
  playbackReducer,
  prevInQueue,
  type Book,
  type Chapter,
  type ID,
  type PlaybackAction,
  withChapterStop,
  type PlaybackState,
} from "@amp/core";
import { engine, explainPlaybackError, type EngineEvent } from "../audio/audioEngine";
import { applyEqualizer } from "../audio/equalizerGraph";
import { bridgeIfReady, getBridge } from "../platform/bridge";
import { useLibraryStore } from "./useLibraryStore";
import { useSettingsStore } from "./useSettingsStore";

const PROGRESS_FLUSH_SECONDS = 5;

interface PlayerStore {
  state: PlaybackState;
  error: string | null;
  /** Book resolved from the library store for the current id. */
  book: Book | null;
  /** Direct audio URL currently loaded in the engine. */
  url: string | null;
  /** True while the engine (re)loads a chapter file. */
  loading: boolean;
  bind(): Promise<void>;
  loadBook(
    book: Book,
    options?: { position?: number; chapterIndex?: number; autoplay?: boolean },
  ): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  toggle(): Promise<void>;
  seek(absoluteSeconds: number): Promise<void>;
  seekChapter(index: number): Promise<void>;
  nextChapter(): Promise<void>;
  prevChapter(): Promise<void>;
  skip(seconds: number): void;
  nextBook(): Promise<void>;
  /**
   * Play a list of books as the queue.
   *
   * `shuffle` reorders the whole list before the first book starts, so the
   * queue you see is the order you will hear - and the first book is the first
   * entry of the shuffled queue, not a separate random pick.
   */
  playQueue(bookIds: ID[], options?: { shuffle?: boolean }): Promise<void>;
  /** A workaround the engine had to apply, shown to the listener. */
  notice: string | null;
  /** True while the equalizer and the visualizer are switched off by force. */
  graphRefused: boolean;
  /** True while the graph is only waiting for the first click. */
  graphPending: boolean;
  clearNotice(): void;
  /**
   * Ask the engine for the effects graph once more. Used by Settings after a
   * system refused it: the answer is a boolean so the caller can say what
   * happened without guessing.
   */
  retryEffects(): Promise<boolean>;
  prevBook(): Promise<void>;
  setSpeed(speed: number): void;
  /** Persist the current speed on the book it belongs to. */
  rememberSpeed(speed: number): Promise<void>;
  /** Reload the last listened-to book, paused. */
  restoreLastBook(): Promise<void>;
  nudgeSpeed(direction: 1 | -1): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  cycleRepeat(): void;
  toggleShuffle(): void;
  setSleep(minutes: number | null): void;
  toggleStopAfterChapter(): void;
  addBookmark(label?: string): Promise<void>;
  currentChapter(): Chapter | null;
  /** Where the listener stopped inside a chapter, or null when they never did. */
  chapterStopFor(chapterIndex: number): number | null;
  /** Write the current chapter's offset into the book, if it moved. */
  rememberChapterStop(): Promise<void>;
  chapterTime(): number;
  remaining(): number;
  flushProgress(force?: boolean): Promise<void>;
  /**
   * Repair a playback that stopped without being asked to.
   *
   * The transport knows what the listener wanted; the element only knows what
   * it is doing. When the two disagree - a settings change, a device that went
   * away, a driver that dropped the stream - this reloads the same spot in the
   * same chapter instead of waiting for somebody to change chapter.
   */
  heal(reason?: string): Promise<boolean>;
}

let bound = false;
/**
 * The intent, as opposed to the element's behaviour.
 *
 * `state.playing` is what the interface shows and can be wrong twice over: it
 * can say "playing" while the element sits paused (a stop nobody asked for),
 * and it can say "paused" during a chapter change while the next file is
 * already on its way. The intent is written by play/pause/load only, so it is
 * the one thing a watchdog can trust.
 */
let desiredPlaying = false;
let healAt = 0;
/**
 * A chapter change swaps the file, and the gap while the next one loads is a
 * pause the listener did ask for. The watchdog keeps its hands off for a moment
 * after a load so it cannot fight the transition it just started.
 */
let awaitingChapter = false;
let awaitingSince = 0;
/**
 * When Amp itself last stopped the sound. The engine's "paused" event arrives
 * either way, and the difference matters: one is the failure this store
 * repairs, the other is the end of a book. A timestamp rather than a flag, so a
 * stop that never produced its event cannot swallow a later real failure.
 */
let pauseWasOursAt = 0;
const OUR_PAUSE_WINDOW = 2500;
let lastFlush = 0;
let lastTickAt = typeof performance !== "undefined" ? performance.now() : 0;
let loadedUrl: string | null = null;

function urlForChapter(book: Book, chapterIndex: number): string {
  const host = bridgeIfReady();
  const chapter = book.chapters[chapterIndex];
  if (book.kind === "multi" && chapter?.file) {
    return host ? host.library.fileUrl(chapter.file) : chapter.file;
  }
  return host ? host.library.fileUrl(book.sourcePath) : book.sourcePath;
}

export const usePlayerStore = create<PlayerStore>((set, get) => {
  const dispatch = (action: PlaybackAction) => {
    set({ state: playbackReducer(get().state, action) });
  };

  /** Push the current state into the engine (idempotent). */
  const syncEngine = async (options: { forceLoad?: boolean; autoplay?: boolean } = {}) => {
    const { state, book } = get();
    if (!book) return;
    const chapterIndex = Math.min(state.chapterIndex, Math.max(0, book.chapters.length - 1));
    const url = urlForChapter(book, chapterIndex);
    const local = book.kind === "multi" ? chapterLocalTime(book, state.position) : state.position;
    const settings = useSettingsStore.getState().settings;
    set({ loading: true });
    try {
      if (options.forceLoad || loadedUrl !== url) {
        loadedUrl = url;
        set({ url });
        await engine.load(url, {
          position: Math.max(0, local),
          autoplay: options.autoplay ?? state.playing,
          rate: state.speed,
        });
      } else if (options.autoplay && engine.isPaused()) {
        await engine.play();
      }
    } catch (error) {
      // The engine explains itself when it can; anything that escapes to here
      // is a genuine fault, so its own message is the honest thing to show.
      set({ error: explainPlaybackError(url, error) });
    } finally {
      set({ loading: false });
    }
    engine.setRate(state.speed);
    engine.setVolume(state.volume, state.muted);
    applyEqualizer(settings);
  };

  const handleEngineEvent = (event: EngineEvent) => {
    const { state, book } = get();
    switch (event.type) {
      case "time": {
        if (!book) return;
        const absolute =
          book.kind === "multi" ? (book.chapters[state.chapterIndex]?.start ?? 0) + event.time : event.time;
        const previous = state.position;
        if (Number.isFinite(absolute) && Math.abs(absolute - previous) > 0.2) {
          set({ state: { ...state, position: absolute } });
          const chapterIndex = chapterAt(book.chapters, absolute);
          if (chapterIndex !== state.chapterIndex) {
            set({ state: { ...get().state, chapterIndex } });
          }
          useLibraryStore.getState().recordProgress(book.id, absolute);
          if (absolute - lastFlush > PROGRESS_FLUSH_SECONDS || lastFlush === 0) {
            lastFlush = absolute;
            void useLibraryStore.getState().persist();
          }
        }
        // Sleep timer: count down against wall clock, fade out at zero.
        const nowTick = performance.now();
        const delta = Math.min(2, Math.max(0, (nowTick - lastTickAt) / 1000));
        lastTickAt = nowTick;
        if (state.sleepRemaining !== null && state.sleepRemaining !== undefined) {
          const remaining = Math.max(0, state.sleepRemaining - delta);
          set({ state: { ...get().state, sleepRemaining: remaining } });
          if (remaining <= 0) {
            const sleepSettings = useSettingsStore.getState().settings;
            set({ state: { ...get().state, sleepRemaining: null } });
            pauseWasOursAt = Date.now();
            desiredPlaying = false;
            void engine.fadeTo(0, Math.max(1, sleepSettings.playback.sleepFade / 4)).then(() => {
              engine.pause();
              set({ state: { ...get().state, playing: false } });
              engine.setVolume(sleepSettings.playback.volume, sleepSettings.playback.muted);
              void get().flushProgress(true);
            });
          }
        }
        break;
      }
      case "ended": {
        // The file ran out and the next one is about to be loaded: for the next
        // few seconds a paused element is exactly what is supposed to happen,
        // and the watchdog must not "repair" the chapter change it started.
        awaitingChapter = true;
        awaitingSince = Date.now();
        void handleChapterEnded();
        break;
      }
      case "paused":
        set({ state: { ...get().state, playing: false } });
        void get().flushProgress(true);
        /*
         * A pause nobody asked for is the failure this store repairs: the intent
         * is still "playing", so the sound comes back at the position it
         * stopped. An intentional pause - the sleep timer fading out, a book
         * that ran out, a stop-after-chapter - clears the intent first, so the
         * watchdog has nothing to repair.
         */
        if (Date.now() - pauseWasOursAt < OUR_PAUSE_WINDOW) {
          pauseWasOursAt = 0;
          desiredPlaying = false;
        } else if (desiredPlaying) {
          window.setTimeout(() => void get().heal("unexpected pause"), 400);
        }
        break;
      case "playing":
        awaitingChapter = false;
        set({ state: { ...get().state, playing: true } });
        break;
      case "error":
        set({ error: event.message, state: { ...get().state, playing: false } });
        break;
      case "graph":
        set({ graphRefused: event.refused, graphPending: Boolean(event.pending) });
        break;
      case "notice":
        // Something was worked around - say so once rather than leaving the
        // listener wondering where the equalizer went.
        set({ notice: event.message });
        break;
      default:
        break;
    }
  };

  const handleChapterEnded = async () => {
    const { state, book } = get();
    if (!book) return;
    const wasLast = state.chapterIndex >= book.chapters.length - 1;
    const next = playbackReducer(state, { type: "chapterEnded", book });
    // Reading stops here when the book ran out or the listener asked for one
    // chapter and no more: both are decisions, not silence to be repaired.
    if (!next.playing) {
      pauseWasOursAt = Date.now();
      desiredPlaying = false;
    }
    set({ state: next });

    if (!wasLast) {
      // Multi file books move to the next file, single file books just seek.
      await syncEngine({ forceLoad: book.kind === "multi", autoplay: next.playing });
      return;
    }

    // Last chapter: repeat loops the book, otherwise the queue takes over.
    const looping = next.chapterIndex === 0 && next.position === 0 && next.playing;
    if (looping) {
      loadedUrl = null;
      await syncEngine({ forceLoad: true, autoplay: true });
      return;
    }

    awaitingChapter = false;
    void get().flushProgress(true);
    const queue = useLibraryStore.getState().state.queue.map((q) => q.bookId);
    const autoNext = useSettingsStore.getState().settings.playback.autoNext;
    if (autoNext && queue.length > 1) {
      await get().nextBook();
      return;
    }
    set({ state: { ...get().state, playing: false } });
  };

  return {
    state: initialPlaybackState,
    error: null,
    notice: null,
    graphRefused: false,
    graphPending: false,
    book: null,
    url: null,
    loading: false,

    async bind() {
      if (bound) return;
      bound = true;
      engine.on(handleEngineEvent);
      engine.bindMediaSession({
        play: () => void get().play(),
        pause: () => get().pause(),
        next: () => void get().nextChapter(),
        previous: () => void get().prevChapter(),
        seekTo: (time) => void get().seek(time),
        seekBackward: () => get().skip(-useSettingsStore.getState().settings.playback.skipBackSeconds),
        seekForward: () => get().skip(useSettingsStore.getState().settings.playback.skipSeconds),
      });
      const host = await getBridge();
      host.player.onCommand((command, payload) => {
        void handleCommand(command, payload);
      });
      // Keep the current book in sync with library edits (progress, chapters).
      useLibraryStore.subscribe((library) => {
        const current = get().state.bookId;
        if (!current) return;
        const book = library.state.books.find((b) => b.id === current);
        if (book) set({ book });
      });
      /*
       * Settings are written on every slider drag, and this used to push the
       * whole audio path into the engine each time: ten filter ramps, a balance
       * write, a channel re-route and a rate write per event. That is where
       * "the sound drops when I change a setting" came from. Only the fields
       * that actually changed are applied now.
       */
      let previousSettings = useSettingsStore.getState().settings;
      useSettingsStore.subscribe((settingsStore) => {
        const next = settingsStore.settings;
        const before = previousSettings;
        previousSettings = next;
        const equalizerTouched =
          before.equalizer.enabled !== next.equalizer.enabled ||
          before.equalizer.preamp !== next.equalizer.preamp ||
          before.equalizer.balance !== next.equalizer.balance ||
          before.equalizer.gains.join(",") !== next.equalizer.gains.join(",") ||
          before.audio.channelMode !== next.audio.channelMode;
        if (equalizerTouched) applyEqualizer(next);
        // The global speed is a default, not an override: a book with its own
        // speed keeps it.
        if (before.playback.speed !== next.playback.speed && !get().book?.speed) {
          engine.setRate(next.playback.speed);
        }
        if (before.playback.volume !== next.playback.volume || before.playback.muted !== next.playback.muted) {
          engine.setVolume(next.playback.volume, next.playback.muted);
        }
        /*
         * Every settings change is a chance for the output to have been
         * disturbed - an effects graph rebuilt, a sink re-selected, a device
         * that came back. If the listener is meant to be hearing something and
         * the element disagrees, repair it here: this is the "changing a setting
         * stopped my book until I changed chapter" bug, fixed at the source.
         */
        if (desiredPlaying && engine.isPaused()) {
          window.setTimeout(() => void get().heal("settings change"), 120);
        }
      });

      /*
       * The watchdog.
       *
       * Once every two seconds, while the listener expects sound, the element is
       * asked whether it agrees. Silence with a paused element is repaired in
       * place, in the same chapter, at the position that was reached.
       */
      window.setInterval(() => {
        if (!desiredPlaying) return;
        if (get().loading) return;
        if (!engine.isPaused()) return;
        void get().heal("watchdog");
      }, 2000);
      // Coming back to the window is the other moment a suspended context shows
      // up: the machine slept, or the audio came back from a device change.
      window.addEventListener("focus", () => {
        if (desiredPlaying && engine.isPaused()) void get().heal("window focus");
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && desiredPlaying && engine.isPaused()) void get().heal("window shown");
      });
      window.addEventListener("beforeunload", () => {
        void get().flushProgress(true);
      });
    },

    async loadBook(book, options = {}) {
      desiredPlaying = Boolean(options.autoplay);
      awaitingChapter = true;
      awaitingSince = Date.now();
      await get().flushProgress(true);
      const rewind = useSettingsStore.getState().settings.playback.resumeRewind;
      const start =
        options.position ??
        (options.chapterIndex !== undefined
          ? (book.chapters[options.chapterIndex]?.start ?? 0)
          : // Resuming steps back a few seconds by default: the last sentence
            // before the mark is usually the one that was missed.
            Math.max(0, book.progress - rewind));
      const position = clampPosition(book, start);
      const next = playbackReducer(get().state, {
        type: "load",
        book,
        position,
        autoplay: options.autoplay ?? true,
      });
      // A book that has been sped up before opens at that speed again; the
      // global default is only the starting point.
      const speed = clampSpeed(book.speed ?? useSettingsStore.getState().settings.playback.speed);
      set({
        state: { ...next, speed, chapterIndex: options.chapterIndex ?? next.chapterIndex },
        book,
        error: null,
      });
      useLibraryStore.getState().recordProgress(book.id, position);
      useLibraryStore.getState().pushHistory(book.id, position);
      await syncEngine({ forceLoad: true, autoplay: options.autoplay ?? true });
      awaitingChapter = false;
      const settings = useSettingsStore.getState().settings;
      const currentChapter = book.chapters[chapterAt(book.chapters, position)];
      void getBridge().then((host) =>
        host.player.setMediaSession({
          title: currentChapter?.title ?? book.title,
          artist: book.author,
          album: book.title,
          artwork: book.coverDataUrl,
        }),
      );
      if (settings.playback.muted) engine.setMuted(true);
    },

    async play() {
      const { book, state } = get();
      if (!book) return;
      desiredPlaying = true;
      const local = book.kind === "multi" ? chapterLocalTime(book, state.position) : state.position;
      await engine.ensurePlaying(local);
      // Believe the element, not the intent: a play() that resolved on a dead
      // element is how "playing" and silence could be true at once.
      set({ state: { ...get().state, playing: !engine.isPaused() } });
      if (engine.isPaused()) {
        // Reloading at the same position is the repair of last resort, and it
        // is exactly what changing the chapter was doing by hand.
        await syncEngine({ forceLoad: true, autoplay: true });
        set({ state: { ...get().state, playing: !engine.isPaused() } });
      }
      engine.setRate(get().state.speed);
    },

    pause() {
      desiredPlaying = false;
      pauseWasOursAt = Date.now();
      engine.pause();
      set({ state: { ...get().state, playing: false } });
      void get().flushProgress(true);
    },

    async toggle() {
      const { book, state } = get();
      if (!book) return;
      if (state.playing) get().pause();
      else await get().play();
    },

    async seek(absoluteSeconds) {
      const { book } = get();
      if (!book) return;
      const absolute = clampPosition(book, absoluteSeconds);
      const chapterIndex = chapterAt(book.chapters, absolute);
      const state = get().state;
      if (chapterIndex !== state.chapterIndex) {
        /*
         * A chapter is being left behind by the scrubber, a chapter row or the
         * chapter dropdown - not by the next/previous buttons, which have their
         * own path. Every way out of a chapter has to leave the same note, or
         * "continue with the remaining" only works for listeners who happen to
         * use the transport.
         */
        await get().rememberChapterStop();
      }
      if (chapterIndex !== state.chapterIndex && book.kind === "multi") {
        set({ state: { ...state, chapterIndex, position: absolute, seekNonce: state.seekNonce + 1 } });
        // A scrub across a chapter boundary swaps the file, and the new file is
        // loaded where the listener was - paused stays paused, playing carries
        // on. Starting a paused book is not the scrubber's decision to make.
        void syncEngine({ forceLoad: true, autoplay: get().state.playing });
        return;
      }
      set({ state: { ...state, chapterIndex, position: absolute, seekNonce: state.seekNonce + 1 } });
      engine.seek(book.kind === "multi" ? chapterLocalTime(book, absolute) : absolute);
    },

    async seekChapter(index) {
      const { book } = get();
      if (!book) return;
      const chapter = book.chapters[index];
      if (!chapter) return;
      // Leave a note in the chapter being left behind before moving on.
      await get().rememberChapterStop();
      // Coming back to a chapter continues where it was left, unless the
      // listener asked for the beginning by clicking the chapter twice.
      const remembered = useSettingsStore.getState().settings.playback.rememberChapters
        ? chapterStop(book, index)
        : null;
      const position = remembered === null ? chapter.start : chapter.start + remembered;
      set({
        state: {
          ...get().state,
          chapterIndex: index,
          position,
          seekNonce: get().state.seekNonce + 1,
        },
      });
      await syncEngine({ forceLoad: true, autoplay: get().state.playing });
      await getBridge().then((host) =>
        host.player.setMediaSession({
          title: chapter.title,
          artist: book.author,
          album: book.title,
          artwork: book.coverDataUrl,
        }),
      );
    },

    async nextChapter() {
      const { book, state } = get();
      if (!book) return;
      const index = Math.min(book.chapters.length - 1, state.chapterIndex + 1);
      if (index === state.chapterIndex) {
        await get().nextBook();
        return;
      }
      await get().seekChapter(index);
    },

    async prevChapter() {
      const { book, state } = get();
      if (!book) return;
      const chapter = book.chapters[state.chapterIndex];
      const local = state.position - (chapter?.start ?? 0);
      if (local > 3 || state.chapterIndex === 0) {
        get().seek(chapter?.start ?? 0);
        return;
      }
      await get().seekChapter(state.chapterIndex - 1);
    },

    skip(seconds) {
      const { book, state } = get();
      if (!book) return;
      get().seek(state.position + seconds);
    },

    async playQueue(bookIds, options = {}) {
      const library = useLibraryStore.getState();
      const ids = [...new Set(bookIds)];
      const ordered = options.shuffle ? shuffle(ids) : ids;
      if (ordered.length === 0) return;
      await library.setQueue(ordered);
      const first = useLibraryStore.getState().state.books.find((item) => item.id === ordered[0]);
      if (!first) return;
      await get().loadBook(first, { position: options.shuffle ? 0 : first.progress, autoplay: true });
    },

    async nextBook() {
      const library = useLibraryStore.getState();
      const queue = library.state.queue.map((q) => q.bookId);
      const currentId = get().state.bookId;
      const nextId = nextInQueue(queue, currentId, get().state.shuffle);
      const fallback = library.state.books.find((b) => b.id !== currentId);
      const book = library.state.books.find((b) => b.id === nextId) ?? fallback;
      if (book) await get().loadBook(book, { position: 0, autoplay: true });
    },

    async prevBook() {
      const library = useLibraryStore.getState();
      const queue = library.state.queue.map((q) => q.bookId);
      const prevId = prevInQueue(queue, get().state.bookId);
      const book = library.state.books.find((b) => b.id === prevId);
      if (book) await get().loadBook(book, { position: 0, autoplay: true });
    },

    setSpeed(speed) {
      const value = clampSpeed(speed);
      dispatch({ type: "speed", value });
      engine.setRate(value);
      void useSettingsStore.getState().update({ playback: { speed: value } });
      void get().rememberSpeed(value);
    },

    nudgeSpeed(direction) {
      dispatch({ type: "speed", direction });
      const speed = get().state.speed;
      engine.setRate(speed);
      void useSettingsStore.getState().update({ playback: { speed } });
      void get().rememberSpeed(speed);
    },

    /**
     * Store the speed on the book and write the library out.
     *
     * The global default already travels in settings.json; this is what makes
     * "1.75x for this one, 1x for the rest" survive a restart, and it is the
     * reason the library file is the place playback memory lives.
     */
    async rememberSpeed(speed) {
      const { book } = get();
      if (!book) return;
      const library = useLibraryStore.getState();
      const stored = library.state.books.find((item) => item.id === book.id);
      if (!stored || stored.speed === speed) return;
      await library.patchBook(book.id, { speed });
      const updated = useLibraryStore.getState().state.books.find((item) => item.id === book.id);
      if (updated) set({ book: updated });
    },

    /**
     * Bring back the book that was last listened to, paused where it stopped.
     *
     * Nothing plays on its own: the player bar and the full screen player are
     * there, the position is where the listener left it, and pressing play
     * continues. This is what makes reopening Amp feel like reopening a book.
     */
    async restoreLastBook() {
      if (get().book) return;
      const settings = useSettingsStore.getState().settings;
      if (!settings.playback.restoreLast) return;
      const library = useLibraryStore.getState().state;
      const last = [...library.books]
        .filter((item) => item.progress > 0 || item.lastPlayedAt)
        .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))[0];
      if (!last) return;
      await get().loadBook(last, { position: last.progress, autoplay: false });
    },

    setVolume(volume) {
      dispatch({ type: "volume", value: volume });
      engine.setVolume(volume, false);
      void useSettingsStore.getState().update({ playback: { volume, muted: false } });
    },

    toggleMute() {
      dispatch({ type: "mute" });
      const muted = get().state.muted;
      engine.setMuted(muted);
      void useSettingsStore.getState().update({ playback: { muted } });
    },

    cycleRepeat() {
      dispatch({ type: "repeat" });
    },

    toggleShuffle() {
      dispatch({ type: "shuffle" });
    },

    setSleep(minutes) {
      dispatch({ type: "sleep", minutes });
    },

    toggleStopAfterChapter() {
      dispatch({ type: "stopAfterChapter" });
    },

    async addBookmark(label) {
      const { book, state } = get();
      if (!book) return;
      const library = useLibraryStore.getState();
      await library.addBookmark({
        bookId: book.id,
        position: state.position,
        chapterIndex: state.chapterIndex,
        label: label ?? book.chapters[state.chapterIndex]?.title ?? "Bookmark",
      });
    },

    chapterStopFor(chapterIndex) {
      const { book } = get();
      return book ? chapterStop(book, chapterIndex) : null;
    },

    /**
     * Store where the current chapter was left.
     *
     * Called when a chapter is left and when progress is flushed, so a hop
     * through three chapters of a forty-chapter book costs nothing: each one
     * keeps its own place and "continue with the remaining" is the position it
     * was left at.
     */
    async rememberChapterStop() {
      const { book, state } = get();
      if (!book) return;
      if (!useSettingsStore.getState().settings.playback.rememberChapters) return;
      const chapter = book.chapters[state.chapterIndex];
      if (!chapter) return;
      const offset = Math.max(0, state.position - chapter.start);
      const next = withChapterStop(book, state.chapterIndex, offset);
      if (!next) return;
      const library = useLibraryStore.getState();
      await library.patchBook(book.id, { chapterStops: next });
      const updated = useLibraryStore.getState().state.books.find((item) => item.id === book.id);
      if (updated) set({ book: updated });
    },

    currentChapter() {
      const { book, state } = get();
      if (!book) return null;
      return book.chapters[state.chapterIndex] ?? null;
    },

    chapterTime() {
      const { book, state } = get();
      if (!book) return 0;
      return state.position - (book.chapters[state.chapterIndex]?.start ?? 0);
    },

    clearNotice() {
      set({ notice: null });
    },

    async heal(reason = "watchdog") {
      if (!desiredPlaying) return false;
      if (!get().book) return false;
      if (get().loading) return false;
      if (!engine.isPaused()) return true;
      // A load in flight is allowed to be paused for a moment.
      if (awaitingChapter && Date.now() - awaitingSince < 6000) return false;
      const now = Date.now();
      if (now - healAt < 1500) return false;
      healAt = now;
      const repaired = await engine.recover(reason);
      set({ state: { ...get().state, playing: !engine.isPaused() } });
      if (repaired) {
        awaitingChapter = false;
        // The speed and the volume live on the element that was rebuilt.
        engine.setRate(get().state.speed);
        engine.setVolume(get().state.volume, get().state.muted);
      }
      return repaired;
    },

    async retryEffects() {
      const ok = await engine.retryGraph();
      set({ graphRefused: !ok });
      return ok;
    },

    remaining() {
      const { book, state } = get();
      if (!book) return 0;
      return Math.max(0, book.duration - state.position) / (state.speed || 1);
    },

    async flushProgress(force = false) {
      const { book, state } = get();
      if (!book) return;
      if (!force && Math.abs(book.progress - state.position) < PROGRESS_FLUSH_SECONDS) return;
      useLibraryStore.getState().recordProgress(book.id, state.position);
      await get().rememberChapterStop();
      const settings = useSettingsStore.getState().settings;
      if (settings.playback.resume) await useLibraryStore.getState().persist();
    },
  };
});

/** Single place that maps host commands (tray, media keys, global hotkeys) to actions. */
export async function handleCommand(command: string, payload?: unknown): Promise<void> {
  const player = usePlayerStore.getState();
  switch (command) {
    case "playPause":
      await player.toggle();
      break;
    case "nextChapter":
      await player.nextChapter();
      break;
    case "prevChapter":
      await player.prevChapter();
      break;
    case "skipForward":
      player.skip(useSettingsStore.getState().settings.playback.skipSeconds);
      break;
    case "skipBack":
      player.skip(-useSettingsStore.getState().settings.playback.skipBackSeconds);
      break;
    case "speedUp":
      player.nudgeSpeed(1);
      break;
    case "speedDown":
      player.nudgeSpeed(-1);
      break;
    case "bookmark":
      await player.addBookmark();
      break;
    case "wake":
      await bridgeIfReady()?.player.wake();
      break;
    case "toggleMini":
      useSettingsStore
        .getState()
        .update({ window: { mini: !useSettingsStore.getState().settings.window.mini } });
      break;
    case "import":
      await useLibraryStore.getState().importPaths((payload as string[]) ?? []);
      break;
    default:
      break;
  }
}

/** Fisher-Yates, so a shuffle is uniform and not just "sorted randomly". */
function shuffle<T>(items: T[]): T[] {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

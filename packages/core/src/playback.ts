/**
 * Player state machine. Kept pure so the renderer store, the mini widget and
 * the tests all agree on what "next chapter" means.
 */

import type { Book, Chapter, ID } from "./types";
import { chapterAt } from "./library";
import { nextSpeed } from "./time";

export type RepeatMode = "off" | "book" | "chapter" | "queue";

export interface PlaybackState {
  bookId: ID | null;
  chapterIndex: number;
  /** Absolute position inside the book, seconds. */
  position: number;
  playing: boolean;
  speed: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /** Seconds left on the sleep timer, null when off. */
  sleepRemaining: number | null;
  /** Stop playback when the current chapter ends. */
  stopAfterChapter: boolean;
  /** Bumped whenever the audio element must hard seek. */
  seekNonce: number;
}

export const initialPlaybackState: PlaybackState = {
  bookId: null,
  chapterIndex: 0,
  position: 0,
  playing: false,
  speed: 1,
  volume: 1,
  muted: false,
  repeat: "off",
  shuffle: false,
  sleepRemaining: null,
  stopAfterChapter: false,
  seekNonce: 0,
};

export type PlaybackAction =
  | { type: "load"; book: Book; position?: number; autoplay?: boolean }
  | { type: "play" }
  | { type: "pause" }
  | { type: "toggle" }
  | { type: "seek"; position: number }
  | { type: "seekChapter"; index: number }
  | { type: "nextChapter" }
  | { type: "prevChapter"; book: Book; threshold?: number }
  | { type: "skip"; seconds: number; book: Book }
  | { type: "tick"; delta: number; book: Book }
  | { type: "speed"; value?: number; direction?: 1 | -1 }
  | { type: "volume"; value: number }
  | { type: "mute"; value?: boolean }
  | { type: "repeat"; value?: RepeatMode }
  | { type: "shuffle"; value?: boolean }
  | { type: "sleep"; minutes: number | null }
  | { type: "stopAfterChapter"; value?: boolean }
  | { type: "chapterEnded"; book: Book }
  | { type: "bookEnded" };

export function chapterStarts(chapters: Chapter[]): number[] {
  return chapters.map((c) => c.start);
}

export function chapterLocalTime(book: Book, position: number): number {
  const index = chapterAt(book.chapters, position);
  const chapter = book.chapters[index];
  if (!chapter) return 0;
  return Math.max(0, position - chapter.start);
}

export function clampPosition(book: Book, position: number): number {
  return Math.max(0, Math.min(book.duration || 0, position));
}

/** The core reducer. Returns a new state, never mutates. */
export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case "load": {
      const position = clampPosition(action.book, action.position ?? action.book.progress ?? 0);
      return {
        ...state,
        bookId: action.book.id,
        position,
        chapterIndex: chapterAt(action.book.chapters, position),
        playing: action.autoplay ?? true,
        seekNonce: state.seekNonce + 1,
      };
    }
    case "play":
      return { ...state, playing: true };
    case "pause":
      return { ...state, playing: false };
    case "toggle":
      return { ...state, playing: !state.playing };
    case "seek":
      return { ...state, position: Math.max(0, action.position), seekNonce: state.seekNonce + 1 };
    case "seekChapter":
      return { ...state, chapterIndex: Math.max(0, action.index), seekNonce: state.seekNonce + 1 };
    case "nextChapter":
      return { ...state, chapterIndex: Math.max(0, state.chapterIndex + 1), seekNonce: state.seekNonce + 1 };
    case "prevChapter": {
      const threshold = action.threshold ?? 3;
      const index = chapterAt(action.book.chapters, state.position);
      const start = action.book.chapters[index]?.start ?? 0;
      const restartCurrent = state.position - start > threshold;
      const targetIndex = restartCurrent ? index : Math.max(0, index - 1);
      return {
        ...state,
        chapterIndex: targetIndex,
        position: action.book.chapters[targetIndex]?.start ?? 0,
        seekNonce: state.seekNonce + 1,
      };
    }
    case "skip": {
      const position = clampPosition(action.book, state.position + action.seconds);
      return {
        ...state,
        position,
        chapterIndex: chapterAt(action.book.chapters, position),
        seekNonce: state.seekNonce + 1,
      };
    }
    case "tick": {
      if (!state.playing) return state;
      const position = clampPosition(action.book, state.position + action.delta * state.speed);
      const chapterIndex = chapterAt(action.book.chapters, position);
      const sleepRemaining =
        state.sleepRemaining === null ? null : Math.max(0, state.sleepRemaining - action.delta);
      return { ...state, position, chapterIndex, sleepRemaining };
    }
    case "speed": {
      const next = action.value ?? nextSpeed(state.speed, action.direction ?? 1);
      return { ...state, speed: Math.max(0.25, Math.min(5, next)) };
    }
    case "volume":
      return { ...state, volume: Math.max(0, Math.min(1.5, action.value)), muted: false };
    case "mute":
      return { ...state, muted: action.value ?? !state.muted };
    case "repeat":
      return { ...state, repeat: action.value ?? nextRepeat(state.repeat) };
    case "shuffle":
      return { ...state, shuffle: action.value ?? !state.shuffle };
    case "sleep":
      return { ...state, sleepRemaining: action.minutes === null ? null : action.minutes * 60 };
    case "stopAfterChapter":
      return { ...state, stopAfterChapter: action.value ?? !state.stopAfterChapter };
    case "chapterEnded": {
      const lastIndex = action.book.chapters.length - 1;
      if (state.stopAfterChapter) return { ...state, playing: false, stopAfterChapter: false };
      if (state.repeat === "chapter") {
        const start = action.book.chapters[state.chapterIndex]?.start ?? 0;
        return { ...state, position: start, seekNonce: state.seekNonce + 1 };
      }
      const start = action.book.chapters[state.chapterIndex]?.start ?? 0;
      if (state.chapterIndex >= lastIndex) {
        if (state.repeat === "book" || state.repeat === "queue") {
          return { ...state, chapterIndex: 0, position: 0, seekNonce: state.seekNonce + 1 };
        }
        return { ...state, position: action.book.duration, playing: false };
      }
      return {
        ...state,
        chapterIndex: state.chapterIndex + 1,
        position: Math.max(start + (action.book.chapters[state.chapterIndex]?.duration ?? 0), 0),
        seekNonce: state.seekNonce + 1,
      };
    }
    case "bookEnded":
      if (state.repeat === "book" || state.repeat === "queue") {
        return { ...state, position: 0, chapterIndex: 0, seekNonce: state.seekNonce + 1 };
      }
      return { ...state, playing: false };
    default:
      return state;
  }
}

export function nextRepeat(mode: RepeatMode): RepeatMode {
  const order: RepeatMode[] = ["off", "chapter", "book", "queue"];
  return order[(order.indexOf(mode) + 1) % order.length];
}

/** Shuffle helper that keeps the current item first. */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function progressPercent(position: number, duration: number): number {
  if (!duration) return 0;
  return Math.max(0, Math.min(100, (position / duration) * 100));
}

export function sleepLabel(seconds: number | null): string {
  if (seconds === null) return "Off";
  if (seconds <= 0) return "Ending";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/** Queue maths shared by the player store and the widget. */
export function nextInQueue(queue: ID[], currentId: ID | null, shuffle = false, random = Math.random): ID | null {
  if (queue.length === 0) return null;
  if (shuffle) {
    const pool = queue.filter((id) => id !== currentId);
    if (pool.length === 0) return currentId;
    return pool[Math.floor(random() * pool.length)];
  }
  const index = currentId ? queue.indexOf(currentId) : -1;
  if (index === -1) return queue[0];
  return queue[(index + 1) % queue.length];
}

export function prevInQueue(queue: ID[], currentId: ID | null): ID | null {
  if (queue.length === 0) return null;
  const index = currentId ? queue.indexOf(currentId) : 0;
  if (index <= 0) return queue[queue.length - 1];
  return queue[index - 1];
}

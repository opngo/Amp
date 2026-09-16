import { describe, expect, it } from "vitest";
import {
  chapterLocalTime,
  initialPlaybackState,
  nextInQueue,
  playbackReducer,
  prevInQueue,
  progressPercent,
  sleepLabel,
  type PlaybackState,
} from "../playback";
import { nextSpeed, formatTime, formatDuration, parseTime, formatBytes, timeAgo, finishAt } from "../time";
import type { Book } from "../types";

const book: Book = {
  id: "bk1",
  title: "Dune",
  author: "Frank Herbert",
  sourcePath: "/books/dune.m4b",
  kind: "single",
  duration: 300,
  chapters: [
    { id: "c1", index: 1, title: "One", start: 0, duration: 100 },
    { id: "c2", index: 2, title: "Two", start: 100, duration: 100 },
    { id: "c3", index: 3, title: "Three", start: 200, duration: 100 },
  ],
  genres: [],
  tags: [],
  favorite: false,
  progress: 40,
  addedAt: 0,
  updatedAt: 0,
};

const loaded: PlaybackState = playbackReducer(initialPlaybackState, { type: "load", book, autoplay: true });

describe("playbackReducer", () => {
  it("loads a book at its saved position", () => {
    expect(loaded.bookId).toBe("bk1");
    expect(loaded.position).toBe(40);
    expect(loaded.chapterIndex).toBe(0);
    expect(loaded.playing).toBe(true);
  });

  it("ticks forward at the playback speed", () => {
    const fast = playbackReducer({ ...loaded, speed: 2, position: 10 }, { type: "tick", delta: 5, book });
    expect(fast.position).toBe(20);
    const slow = playbackReducer({ ...loaded, speed: 0.5, position: 10 }, { type: "tick", delta: 10, book });
    expect(slow.position).toBe(15);
  });

  it("does not tick while paused", () => {
    const paused = playbackReducer(loaded, { type: "pause" });
    const after = playbackReducer(paused, { type: "tick", delta: 10, book });
    expect(after.position).toBe(paused.position);
  });

  it("moves chapters and clamps at the end", () => {
    const next = playbackReducer({ ...loaded, chapterIndex: 1, position: 120 }, { type: "nextChapter" });
    expect(next.chapterIndex).toBe(2);
    const off = playbackReducer({ ...loaded, chapterIndex: 5 }, { type: "nextChapter" });
    expect(off.chapterIndex).toBe(6);
  });

  it("restarts the chapter when pressing previous early on", () => {
    const atStart = playbackReducer({ ...loaded, chapterIndex: 1, position: 101 }, { type: "prevChapter", book });
    expect(atStart.chapterIndex).toBe(0);
    expect(atStart.position).toBe(0);
    const midway = playbackReducer({ ...loaded, chapterIndex: 1, position: 160 }, { type: "prevChapter", book });
    expect(midway.chapterIndex).toBe(1);
    expect(midway.position).toBe(100);
  });

  it("skips and updates the chapter", () => {
    const skipped = playbackReducer({ ...loaded, position: 10 }, { type: "skip", seconds: 150, book });
    expect(skipped.position).toBe(160);
    expect(skipped.chapterIndex).toBe(1);
  });

  it("clamps position to the book duration", () => {
    const skipped = playbackReducer({ ...loaded, position: 290 }, { type: "skip", seconds: 100, book });
    expect(skipped.position).toBe(300);
  });

  it("handles repeat chapter and stop after chapter", () => {
    const repeating = playbackReducer(
      { ...loaded, position: 190, chapterIndex: 1 },
      { type: "repeat", value: "chapter" },
    );
    const ended = playbackReducer(repeating, { type: "chapterEnded", book });
    expect(ended.position).toBe(100);
    const stopping = playbackReducer({ ...loaded, stopAfterChapter: true, chapterIndex: 1 }, { type: "chapterEnded", book });
    expect(stopping.playing).toBe(false);
    expect(stopping.stopAfterChapter).toBe(false);
  });

  it("advances past a finished chapter", () => {
    const ended = playbackReducer({ ...loaded, chapterIndex: 0, position: 99 }, { type: "chapterEnded", book });
    expect(ended.chapterIndex).toBe(1);
    expect(ended.position).toBe(100);
  });

  it("stops at the end of the last chapter", () => {
    const ended = playbackReducer({ ...loaded, chapterIndex: 2 }, { type: "chapterEnded", book });
    expect(ended.position).toBe(300);
    expect(ended.playing).toBe(false);
  });

  it("loops the whole book on repeat", () => {
    const repeat = playbackReducer({ ...loaded, repeat: "book" }, { type: "bookEnded" });
    expect(repeat.position).toBe(0);
    expect(repeat.chapterIndex).toBe(0);
  });

  it("manages speed, volume, mute and sleep", () => {
    const faster = playbackReducer(loaded, { type: "speed", direction: 1 });
    expect(faster.speed).toBeGreaterThan(1);
    const capped = playbackReducer(loaded, { type: "speed", value: 99 });
    expect(capped.speed).toBe(5);
    const quiet = playbackReducer(loaded, { type: "volume", value: 0.2 });
    expect(quiet.volume).toBe(0.2);
    expect(playbackReducer(quiet, { type: "mute" }).muted).toBe(true);
    const sleeping = playbackReducer(loaded, { type: "sleep", minutes: 30 });
    const ticked = playbackReducer(sleeping, { type: "tick", delta: 60, book });
    expect(ticked.sleepRemaining).toBe(30 * 60 - 60);
  });

  it("bumps the seek nonce for hard seeks", () => {
    const seeked = playbackReducer(loaded, { type: "seek", position: 12 });
    expect(seeked.seekNonce).toBe(loaded.seekNonce + 1);
  });
});

describe("playback helpers", () => {
  it("computes chapter local time", () => {
    expect(chapterLocalTime(book, 150)).toBe(50);
  });

  it("computes queue neighbours", () => {
    expect(nextInQueue(["a", "b", "c"], "a")).toBe("b");
    expect(nextInQueue(["a", "b", "c"], "c")).toBe("a");
    expect(prevInQueue(["a", "b", "c"], "a")).toBe("c");
    expect(nextInQueue([], null)).toBeNull();
  });

  it("formats sleep labels and percentages", () => {
    expect(sleepLabel(null)).toBe("Off");
    expect(sleepLabel(90)).toBe("1m 30s");
    expect(progressPercent(50, 200)).toBe(25);
    expect(progressPercent(50, 0)).toBe(0);
  });
});

describe("time helpers", () => {
  it("formats and parses time", () => {
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3725)).toBe("1:02:05");
    expect(formatTime(-5)).toBe("0:00");
    expect(parseTime("1:02:05")).toBe(3725);
    expect(parseTime("65")).toBe(65);
    expect(parseTime("")).toBe(0);
    expect(formatDuration(3725)).toBe("1h 2m");
    expect(formatDuration(45)).toBe("45s");
  });

  it("steps speed up and down", () => {
    expect(nextSpeed(1, 1)).toBe(1.1);
    expect(nextSpeed(1, -1)).toBe(0.9);
    expect(nextSpeed(4, 1)).toBe(4);
    expect(nextSpeed(0.5, -1)).toBe(0.5);
  });

  it("formats bytes and relative dates", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(0)).toBe("0 B");
    expect(timeAgo(Date.now() - 5000)).toBe("just now");
    expect(timeAgo(Date.now() - 3 * 3600_000)).toBe("3h ago");
    expect(finishAt(3600, 0)).toMatch(/\d/);
  });
});

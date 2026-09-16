/**
 * Builds ffmpeg `ffmetadata` payloads for chapter writing and chapter splitting.
 * Pure functions only, which keeps them unit testable without ffmpeg.
 */

import type { Book, Chapter } from "@amp/core";

export interface FfMetadataOptions {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  date?: string;
  comment?: string;
  coverPath?: string;
}

/** Escape the special characters ffmetadata uses. */
export function escapeFfmetadata(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/#/g, "\\#")
    .replace(/=/g, "\\=")
    .replace(/\n/g, "\\\n");
}

/**
 * Produce the `metadata` + `CHAPTER` blocks ffmpeg expects.
 *
 * ```text
 * ;FFMETADATA1
 * title=Children of Time
 * [CHAPTER]
 * TIMEBASE=1/1000
 * START=0
 * END=1920000
 * title=Prologue
 * ```
 */
export function buildFfmetadata(
  chapters: Chapter[],
  metadata: FfMetadataOptions = {},
  totalDuration?: number,
): string {
  const lines = [";FFMETADATA1"];
  const entries: Array<[string, string | undefined]> = [
    ["title", metadata.title],
    ["artist", metadata.artist],
    ["album", metadata.album],
    ["genre", metadata.genre],
    ["date", metadata.date],
    ["comment", metadata.comment],
  ];
  for (const [key, value] of entries) {
    if (value) lines.push(`${key}=${escapeFfmetadata(value)}`);
  }

  const ordered = [...chapters].sort((a, b) => a.start - b.start);
  ordered.forEach((chapter, index) => {
    const next = ordered[index + 1];
    const end = next ? next.start : chapter.start + (chapter.duration || 1);
    const duration = totalDuration && index === ordered.length - 1 ? totalDuration : end;
    lines.push("[CHAPTER]");
    lines.push("TIMEBASE=1/1000");
    lines.push(`START=${Math.round(chapter.start * 1000)}`);
    lines.push(`END=${Math.round(Math.max(chapter.start + 1, duration) * 1000)}`);
    lines.push(`title=${escapeFfmetadata(chapter.title.trim() || `Chapter ${index + 1}`)}`);
  });

  return `${lines.join("\n")}\n`;
}

/** ffmpeg args that copy the streams and attach the chapter metadata file. */
export function writeChaptersArgs(input: string, metadataFile: string, output: string): string[] {
  return [
    "-hide_banner",
    "-y",
    "-i",
    input,
    "-i",
    metadataFile,
    "-map",
    "0:a",
    "-map_metadata",
    "1",
    "-codec",
    "copy",
    output,
  ];
}

/** ffmpeg args that split one chapter out of a file without re-encoding. */
export function splitChapterArgs(input: string, start: number, duration: number, output: string): string[] {
  return [
    "-hide_banner",
    "-y",
    "-ss",
    start.toFixed(3),
    "-i",
    input,
    "-t",
    Math.max(0.5, duration).toFixed(3),
    "-vn",
    "-codec",
    "copy",
    "-map_metadata",
    "-1",
    output,
  ];
}

/** ffmpeg args that write the embedded cover to a file. */
export function extractCoverArgs(input: string, output: string): string[] {
  return ["-hide_banner", "-y", "-i", input, "-map", "0:v", "-frames:v", "1", output];
}

/** Chapter list for a book, preferring explicit chapters over per-file tracks. */
export function chaptersOf(book: Book): Chapter[] {
  if (book.chapters?.length) return book.chapters;
  // A single-container book without embedded chapters is still one chapter.
  if (book.kind === "single") {
    return [{ id: `${book.id}:c0`, index: 1, title: book.title, start: 0, duration: book.duration }];
  }
  return [];
}

export function chapterFileStem(book: Book, chapter: Chapter, index: number): string {
  void book;
  const order = String(index + 1).padStart(2, "0");
  const safe = chapter.title
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${order} - ${safe || `Chapter ${order}`}`;
}

export function totalChapterDuration(chapters: Chapter[]): number {
  return chapters.reduce((total, chapter) => total + (chapter.duration || 0), 0);
}

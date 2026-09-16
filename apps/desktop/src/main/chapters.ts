/**
 * Chapter and tag writing through ffmpeg. Every function feature-detects the
 * binary first so Amp still runs (with a clear message) when ffmpeg is absent.
 */

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bookFiles, bookPrimaryFile, type Book, type Chapter } from "@amp/core";
import {
  buildFfmetadata,
  chapterFileStem,
  chaptersOf,
  extractCoverArgs,
  splitChapterArgs,
  writeChaptersArgs,
} from "./ffmetadata";
import { logLine } from "./store";

let cachedPath: string | null | undefined;

export async function ffmpegPath(): Promise<string | null> {
  if (cachedPath !== undefined) return cachedPath;
  const binary = process.env.AMP_FFMPEG || "ffmpeg";
  cachedPath = await new Promise<string | null>((resolve) => {
    const child = spawn(binary, ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? binary : null));
  });
  if (!cachedPath) await logLine("ffmpeg: not found - chapter writing disabled");
  return cachedPath;
}

export async function hasFfmpeg(): Promise<boolean> {
  return (await ffmpegPath()) !== null;
}

function run(binary: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", () => resolve({ code: -1, stderr: "spawn failed" }));
    child.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

export interface WriteChaptersResult {
  ok: boolean;
  output?: string;
  message: string;
}

/**
 * Write chapter markers into a copy of the book's file. The original is left
 * untouched - Amp never rewrites your library in place.
 */
export async function writeChapters(book: Book, chapters?: Chapter[]): Promise<WriteChaptersResult> {
  const binary = await ffmpegPath();
  if (!binary) return { ok: false, message: "ffmpeg was not found on this system" };
  const list = chapters ?? chaptersOf(book);
  if (!list.length) return { ok: false, message: "This book has no chapters to write" };
  const input = bookPrimaryFile(book);
  if (!input) return { ok: false, message: "This book has no file on disk" };

  const temp = path.join(os.tmpdir(), `amp-chapters-${Date.now()}.txt`);
  const output = path.join(
    path.dirname(input),
    `${path.basename(input, path.extname(input))} (chapters)${path.extname(input)}`,
  );
  const metadata = buildFfmetadata(
    list,
    {
      title: book.title,
      artist: book.author,
      album: book.series,
      genre: book.genres?.join(", "),
      date: book.year ? String(book.year) : undefined,
      comment: book.description,
    },
    book.duration,
  );
  await fs.writeFile(temp, metadata, "utf8");
  try {
    const result = await run(binary, writeChaptersArgs(input, temp, output));
    if (result.code !== 0) {
      await logLine(`ffmpeg: chapter write failed (${result.code}) ${result.stderr.slice(-400)}`);
      return { ok: false, message: "ffmpeg could not write the chapters" };
    }
    return { ok: true, output, message: `Wrote ${list.length} chapters to ${path.basename(output)}` };
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

/** Split a multi-chapter file into one file per chapter in `destination`. */
export async function splitIntoChapters(book: Book, chapters: Chapter[], destination: string): Promise<string[]> {
  const binary = await ffmpegPath();
  if (!binary) throw new Error("ffmpeg was not found on this system");
  const input = bookPrimaryFile(book);
  if (!input) throw new Error("This book has no file on disk");
  await fs.mkdir(destination, { recursive: true });

  const written: string[] = [];
  const ext = path.extname(input) || ".m4b";
  void bookFiles(book);
  for (const [index, chapter] of chapters.entries()) {
    const output = path.join(destination, `${chapterFileStem(book, chapter, index)}${ext}`);
    const result = await run(binary, splitChapterArgs(input, chapter.start, chapter.duration || 1, output));
    if (result.code === 0) written.push(output);
  }
  await logLine(`ffmpeg: split ${written.length}/${chapters.length} chapters from ${path.basename(input)}`);
  return written;
}

export async function extractCoverWithFfmpeg(book: Book, output: string): Promise<string | null> {
  const binary = await ffmpegPath();
  if (!binary) return null;
  const input = bookPrimaryFile(book);
  if (!input) return null;
  const result = await run(binary, extractCoverArgs(input, output));
  return result.code === 0 ? output : null;
}

export interface MediaProbe {
  duration?: number;
  codec?: string;
  bitrate?: number;
  channels?: number;
  sampleRate?: number;
}

/** Quick ffprobe JSON probe, used when the user asks Amp to re-read a file. */
export async function probeMedia(file: string): Promise<MediaProbe | null> {
  const probe = (process.env.AMP_FFPROBE || "ffprobe").replace(/ffmpeg$/, "ffprobe");
  const args = [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=codec_name,bit_rate,channels,sample_rate:format=duration,bit_rate",
    "-of",
    "json",
    file,
  ];
  const result = await new Promise<{ code: number; stdout: string }>((resolve) => {
    const child = spawn(probe, args);
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", () => resolve({ code: -1, stdout: "" }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout }));
  });
  if (result.code !== 0) return null;
  try {
    const payload = JSON.parse(result.stdout) as {
      streams?: Array<{ codec_name?: string; bit_rate?: string; channels?: number; sample_rate?: string }>;
      format?: { duration?: string; bit_rate?: string };
    };
    const stream = payload.streams?.[0];
    return {
      duration: payload.format?.duration ? Number(payload.format.duration) : undefined,
      codec: stream?.codec_name,
      bitrate: Number(stream?.bit_rate ?? payload.format?.bit_rate ?? 0) || undefined,
      channels: stream?.channels,
      sampleRate: stream?.sample_rate ? Number(stream.sample_rate) : undefined,
    };
  } catch {
    return null;
  }
}

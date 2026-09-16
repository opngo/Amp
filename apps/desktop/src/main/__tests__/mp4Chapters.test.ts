/**
 * MP4 / M4B chapter reading.
 *
 * The fixtures are real files written by ffmpeg 7 (AAC audio, chapter track,
 * two seconds per chapter) in both box orders, because the two failure modes
 * this reader exists for are about box order and about several samples sharing
 * one chunk. `ffprobe` agrees on all of them:
 *
 *   0-2s First, 2-4s Second, 4-6s Third
 */

import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MP4_EXTENSIONS,
  bufferReader,
  isMp4Family,
  parseChpl,
  readMp4Chapters,
  readMp4ChaptersFromFile,
} from "../mp4Chapters";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const EXPECTED = [
  { title: "First", start: 0, end: 2 },
  { title: "Second", start: 2, end: 4 },
  { title: "Third", start: 4, end: 6 },
];

describe("mp4 chapters", () => {
  it.each(["chapters-moov-first.m4b", "chapters-moov-last.m4b"])("reads every chapter from %s", async (name) => {
    const chapters = await readMp4ChaptersFromFile(path.join(fixtures, name));
    expect(chapters.map((chapter) => chapter.title)).toEqual(["First", "Second", "Third"]);
    chapters.forEach((chapter, index) => {
      expect(chapter.start).toBeCloseTo(EXPECTED[index].start, 2);
      expect(chapter.end).toBeCloseTo(EXPECTED[index].end, 2);
    });
  });

  it("reads the same chapters from a buffer as from the file", async () => {
    const bytes = await fs.readFile(path.join(fixtures, "chapters-moov-last.m4b"));
    const chapters = await readMp4Chapters(bufferReader(bytes));
    expect(chapters.map((chapter) => chapter.title)).toEqual(["First", "Second", "Third"]);
  });

  it("finds the moov box even when the media sits in front of it", async () => {
    // moov-last is the order music-metadata cannot read chapters from at all.
    const bytes = await fs.readFile(path.join(fixtures, "chapters-moov-last.m4b"));
    const order: string[] = [];
    let position = 0;
    while (position + 8 <= bytes.length) {
      const size = bytes.readUInt32BE(position);
      order.push(bytes.subarray(position + 4, position + 8).toString("latin1"));
      if (size < 8) break;
      position += size;
    }
    expect(order.indexOf("mdat")).toBeLessThan(order.indexOf("moov"));
    const chapters = await readMp4Chapters(bufferReader(bytes));
    expect(chapters.length).toBe(3);
  });

  it("returns nothing for data that is not an MP4", async () => {
    const chapters = await readMp4Chapters(bufferReader(new TextEncoder().encode("this is not a container")));
    expect(chapters).toEqual([]);
    expect(await readMp4ChaptersFromFile(path.join(fixtures, "does-not-exist.m4b"))).toEqual([]);
  });

  it("parses a Nero chapter list", () => {
    // version 0, flags 0, reserved 0, count, then 100ns timestamps + names.
    const names = ["One", "Two"];
    const size = 4 + 4 + 1 + names.length * 9 + names.join("").length;
    const bytes = new Uint8Array(size + 4);
    bytes[4] = 0; // version
    bytes[8 + 4] = names.length;
    let at = 13;
    names.forEach((name, index) => {
      const stamp = (index * 2_500_000);
      bytes.set([0, 0, 0, 0, (stamp >>> 24) & 255, (stamp >>> 16) & 255, (stamp >>> 8) & 255, stamp & 255], at);
      bytes[at + 8] = name.length;
      bytes.set(new TextEncoder().encode(name), at + 9);
      at += 9 + name.length;
    });
    const chapters = parseChpl(bytes, 4, size + 4);
    expect(chapters.map((chapter) => chapter.title)).toEqual(["One", "Two"]);
    expect(chapters[0].start).toBeCloseTo(0, 5);
    expect(chapters[1].start).toBeCloseTo(0.25, 5);
  });

  it("knows which extensions carry MP4 chapters", () => {
    expect(MP4_EXTENSIONS).toContain("m4b");
    expect(isMp4Family("M4B")).toBe(true);
    expect(isMp4Family("mp3")).toBe(false);
  });
});

/**
 * MP4 / M4B chapter reading.
 *
 * Why this exists at all: `music-metadata` is a good library, but its MP4
 * chapter reader has two limits that hurt audiobooks specifically.
 *
 *  1. It only looks for chapters when it walks past the `mdat` box, so a file
 *     whose `moov` box sits at the end (anything not written with
 *     `-movflags +faststart`, which is common for older encoders) reports zero
 *     chapters.
 *  2. It treats one chunk as one chapter. Encoders routinely pack every chapter
 *     title into a single chunk, so a 30 chapter m4b comes back with one.
 *
 * Both were reproducible with files produced by ffmpeg 7 and confirmed against
 * `ffprobe`: three chapters in, one (or zero) out.
 *
 * Chapter extraction is the feature that makes an audiobook player usable, so
 * Amp reads the tables itself. It needs no dependencies and no ffmpeg, works
 * whatever the box order, and follows the sample tables properly:
 *
 *   moov -> trak (handler 'text', referenced from the audio track's tref/chap)
 *        -> mdia/mdhd   timescale
 *        -> mdia/minf/stbl
 *              stts  sample durations  -> chapter start times
 *              stsz  sample sizes
 *              stsc  samples per chunk -> sample -> byte offset
 *              stco / co64 chunk byte offsets
 *
 * The nicer `chpl` box (Nero style, written by many audiobook tools) is read as
 * well and used when the chapter track is missing or thinner.
 */

import { promises as fs } from "node:fs";

export interface Mp4Chapter {
  title: string;
  /** Seconds from the start of the file. */
  start: number;
  /** Seconds from the start of the file. */
  end: number;
}

/** Random access over the file: swappable so this can be tested on buffers. */
export interface BoxReader {
  read(offset: number, length: number): Promise<Uint8Array>;
  size(): Promise<number>;
}

/** Reader backed by a Buffer, used by the tests. */
export function bufferReader(buffer: Uint8Array): BoxReader {
  return {
    async read(offset, length) {
      return buffer.subarray(offset, Math.min(buffer.length, offset + length));
    },
    async size() {
      return buffer.length;
    },
  };
}

/** Reader backed by an open file. */
export function fileReader(path: string): BoxReader & { close(): Promise<void> } {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  return {
    async read(offset, length) {
      if (!handle) handle = await fs.open(path, "r");
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    },
    async size() {
      const stat = await fs.stat(path);
      return stat.size;
    },
    async close() {
      await handle?.close();
      handle = null;
    },
  };
}

interface Box {
  type: string;
  /** First byte of the payload. */
  start: number;
  /** One past the last byte of the payload. */
  end: number;
}

const MAX_MOOV_BYTES = 64 * 1024 * 1024;

function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function uint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint64(bytes: Uint8Array, offset: number): number {
  // Chapter offsets never approach 2^53; reading the low words is enough and
  // avoids BigInt noise in the hot paths.
  const high = uint32(bytes, offset);
  const low = uint32(bytes, offset + 4);
  return high * 2 ** 32 + low;
}

function boxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** The boxes directly inside a byte range. Sizes follow ISO BMFF rules. */
function boxesWithin(bytes: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let position = start;
  while (position + 8 <= end) {
    let size = uint32(bytes, position);
    let header = 8;
    if (size === 1) {
      if (position + 16 > end) break;
      size = uint64(bytes, position + 8);
      header = 16;
    } else if (size === 0) {
      size = end - position;
    }
    if (size < header || position + size > end) break;
    out.push({ type: boxType(bytes, position + 4), start: position + header, end: position + size });
    position += size;
  }
  return out;
}

function firstBox(bytes: Uint8Array, start: number, end: number, type: string): Box | null {
  for (const box of boxesWithin(bytes, start, end)) {
    if (box.type === type) return box;
  }
  return null;
}

/** Follows a path of nested box names, e.g. ["mdia", "minf", "stbl"]. */
function followPath(bytes: Uint8Array, start: number, end: number, path: string[]): Box | null {
  let range: [number, number] = [start, end];
  for (const name of path) {
    const found = firstBox(bytes, range[0], range[1], name);
    if (!found) return null;
    range = [found.start, found.end];
  }
  return { type: path[path.length - 1], start: range[0], end: range[1] };
}

interface SampleTable {
  /** File offset and size of every sample, in order. */
  samples: { offset: number; size: number }[];
  /** Duration of every sample, in the track's timescale. */
  durations: number[];
}

function readSampleTable(bytes: Uint8Array, stbl: Box): SampleTable | null {
  const stts = firstBox(bytes, stbl.start, stbl.end, "stts");
  const stsz = firstBox(bytes, stbl.start, stbl.end, "stsz");
  const stsc = firstBox(bytes, stbl.start, stbl.end, "stsc");
  const stco = firstBox(bytes, stbl.start, stbl.end, "stco") ?? firstBox(bytes, stbl.start, stbl.end, "co64");
  if (!stts || !stsz || !stco) return null;

  // stts: run-length encoded durations, one entry per sample once expanded.
  const durations: number[] = [];
  const sttsCount = uint32(bytes, stts.start + 4);
  for (let i = 0; i < sttsCount; i += 1) {
    const at = stts.start + 8 + i * 8;
    if (at + 8 > stts.end) break;
    const count = uint32(bytes, at);
    const duration = uint32(bytes, at + 4);
    for (let n = 0; n < count; n += 1) durations.push(duration);
  }

  // stsz: either one constant size, or a table of sizes.
  const constantSize = uint32(bytes, stsz.start + 4);
  const sampleCount = uint32(bytes, stsz.start + 8);
  const sizes: number[] = [];
  for (let i = 0; i < sampleCount; i += 1) {
    if (constantSize > 0) sizes.push(constantSize);
    else {
      const at = stsz.start + 12 + i * 4;
      if (at + 4 > stsz.end) break;
      sizes.push(uint32(bytes, at));
    }
  }

  // stsc: how many samples sit in each chunk, as change points.
  const stscEntries: { firstChunk: number; samplesPerChunk: number }[] = [];
  if (stsc) {
    const stscCount = uint32(bytes, stsc.start + 4);
    for (let i = 0; i < stscCount; i += 1) {
      const at = stsc.start + 8 + i * 12;
      if (at + 12 > stsc.end) break;
      stscEntries.push({ firstChunk: uint32(bytes, at), samplesPerChunk: uint32(bytes, at + 4) });
    }
  }

  // stco (32 bit) or co64 (64 bit) chunk offsets.
  const wide = boxType(bytes, stco.start - 4 === -1 ? 0 : stco.start - 4) === "co64";
  const chunkCount = uint32(bytes, stco.start + 4);
  const chunkOffsets: number[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const at = stco.start + 8 + i * (wide ? 8 : 4);
    if (at + (wide ? 8 : 4) > stco.end) break;
    chunkOffsets.push(wide ? uint64(bytes, at) : uint32(bytes, at));
  }

  /** Samples in chunk `index` (1 based), per the stsc change points. */
  const samplesPerChunk = (index: number): number => {
    let value = stscEntries[0]?.samplesPerChunk ?? 1;
    for (const entry of stscEntries) {
      if (index >= entry.firstChunk) value = entry.samplesPerChunk;
      else break;
    }
    return value;
  };

  // Samples are laid out chunk by chunk, and inside a chunk back to back. That
  // last part is what makes a single-chunk chapter list work.
  const samples: { offset: number; size: number }[] = [];
  let sample = 0;
  for (let chunk = 1; chunk <= chunkOffsets.length && sample < sizes.length; chunk += 1) {
    let cursor = chunkOffsets[chunk - 1];
    const inChunk = samplesPerChunk(chunk);
    for (let n = 0; n < inChunk && sample < sizes.length; n += 1) {
      samples.push({ offset: cursor, size: sizes[sample] });
      cursor += sizes[sample];
      sample += 1;
    }
  }

  return { samples, durations };
}

/** A QuickTime text sample: 16 bit length prefix, then UTF-8, then padding. */
function decodeChapterTitle(bytes: Uint8Array): string {
  if (bytes.length >= 2) {
    const declared = uint16(bytes, 0);
    if (declared > 0 && declared <= bytes.length - 2) {
      return new TextDecoder("utf-8").decode(bytes.subarray(2, 2 + declared)).replace(/\0+$/, "").trim();
    }
  }
  return new TextDecoder("utf-8").decode(bytes).replace(/\0+$/, "").trim();
}

interface Track {
  id: number;
  timescale: number;
  handler: string;
  chapterIds: number[];
  range: [number, number];
}

function readTracks(bytes: Uint8Array, moov: Box): Track[] {
  const tracks: Track[] = [];
  for (const trak of boxesWithin(bytes, moov.start, moov.end)) {
    if (trak.type !== "trak") continue;
    const tkhd = firstBox(bytes, trak.start, trak.end, "tkhd");
    const mdhd = followPath(bytes, trak.start, trak.end, ["mdia", "mdhd"]);
    if (!tkhd || !mdhd) continue;
    const tkhdVersion = bytes[tkhd.start];
    const trackId = uint32(bytes, tkhd.start + (tkhdVersion === 0 ? 12 : 20));
    const mdhdVersion = bytes[mdhd.start];
    const timescale = uint32(bytes, mdhd.start + (mdhdVersion === 0 ? 12 : 20)) || 1;

    let handler = "";
    const hdlr = followPath(bytes, trak.start, trak.end, ["mdia", "hdlr"]);
    if (hdlr) handler = boxType(bytes, hdlr.start + 8);

    // tref/chap lists the track ids that carry this track's chapter titles.
    const chapterIds: number[] = [];
    const tref = firstBox(bytes, trak.start, trak.end, "tref");
    if (tref) {
      for (const box of boxesWithin(bytes, tref.start, tref.end)) {
        if (box.type !== "chap") continue;
        for (let at = box.start; at + 4 <= box.end; at += 4) chapterIds.push(uint32(bytes, at));
      }
    }

    tracks.push({ id: trackId, timescale, handler, chapterIds, range: [trak.start, trak.end] });
  }
  return tracks;
}

/** Nero style chapter list: name + start time per chapter. */
export function parseChpl(bytes: Uint8Array, start: number, end: number): Mp4Chapter[] {
  if (end - start < 9) return [];
  const version = bytes[start];
  let at = start + 4;
  let count: number;
  if (version === 1) {
    count = uint32(bytes, at);
    at += 4;
  } else {
    at += 4; // reserved
    count = bytes[at];
    at += 1;
  }
  const chapters: { start: number; title: string }[] = [];
  for (let i = 0; i < count && at < end; i += 1) {
    if (at + 9 > end) break;
    const timestamp = uint64(bytes, at); // 100 nanosecond units
    const length = bytes[at + 8];
    at += 9;
    if (at + length > end) break;
    const title = new TextDecoder("utf-8").decode(bytes.subarray(at, at + length)).replace(/\0+$/, "").trim();
    at += length;
    chapters.push({ start: timestamp / 10_000_000, title });
  }
  return chapters
    .map((chapter, index) => ({
      title: chapter.title || `Chapter ${index + 1}`,
      start: chapter.start,
      end: chapters[index + 1]?.start ?? 0,
    }))
    .map((chapter, index, all) => ({
      ...chapter,
      end: chapter.end || all[index + 1]?.start || chapter.start,
    }));
}

/**
 * Chapters for an MP4 family file (m4b, m4a, mp4, mov).
 *
 * Returns an empty array when the file simply has none - which is the normal
 * case for an mp3, and for an m4b exported without chapters.
 */
export async function readMp4Chapters(reader: BoxReader): Promise<Mp4Chapter[]> {
  const size = await reader.size();
  if (size < 16) return [];

  // Walk the top level to find moov, without loading the media payload.
  let moov: { start: number; end: number } | null = null;
  let position = 0;
  while (position + 8 <= size) {
    const header = await reader.read(position, 16);
    if (header.length < 8) break;
    let boxSize = uint32(header, 0);
    let headerSize = 8;
    if (boxSize === 1) {
      boxSize = uint64(header, 8);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - position;
    }
    if (boxSize < headerSize) break;
    if (boxType(header, 4) === "moov") {
      moov = { start: position + headerSize, end: Math.min(position + boxSize, size) };
      break;
    }
    position += boxSize;
  }
  if (!moov || moov.end - moov.start > MAX_MOOV_BYTES) return [];

  const moovBytes = await reader.read(moov.start, moov.end - moov.start);
  const moovBox: Box = { type: "moov", start: 0, end: moovBytes.length };

  const fromChpl = (() => {
    const udta = firstBox(moovBytes, moovBox.start, moovBox.end, "udta");
    if (!udta) return [] as Mp4Chapter[];
    const chpl = firstBox(moovBytes, udta.start, udta.end, "chpl");
    if (!chpl) return [] as Mp4Chapter[];
    return parseChpl(moovBytes, chpl.start, chpl.end);
  })();

  const tracks = readTracks(moovBytes, moovBox);
  const holder = tracks.find((track) => track.chapterIds.length > 0);
  const chapterTrack = holder ? tracks.find((track) => holder.chapterIds.includes(track.id)) : undefined;

  let fromTrack: Mp4Chapter[] = [];
  if (chapterTrack) {
    const stbl = followPath(moovBytes, chapterTrack.range[0], chapterTrack.range[1], ["mdia", "minf", "stbl"]);
    const table = stbl ? readSampleTable(moovBytes, stbl) : null;
    if (table && table.samples.length > 0) {
      // Sample bytes live in mdat, so they are read from the file as needed.
      const chapters: Mp4Chapter[] = [];
      let elapsed = 0;
      for (let i = 0; i < table.samples.length; i += 1) {
        const sample = table.samples[i];
        // stco/co64 hold absolute file offsets, so the sample bytes are read
        // straight from the file rather than from the moov slice.
        const raw = await reader.read(sample.offset, sample.size);
        const title = decodeChapterTitle(raw);
        const start = elapsed / chapterTrack.timescale;
        elapsed += table.durations[i] ?? 0;
        chapters.push({ title: title || `Chapter ${i + 1}`, start, end: elapsed / chapterTrack.timescale });
      }
      fromTrack = chapters;
    }
  }

  const chapters = fromTrack.length >= fromChpl.length ? fromTrack : fromChpl;
  return chapters.filter((chapter) => Number.isFinite(chapter.start));
}

/** Convenience wrapper: read the chapters of a file on disk. */
export async function readMp4ChaptersFromFile(path: string): Promise<Mp4Chapter[]> {
  const reader = fileReader(path);
  try {
    return await readMp4Chapters(reader);
  } catch {
    return [];
  } finally {
    await reader.close();
  }
}

/** MP4 family extensions whose chapters Amp reads itself. */
export const MP4_EXTENSIONS = ["m4b", "m4a", "mp4", "m4v", "mov", "aax"] as const;

export function isMp4Family(ext: string): boolean {
  return (MP4_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

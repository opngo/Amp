/**
 * File scanning: walks folders, reads metadata with music-metadata and turns
 * the result into the `ScannedFile` shape the shared library logic expects.
 */

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { parseFile } from "music-metadata";
import { AUDIO_EXTENSIONS, type ScannedFile } from "@amp/core";
import { isMp4Family, readMp4ChaptersFromFile } from "./mp4Chapters";

export const MAX_DEPTH = 6;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".Trash",
  "$RECYCLE.BIN",
  "System Volume Information",
  "@eaDir",
]);

export function isAudioPath(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
}

/** Recursively collect audio files, following the folder structure by default. */
export async function walkAudioFiles(
  roots: string[],
  options: { recursive?: boolean; maxDepth?: number } = {},
): Promise<string[]> {
  const { recursive = true, maxDepth = MAX_DEPTH } = options;
  const found: string[] = [];

  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!recursive || depth >= maxDepth || SKIP_DIRS.has(entry.name)) continue;
        await walk(full, depth + 1);
      } else if (entry.isFile() && isAudioPath(entry.name)) {
        found.push(full);
      }
    }
  };

  for (const root of roots) {
    let stat: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      stat = await fs.stat(root);
    } catch {
      continue;
    }
    if (stat.isDirectory()) await walk(root, 0);
    else if (isAudioPath(root)) found.push(root);
  }
  return found;
}

/** Read the metadata we care about for one audio file. */
export async function scanFile(filePath: string, withChapters = true): Promise<ScannedFile> {
  const stat = await fs.stat(filePath);
  const dir = path.dirname(filePath);
  const base: ScannedFile = {
    path: filePath,
    dir,
    name: path.basename(filePath),
    ext: path.extname(filePath).slice(1).toLowerCase(),
    sizeBytes: stat.size,
    mtime: stat.mtimeMs,
  };

  try {
    const metadata = await parseFile(filePath, {
      duration: true,
      includeChapters: withChapters,
      skipCovers: false,
    });
    const common = metadata.common;
    const format = metadata.format;
    const chapters = withChapters ? await readChapters(filePath, base.ext, metadata.format.chapters) : [];
    return {
      ...base,
      duration: format.duration ?? undefined,
      title: common.title,
      artist: common.artist,
      album: common.album,
      albumArtist: common.albumartist,
      narrator: (common as { narrator?: string }).narrator,
      genre: common.genre,
      year: common.year,
      trackNumber: common.track?.no ?? undefined,
      discNumber: common.disk?.no ?? undefined,
      description: common.comment?.[0]?.text,
      chapters,
      hasCover: Boolean(common.picture?.length),
      codec: format.codec ?? undefined,
      bitrate: format.bitrate ?? undefined,
    };
  } catch {
    // Unreadable tags (rare) still give us a usable file entry.
    return base;
  }
}

/**
 * Chapters for a file.
 *
 * MP4 family files (m4b above all) are read with Amp's own MP4 reader, because
 * the library's MP4 chapter support misses whole chapter lists: it only looks
 * once the `mdat` box is reached, and it assumes one chapter per chunk. For
 * every other format the library's own result is used, since it handles ID3
 * chapter frames properly.
 */
async function readChapters(
  filePath: string,
  ext: string,
  fromLibrary: { title?: string; start: number; end?: number }[] | undefined,
): Promise<ScannedFile["chapters"]> {
  const library = (fromLibrary ?? []).map((chapter, index) => ({
    title: chapter.title ?? `Chapter ${index + 1}`,
    start: chapter.start,
    duration: chapter.end ? Math.max(0, chapter.end - chapter.start) : 0,
    id: index,
  }));

  if (!isMp4Family(ext)) return library;

  const own = await readMp4ChaptersFromFile(filePath);
  if (own.length === 0) return library;
  if (own.length < library.length) return library;
  return own.map((chapter, index) => ({
    title: chapter.title,
    start: chapter.start,
    duration: Math.max(0, chapter.end - chapter.start),
    id: index,
  }));
}

/** Cover bytes for one file, or null. */
export async function readCover(filePath: string): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const metadata = await parseFile(filePath);
    const picture = metadata.common.picture?.[0];
    if (!picture) return null;
    return { data: Buffer.from(picture.data), mime: picture.format || "image/jpeg" };
  } catch {
    return null;
  }
}

/** Aggregate duration/metadata for a folder of tracks without a full library scan. */
export async function peekFolder(dir: string): Promise<{ files: number; duration: number }> {
  const files = await walkAudioFiles([dir], { maxDepth: 1 });
  let duration = 0;
  for (const file of files.slice(0, 50)) {
    const scanned = await scanFile(file, false);
    duration += scanned.duration ?? 0;
  }
  return { files: files.length, duration };
}

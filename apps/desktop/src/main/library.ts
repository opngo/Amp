/**
 * Library service for the main process.
 *
 * The renderer owns the library state (it is the only place with UI context),
 * but importing, rescanning, cover extraction and the disk statistics all need
 * the filesystem, so they live here and return plain data.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  AUDIO_EXTENSIONS,
  bookFiles,
  bookSizeBytes,
  groupFilesIntoBooks,
  type Book,
  type ImportResult,
  type LibraryState,
  type ScannedFile,
  type Settings,
} from "@amp/core";
import { paths, saveLibrary, logLine, libraryStore } from "./store";
import { peekFolder, scanFile, walkAudioFiles } from "./scan";
import { extractCover } from "./covers";

export interface ImportOptions {
  groupFolders?: boolean;
  folderId?: string | null;
  chapterRules?: Settings["library"]["chapterRules"];
  existing?: Book[];
}

/**
 * Turn a set of picked files/folders into books. Choosing a folder with many
 * mp3 files can either produce one book with many chapters (groupFolders) or
 * one book per file - both are first-class, per the library rules.
 */
export async function importPaths(
  inputPaths: string[],
  options: ImportOptions & { settings?: Settings } = {},
): Promise<ImportResult> {
  const started = Date.now();
  const filePaths = await walkAudioFiles(inputPaths, { recursive: true });
  const scanned: ScannedFile[] = [];
  const errors: string[] = [];

  for (const filePath of filePaths) {
    try {
      scanned.push(await scanFile(filePath, true));
    } catch (error) {
      errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : "unreadable"}`);
    }
  }

  const books = groupFilesIntoBooks(scanned, {
    groupFolders: options.groupFolders ?? true,
    chapterRules: options.chapterRules ?? options.settings?.library.chapterRules ?? [],
    existing: options.existing ?? [],
  });

  if (options.folderId) {
    for (const book of books) {
      if (book.folderId == null) book.folderId = options.folderId;
    }
  }

  /*
   * The cover is the artwork the file already carries.
   *
   * An m4b with an embedded picture is the normal case, and the picture is the
   * right default: a shelf of books that all show their real covers looks like
   * a library, where a shelf of generated placeholders looks like a spreadsheet.
   * The extraction is awaited - it is one small read per file - so the books
   * arrive in the interface with their covers already on, instead of filling in
   * a few seconds later (or not at all, which is what used to happen: the
   * result was thrown away).
   */
  const withoutCover = books.filter((book) => !book.coverPath).slice(0, 120);
  let extracted = 0;
  for (const book of withoutCover) {
    try {
      const cover = await extractCover(book);
      if (cover) {
        book.coverPath = cover.path;
        extracted += 1;
      }
    } catch {
      /* no picture in the file, or it could not be read: the placeholder art stays */
    }
  }
  if (extracted > 0) await logLine(`library: embedded covers for ${extracted} of ${books.length} book(s)`);

  const existingPaths = new Set((options.existing ?? []).map((book) => book.sourcePath));
  const added = books.filter((book) => !existingPaths.has(book.sourcePath)).length;
  const updated = books.length - added;

  await logLine(
    `library: imported ${books.length} book(s) from ${inputPaths.length} path(s) in ${Date.now() - started}ms`,
  );

  return { added, updated, skipped: filePaths.length - scanned.length, books, errors };
}

/** Re-read every known book from disk, picking up new files in known folders. */
export async function rescanLibrary(state: LibraryState, settings: Settings): Promise<ImportResult> {
  const roots = new Set<string>();
  for (const book of state.books) {
    const source = book.sourcePath;
    if (!source) continue;
    try {
      const stat = await fs.stat(source);
      roots.add(stat.isDirectory() ? source : path.dirname(source));
    } catch {
      /* missing file: left in the library so the user can see it */
    }
  }
  if (roots.size === 0) {
    return { added: 0, updated: 0, skipped: 0, books: [], errors: ["Nothing to rescan yet"] };
  }
  return importPaths([...roots], {
    groupFolders: settings.library.groupFolders,
    chapterRules: settings.library.chapterRules,
    existing: state.books,
    settings,
  });
}

export interface DiskStats {
  diskBytes: number;
  dataDir: string;
  books: number;
  missing: number;
  covers: number;
  transcripts: number;
  /** Bytes used by Amp's own cached artwork and transcripts. */
  dataBytes: number;
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await directorySize(full);
      else {
        try {
          total += (await fs.stat(full)).size;
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* directory missing */
  }
  return total;
}

export async function libraryStats(state: LibraryState): Promise<DiskStats> {
  let diskBytes = 0;
  let missing = 0;
  for (const book of state.books) {
    diskBytes += bookSizeBytes(book);
    for (const file of bookFiles(book)) {
      try {
        await fs.access(file);
      } catch {
        missing += 1;
      }
    }
  }
  const [covers, transcripts, dataBytes] = await Promise.all([
    fs.readdir(paths.covers()).then((files) => files.length).catch(() => 0),
    fs.readdir(paths.transcripts()).then((files) => files.length).catch(() => 0),
    directorySize(paths.covers()),
  ]);
  return {
    diskBytes,
    dataDir: libraryStore.dir,
    books: state.books.length,
    missing,
    covers,
    transcripts,
    dataBytes,
  };
}

/** Where a finished download should be imported from. */
export async function folderSummary(dir: string): Promise<{ files: number; duration: number }> {
  return peekFolder(dir);
}

export async function ensureReadable(files: string[]): Promise<{ ok: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const file of files) {
    try {
      await fs.access(file);
    } catch {
      missing.push(file);
    }
  }
  return { ok: missing.length === 0, missing };
}

export function supportedExtensions(): readonly string[] {
  return AUDIO_EXTENSIONS;
}

export async function saveLibraryState(state: LibraryState): Promise<void> {
  await saveLibrary(state);
}

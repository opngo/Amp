/**
 * Cover art: extraction from the audio file, saving user picked images and
 * looking up square artwork online (Open Library + Google Books).
 */

import { app, net } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { bookFiles, type Book, type CoverCandidate } from "@amp/core";
import { paths } from "./store";
import { logLine } from "./store";
import { readCover } from "./scan";

const MAX_COVER_BYTES = 12 * 1024 * 1024;

export function coverFilePath(bookId: string, ext = "jpg"): string {
  return path.join(paths.covers(), `${bookId}.${ext}`);
}

async function ensureCoverDir(): Promise<void> {
  await fs.mkdir(paths.covers(), { recursive: true });
}

/** Hash covers so identical artwork across a series shares one file. */
function hashBytes(data: Buffer): string {
  return createHash("sha1").update(data).digest("hex").slice(0, 12);
}

export async function saveCoverBytes(bookId: string, data: Buffer, mime = "image/jpeg"): Promise<string> {
  await ensureCoverDir();
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const target = coverFilePath(bookId, ext);
  await fs.writeFile(target, data);
  return target;
}

/** Pull the embedded picture out of the book's first audio file. */
export async function extractCover(book: Book): Promise<{ path: string; mime: string } | null> {
  const candidates = bookFiles(book);
  for (const file of candidates) {
    if (!file) continue;
    const cover = await readCover(file);
    if (cover) {
      const saved = await saveCoverBytes(book.id, cover.data, cover.mime);
      await logLine(`cover: extracted from ${path.basename(file)} (${hashBytes(cover.data)})`);
      return { path: saved, mime: cover.mime };
    }
  }
  return null;
}

export async function removeCover(bookId: string): Promise<void> {
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    try {
      await fs.unlink(coverFilePath(bookId, ext));
    } catch {
      /* not present */
    }
  }
}

/** Accept a local image the user picked, normalising the stored file name. */
export async function saveCoverFromFile(bookId: string, sourcePath: string): Promise<string> {
  const data = await fs.readFile(sourcePath);
  if (data.byteLength > MAX_COVER_BYTES) throw new Error("Cover image is larger than 12 MB");
  const ext = path.extname(sourcePath).slice(1).toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return saveCoverBytes(bookId, data, mime);
}

async function download(url: string): Promise<Buffer> {
  const response = await net.fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Cover download failed with ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_COVER_BYTES) throw new Error("Cover image is larger than 12 MB");
  return buffer;
}

/** Save a cover the renderer produced (data URL, e.g. from a canvas crop). */
export async function saveCoverFromDataUrl(bookId: string, dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!match) throw new Error("Cover data URL is not a base64 image");
  const data = Buffer.from(match[2], "base64");
  if (data.byteLength > MAX_COVER_BYTES) throw new Error("Cover image is larger than 12 MB");
  return saveCoverBytes(bookId, data, match[1]);
}

export async function saveCoverFromUrl(bookId: string, url: string): Promise<string> {
  const data = await download(url);
  const mime = url.toLowerCase().includes(".png") ? "image/png" : "image/jpeg";
  return saveCoverBytes(bookId, data, mime);
}

function toCandidate(input: {
  url: string;
  thumbnail: string;
  title: string;
  author?: string;
  year?: number;
  source: string;
}): CoverCandidate {
  return {
    id: `${input.source}:${input.url}`,
    title: input.title,
    author: input.author,
    thumbnail: input.thumbnail,
    full: input.url,
    source: input.source,
  };
}

interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  isbn?: string[];
  key?: string;
}

async function openLibrary(query: string, limit: number): Promise<CoverCandidate[]> {
  const url =
    "https://openlibrary.org/search.json?fields=title,author_name,cover_i,first_publish_year,isbn,key" +
    `&limit=${limit}&q=${encodeURIComponent(query)}`;
  const response = await net.fetch(url);
  if (!response.ok) return [];
  const payload = (await response.json()) as { docs?: OpenLibraryDoc[] };
  return (payload.docs ?? [])
    .filter((doc) => typeof doc.cover_i === "number")
    .map((doc) =>
      toCandidate({
        url: `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`,
        thumbnail: `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`,
        title: doc.title ?? query,
        author: doc.author_name?.[0],
        year: doc.first_publish_year,
        source: "openlibrary",
      }),
    );
}

interface GoogleVolume {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

async function googleBooks(query: string, limit: number): Promise<CoverCandidate[]> {
  const url = `https://www.googleapis.com/books/v1/volumes?maxResults=${limit}&q=${encodeURIComponent(query)}`;
  const response = await net.fetch(url);
  if (!response.ok) return [];
  const payload = (await response.json()) as { items?: GoogleVolume[] };
  return (payload.items ?? [])
    .map((item) => item.volumeInfo)
    .filter((info): info is NonNullable<GoogleVolume["volumeInfo"]> => Boolean(info?.imageLinks?.thumbnail))
    .map((info) => {
      const thumb = info.imageLinks?.thumbnail ?? "";
      return toCandidate({
        url: thumb.replace("http://", "https://").replace("&zoom=1", "&zoom=0"),
        thumbnail: thumb.replace("http://", "https://"),
        title: info.title ?? query,
        author: info.authors?.[0],
        year: info.publishedDate ? Number(info.publishedDate.slice(0, 4)) : undefined,
        source: "google",
      });
    });
}

/**
 * Search several providers and merge the results. Provider failures are
 * ignored: a cover search that returns three results is better than an error.
 */
export async function searchCovers(
  query: string,
  options: { title?: string; author?: string; limit?: number } = {},
): Promise<CoverCandidate[]> {
  const { title, author, limit = 12 } = options;
  const base = title ?? query;
  const withAuthor = author ? `${base} ${author}` : base;
  const queries = [withAuthor, base, query].filter(Boolean);
  const [open, google] = await Promise.all([
    openLibrary(queries[0], limit).catch(() => [] as CoverCandidate[]),
    googleBooks(queries[0], limit).catch(() => [] as CoverCandidate[]),
  ]);
  let results = [...open, ...google];
  if (results.length === 0) {
    const retry = await Promise.all([
      openLibrary(queries[1] ?? base, limit).catch(() => [] as CoverCandidate[]),
      googleBooks(queries[1] ?? base, limit).catch(() => [] as CoverCandidate[]),
    ]);
    results = [...retry[0], ...retry[1]];
  }
  const seen = new Set<string>();
  return results
    .filter((candidate) => {
      if (seen.has(candidate.full)) return false;
      seen.add(candidate.full);
      return true;
    })
    .sort((a, b) => {
      const score = (candidate: CoverCandidate): number => {
        let value = 0;
        if (candidate.title?.toLowerCase().includes(base.toLowerCase())) value += 3;
        if (author && candidate.author?.toLowerCase().includes(author.toLowerCase())) value += 2;
        return value;
      };
      return score(b) - score(a);
    })
    .slice(0, limit);
}

export function coverSearchUrl(title: string, author?: string): string {
  return `https://openlibrary.org/search?q=${encodeURIComponent(author ? `${title} ${author}` : title)}`;
}

export function defaultCoverDir(): string {
  return path.join(app.getPath("pictures"), "Amp covers");
}

/**
 * Torrent acquisition helpers: magnet parsing, title parsing, quality scoring
 * and the tiny scraper that the Electron main process and the TUI both use to
 * talk to public audiobook indexers (audiobookbay and friends).
 *
 * Nothing here performs network calls by itself - callers pass an already
 * fetched HTML/JSON payload, which keeps the module pure and testable.
 */

import type { TorrentResult, QBittorrentConfig } from "./types";

/* --------------------------------------------------------------------------
 * Magnets & hashes
 * ------------------------------------------------------------------------ */

export interface MagnetInfo {
  infoHash: string;
  displayName: string;
  trackers: string[];
  size?: number;
}

export function parseMagnet(uri: string): MagnetInfo | null {
  if (!uri.startsWith("magnet:")) return null;
  const query = uri.slice("magnet:?".length);
  const params = new URLSearchParams(query);
  const xt = params.get("xt") ?? "";
  const match = xt.match(/urn:btih:([a-zA-Z0-9]+)/);
  if (!match) return null;
  const hash = match[1];
  return {
    infoHash: /^[a-fA-F0-9]{40}$/.test(hash) ? hash.toLowerCase() : hash,
    displayName: params.get("dn") ?? "",
    trackers: params.getAll("tr"),
    size: params.has("xl") ? Number(params.get("xl")) : undefined,
  };
}

export function buildMagnet(
  infoHash: string,
  displayName: string,
  trackers: string[] = DEFAULT_TRACKERS,
): string {
  const params = new URLSearchParams();
  params.set("xt", `urn:btih:${infoHash}`);
  if (displayName) params.set("dn", displayName);
  for (const tracker of trackers) params.append("tr", tracker);
  return `magnet:?${params.toString()}`;
}

export const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://open.stealth.si:80/announce",
];

/** Deterministic id for a search result so the UI can key lists. */
export function resultId(result: Pick<TorrentResult, "source" | "title" | "infoHash" | "url">): string {
  const seed = result.infoHash ?? result.url ?? result.title;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${result.source}:${(hash >>> 0).toString(36)}`;
}

/* --------------------------------------------------------------------------
 * Title parsing
 * ------------------------------------------------------------------------ */

export interface ParsedTitle {
  title: string;
  author?: string;
  narrator?: string;
  year?: number;
  format: "m4b" | "mp3" | "m4a" | "flac" | "unknown";
  bitrate?: string;
  abridged?: boolean;
  series?: string;
  seriesIndex?: number;
  quality: number;
}

const FORMAT_RE = /\b(m4b|mp3|m4a|flac|opus|aac|ogg|wav)\b/i;
const BITRATE_RE = /\b(\d{2,4})\s?(kbps|kbit)\b/i;
const YEAR_RE = /\((\d{4})\)|\b(19\d{2}|20\d{2})\b/;
const NARRATOR_RE = /\b(?:narrated by|narrator[:\s]+|read by)\s*([^,|()[\]{}]+)/i;
const ABRIDGED_RE = /\b(abridged|unabridged)\b/i;
const SERIES_RE = /\b(?:book|vol\.?|volume)\s*(\d{1,3})\b/i;

/**
 * Torrent titles are messy: "Author - Title (2019) [M4B 64kbps] Narrated by X".
 * We pull out everything we can and score the release for sorting.
 */
export function parseTitle(raw: string): ParsedTitle {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const formatMatch = cleaned.match(FORMAT_RE);
  const format = (formatMatch?.[1]?.toLowerCase() ?? "unknown") as ParsedTitle["format"];
  const bitrateMatch = cleaned.match(BITRATE_RE);
  const yearMatch = cleaned.match(YEAR_RE);
  const narratorMatch = cleaned.match(NARRATOR_RE);
  const abridgedMatch = cleaned.match(ABRIDGED_RE);
  const seriesMatch = cleaned.match(SERIES_RE);

  let title = cleaned
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(FORMAT_RE, " ")
    .replace(BITRATE_RE, " ")
    .replace(/narrated by .*$/i, " ")
    .replace(/\b(un)?abridged\b/i, " ")
    .replace(/\s+/g, " ")
    .trim();

  let author: string | undefined;
  const dashSplit = title.split(/\s+[-–—]\s+/);
  if (dashSplit.length >= 2) {
    author = dashSplit[0].trim();
    title = dashSplit.slice(1).join(" - ").trim();
  }
  // "Title by Author" is also common.
  if (!author) {
    const byMatch = title.match(/^(.*?)\s+by\s+([^,]+)$/i);
    if (byMatch) {
      title = byMatch[1].trim();
      author = byMatch[2].trim();
    }
  }

  const bitrateKbps = bitrateMatch ? Number(bitrateMatch[1]) : undefined;
  const quality =
    (format === "m4b" ? 40 : format === "m4a" ? 34 : format === "mp3" ? 26 : format === "flac" ? 30 : 10) +
    (bitrateKbps ? Math.min(24, Math.round(bitrateKbps / 8)) : 8) +
    (abridgedMatch?.[1]?.toLowerCase() === "unabridged" ? 8 : 0) +
    (yearMatch ? 3 : 0);

  return {
    title: title || cleaned,
    author,
    narrator: narratorMatch?.[1]?.trim(),
    year: yearMatch ? Number(yearMatch[1] ?? yearMatch[2]) : undefined,
    format,
    bitrate: bitrateKbps ? `${bitrateKbps} kbps` : undefined,
    abridged: abridgedMatch ? abridgedMatch[1].toLowerCase() === "abridged" : undefined,
    series: seriesMatch ? undefined : undefined,
    seriesIndex: seriesMatch ? Number(seriesMatch[1]) : undefined,
    quality,
  };
}

export function scoreResult(result: TorrentResult): number {
  const parsed = result.parsed ? { ...result.parsed, quality: 0 } : parseTitle(result.title);
  const seeders = result.seeders ?? 0;
  const sizeGb = (result.size ?? 0) / 1024 ** 3;
  const parsedQuality = parseTitle(result.title).quality;
  const seederScore = Math.log10(seeders + 1) * 14;
  const sizeScore = sizeGb > 0.2 && sizeGb < 3 ? 12 : sizeGb >= 3 ? 4 : -6;
  void parsed;
  return seeders * 0.4 + seederScore + sizeScore + parsedQuality;
}

export function sortResults(
  results: TorrentResult[],
  by: "relevance" | "seeders" | "size" | "date" = "relevance",
): TorrentResult[] {
  const list = [...results];
  if (by === "seeders") return list.sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0));
  if (by === "size") return list.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
  if (by === "date") return list.sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
  return list.sort((a, b) => scoreResult(b) - scoreResult(a));
}

/* --------------------------------------------------------------------------
 * Scraping: audiobookbay-style listing pages
 * ------------------------------------------------------------------------ */

const stripTags = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A size token, tolerating markup between the number and its unit.
 *
 * The live site splits them across elements: `File Size:` then
 * `<span style='color:#00f;'>72.25</span> MBs`. The colour inside that span even
 * holds digits, so a "skip anything that is not a digit" style pattern cannot
 * reach the value at all - the markup has to go first.
 *
 * The lookbehind keeps format tags like "M4B" out of the results: a digit that
 * runs straight into a word is part of a name, not a size.
 */
const SIZE_TOKEN = /(?<![\w.,])(\d[\d.,]*)\s*([KMGT]?)\s*B(?:ytes?|s)?(?![a-z])/i;

export interface ParsedSize {
  sizeText: string;
  size: number;
}

/** Normalised "72.25 MB" from a regex match of {@link SIZE_TOKEN}. */
function sizeFromMatch(match: RegExpMatchArray): ParsedSize | null {
  const sizeText = `${match[1]} ${(match[2] ?? "").toUpperCase()}B`.replace(/\s+/g, " ").trim();
  const size = parseSizeToBytes(sizeText);
  return size ? { sizeText, size } : null;
}

/**
 * Read a byte size that follows a label such as "File Size:" or
 * "Combined File Size:". Falls back to the first size token in the block, which
 * is what cards without a label need - bitrates ("96 Kbps") are skipped because
 * the unit must end the token.
 */
export function sizeAfterLabel(source: string, label: string): ParsedSize | null {
  const labelMatch = new RegExp(`${label}\\s*:?`, "i").exec(source);
  const windows: string[] = [];
  if (labelMatch) {
    const from = labelMatch.index + labelMatch[0].length;
    windows.push(source.slice(from, from + 240));
  }
  windows.push(source);
  for (const window of windows) {
    const match = stripTags(window).match(SIZE_TOKEN);
    const parsed = match ? sizeFromMatch(match) : null;
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Parse an audiobookbay search results page ("div.post" blocks with an info
 * hash `<a href="magnet:?xt=...">` and a detail link).
 */
export function parseABBSearch(html: string, baseUrl = "https://audiobookbay.lu"): TorrentResult[] {
  const results: TorrentResult[] = [];
  // Split on post *cards* only: class="post" matches, class="post-content"
  // does not, which keeps inner markup from becoming a second "result".
  const blocks = html.split(/<div[^>]+class="[^"]*(?<![\w-])post(?![\w-])[^"]*"/i).slice(1);
  for (const block of blocks) {
    const titleMatch =
      block.match(/<div[^>]+class="[^"]*postTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ??
      block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleMatch ? stripTags(titleMatch[1]) : "";
    const magnetMatch = block.match(/href="(magnet:\?[^"]+)"/i) ?? block.match(/(magnet:\?xt=[^\s"'<]+)/i);
    const hashMatch = block.match(/urn:btih:([a-fA-F0-9]{32,40})/);
    const detailMatch = block.match(/href="(https?:\/\/[^"]*\/[^"']*\/[^"']+\/?)"/i);
    const size = sizeAfterLabel(block, "File Size");
    const coverMatch = block.match(/<img[^>]+src="([^"]+)"/i);
    const postedMatch = block.match(/(\d{1,2}\s+\w+\s+\d{4})/);
    if (!title) continue;
    const infoHash = magnetMatch ? parseMagnet(magnetMatch[1])?.infoHash : hashMatch?.[1];
    const parsed = parseTitle(title);
    results.push({
      id: resultId({ source: "audiobookbay", title, infoHash, url: detailMatch?.[1] }),
      source: "audiobookbay",
      title,
      infoHash,
      magnet: magnetMatch?.[1] ?? (infoHash ? buildMagnet(infoHash, title) : undefined),
      url: detailMatch?.[1] ?? `${baseUrl}/?s=${encodeURIComponent(parsed.title)}`,
      sizeText: size?.sizeText,
      size: size?.size,
      coverUrl: coverMatch?.[1]?.startsWith("http")
        ? coverMatch[1]
        : coverMatch
          ? `${baseUrl}${coverMatch[1]}`
          : undefined,
      postedAt: postedMatch ? Date.parse(postedMatch[1]) : undefined,
      parsed: {
        author: parsed.author,
        narrator: parsed.narrator,
        year: parsed.year,
        bitrate: parsed.bitrate,
        format: parsed.format,
      },
    });
  }
  return results;
}

/** Parse a detour/redirect page that hides the magnet behind a meta refresh or JS. */
export function parseMagnetFromDetail(html: string): string | null {
  const direct = html.match(/magnet:\?xt=[^"'<\s]+/i);
  if (direct) return direct[0];
  const hashOnly = html.match(/urn:btih:([a-fA-F0-9]{32,40})/);
  if (hashOnly) {
    const name = stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    return buildMagnet(hashOnly[1], name);
  }
  const encoded = html.match(/magnet%3A%3F[^"'<\s]+/i);
  if (encoded) return decodeURIComponent(encoded[0]);
  return null;
}

export function parseSizeToBytes(text: string): number | undefined {
  const match = text.match(/(\d+(?:\.\d+)?)\s?(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2].toUpperCase().replace(/IB$/, "B");
  const power = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4 }[unit as "B" | "KB" | "MB" | "GB" | "TB"] ?? 0;
  return Math.round(value * 1024 ** power);
}

/** Build the search URL for a supported source. */
export function searchUrl(source: string, query: string): string {
  const q = encodeURIComponent(query.trim());
  switch (source) {
    case "audiobookbay":
      return `https://audiobookbay.lu/?s=${q}`;
    case "audiobookbay-alt":
      return `https://audiobookbay.is/?s=${q}`;
    case "tokybook":
      return `https://tokybook.com/?s=${q}`;
    case "goldenaudiobooks":
      return `https://goldenaudiobooks.com/?s=${q}`;
    default:
      return q;
  }
}

/* --------------------------------------------------------------------------
 * qBittorrent Web API
 * ------------------------------------------------------------------------ */

export interface QBRequest {
  method: "GET" | "POST";
  path: string;
  body?: Record<string, string | string[] | number | boolean>;
  /** multipart/form-data fields (needed for /torrents/add and /api/v2/torrents/add). */
  form?: Record<string, string>;
}

/** qBittorrent 5.x moved the API under /api/v2, older builds expose /query. */
export function qbBaseUrl(config: Pick<QBittorrentConfig, "url">): string {
  const url = config.url.replace(/\/+$/, "");
  return url;
}

export function qbLoginRequest(config: QBittorrentConfig): QBRequest {
  return {
    method: "POST",
    path: "/api/v2/auth/login",
    body: { username: config.username, password: config.password },
  };
}

export function qbAddMagnetRequest(config: QBittorrentConfig, magnet: string, name?: string): QBRequest {
  const form: Record<string, string> = {
    urls: magnet,
    category: config.category || "amp-audiobooks",
    paused: "false",
    sequentialDownload: config.sequential ? "true" : "false",
    firstLastPiecePrio: config.sequential ? "true" : "false",
  };
  if (config.savePath) form.savepath = config.savePath;
  if (name) form.rename = name;
  return { method: "POST", path: "/api/v2/torrents/add", form };
}

export function qbAddFileRequest(config: QBittorrentConfig, filename: string): QBRequest {
  const form: Record<string, string> = {
    filename,
    category: config.category || "amp-audiobooks",
    paused: "false",
  };
  if (config.savePath) form.savepath = config.savePath;
  return { method: "POST", path: "/api/v2/torrents/add", form };
}

export function qbListRequest(hash?: string): QBRequest {
  return { method: "GET", path: hash ? `/api/v2/torrents/info?hashes=${hash}` : "/api/v2/torrents/info" };
}

/** Normalise a qBittorrent /torrents/info payload into our DownloadItem. */
export function normalizeQbTorrent(raw: Record<string, unknown>): {
  hash: string;
  name: string;
  state: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  eta: number;
  size: number;
  downloaded: number;
  savePath: string;
} {
  const num = (key: string) => Number(raw[key] ?? 0);
  return {
    hash: String(raw.hash ?? ""),
    name: String(raw.name ?? "Unknown"),
    state: String(raw.state ?? "unknown"),
    progress: num("progress"),
    downloadSpeed: num("dlspeed"),
    uploadSpeed: num("upspeed"),
    eta: num("eta"),
    size: num("size"),
    downloaded: num("downloaded"),
    savePath: String(raw.savepath ?? raw.save_path ?? ""),
  };
}

/**
 * Where a file inside a torrent actually is on disk.
 *
 * qBittorrent describes a torrent twice: `save_path` is the folder it downloads
 * into, `content_path` is the thing on disk - the file itself for a
 * single-file torrent, the outermost folder for a multi-file one - and the
 * `name` of each entry in `/torrents/files` is the path inside the torrent,
 * which normally repeats that outermost folder.
 *
 * Joining the wrong pair of those is how a finished download that is plainly
 * sitting on disk gets reported as "not readable", which then reads in the
 * interface as "imported 0 books". There is no single correct join, so this
 * returns every plausible path in the order worth trying, and the caller keeps
 * the first one that exists.
 */
export function torrentFilePathCandidates(entry: {
  name: string;
  savePath?: string;
  contentPath?: string;
}): string[] {
  const name = entry.name.replace(/^[\\/]+/, "");
  const file = baseName(name);
  const savePath = (entry.savePath ?? "").replace(/[\\/]+$/, "");
  const contentPath = (entry.contentPath ?? "").replace(/[\\/]+$/, "");
  const out: string[] = [];
  const push = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  // The common cases first: the file named relative to the save folder, and the
  // file named relative to the torrent's own root.
  push(joinPath(savePath, name));
  push(joinPath(contentPath, name));
  push(joinPath(contentPath, file));
  push(joinPath(savePath, file));
  // A single-file torrent: `content_path` is the file, not a folder.
  if (contentPath && baseName(contentPath) === file) push(contentPath);
  return out.filter(Boolean);
}

/** Path join that keeps whichever separator the base path already used. */
function joinPath(base: string, part: string): string {
  if (!base) return part;
  if (!part) return base;
  const separator = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${separator}${part.replace(/^[\\/]+/, "")}`;
}

/** Last segment of a path, on either kind of separator. */
export function baseName(value: string): string {
  const parts = value.split(/[\\/]/);
  return parts[parts.length - 1] || value;
}

export function isTorrentFinished(state: string): boolean {
  return ["uploading", "stalledUP", "pausedUP", "queuedUP", "forcedUP", "completed"].includes(state);
}

export function isTorrentActive(state: string): boolean {
  return ["downloading", "stalledDL", "metaDL", "forcedDL", "queuedDL", "checkingDL", "allocating"].includes(
    state,
  );
}

export function humanState(state: string): string {
  const map: Record<string, string> = {
    downloading: "Downloading",
    stalledDL: "Stalled",
    metaDL: "Fetching metadata",
    forcedDL: "Downloading",
    queuedDL: "Queued",
    checkingDL: "Checking",
    allocating: "Allocating",
    uploading: "Seeding",
    stalledUP: "Seeding",
    pausedUP: "Finished",
    pausedDL: "Paused",
    queuedUP: "Queued",
    forcedUP: "Seeding",
    error: "Error",
    missingFiles: "Missing files",
    unknown: "Unknown",
  };
  return map[state] ?? state;
}

/** Which of the downloaded files should be imported as the book? */
export function pickAudiobookFiles(fileNames: string[]): string[] {
  const audio = fileNames.filter((name) => /\.(m4b|m4a|mp3|mp4|flac|ogg|opus|aac)$/i.test(name));
  const m4b = audio.filter((n) => /\.m4b$/i.test(n));
  return m4b.length > 0 ? m4b : audio;
}

/**
 * AudioBookBay (audiobookbay.lu) parsing, on top of the shared scraper in
 * @amp/core.
 *
 * The search page is handled by core's `parseABBSearch` (same code the web
 * build, the TUI and the Python client use). What only the desktop app needs -
 * the torrent table on a detail page: trackers, file list, combined size -
 * lives here. No Electron imports, so it is unit testable.
 */

import {
  buildMagnet,
  parseABBSearch,
  parseMagnet,
  parseSizeToBytes,
  scoreResult,
  sizeAfterLabel,
  type TorrentResult,
} from "@amp/core";

export interface AbbFile {
  name: string;
  sizeBytes: number;
}

export interface AbbDetail {
  /** Ready to hand to the download queue. */
  result: TorrentResult;
  pageTitle: string;
  title?: string;
  author?: string;
  narrator?: string;
  format?: string;
  bitrate?: string;
  abridged?: string;
  infoHash?: string;
  trackers: string[];
  magnet?: string;
  torrentUrl?: string;
  directUrl?: string;
  coverUrl?: string;
  synopsis?: string;
  files: AbbFile[];
  totalBytes: number;
  fileCount: number;
  /** "Multifile" vs single file, straight from the page. */
  multifile: boolean;
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Values sit in table cells and bold tags, so a label can be followed by
 * markup. Walk a few tags at most, which keeps one label from swallowing a
 * later one.
 */
function afterLabel(source: string, label: string, value: RegExp, tags = 6): string | undefined {
  const pattern = new RegExp(`${label}\\s*:(?:\\s|</?[\\w!-][^>]*>){0,${tags}}${value.source}`, "i");
  const match = source.match(pattern);
  if (!match?.[1]) return undefined;
  return stripTags(match[1])
    .replace(/[\s/|,;:-]+$/, "")
    .trim();
}

const TEXT_VALUE = /([^<\n]{1,80})/;

/**
 * Card metadata (format, bitrate, category, language) sits outside the fields
 * the shared scraper reads, so it is collected per card and merged in by title.
 */
function cardMetadata(html: string): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  // Same card split as @amp/core: class="post" only, not "post-content".
  const blocks = html.split(/<div[^>]+class="[^"]*(?<![\w-])post(?![\w-])[^"]*"/i).slice(1);
  for (const block of blocks) {
    const title = stripTags((block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) ?? [])[1] ?? "");
    if (!title) continue;
    const meta: Record<string, string> = {};
    const category = afterLabel(block, "Category", TEXT_VALUE);
    const language = afterLabel(block, "Language", TEXT_VALUE);
    const keywords = afterLabel(block, "Keywords", /([^<]{0,200})/);
    const format = afterLabel(block, "Format", TEXT_VALUE);
    const bitrate = afterLabel(block, "Bitrate", TEXT_VALUE);
    const posted = afterLabel(block, "Posted", TEXT_VALUE);
    if (category) meta.category = category;
    if (language) meta.language = language;
    if (keywords) meta.keywords = keywords;
    if (format) meta.format = format;
    if (bitrate) meta.bitrate = bitrate;
    if (posted) meta.posted = posted;
    map.set(title, meta);
  }
  return map;
}

/** Search results, enriched with the card metadata and labelled for the UI. */
export function parseSearch(html: string, base = "https://audiobookbay.lu"): TorrentResult[] {
  const results = parseABBSearch(html, base);
  const meta = cardMetadata(html);
  return results.map((result) => {
    const card = meta.get(result.title);
    return {
      ...result,
      category: card?.category ?? result.category,
      // Keep the detail page when core guessed the search URL instead.
      url: result.url && /\/abss\//i.test(result.url) ? result.url : detailUrlFor(html, result.title, base),
      description: card?.keywords,
      parsed: {
        ...result.parsed,
        format: card?.format ?? result.parsed?.format,
        bitrate: card?.bitrate ?? result.parsed?.bitrate,
      },
    };
  });
}

function detailUrlFor(html: string, title: string, base: string): string {
  const slug = stripTags(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  const found = html.match(new RegExp(`href="([^"]*${slug.slice(0, 24)}[^"]*)"`, "i"));
  return found ? absolute(found[1], base) : `${base}/?s=${encodeURIComponent(title)}`;
}

function absolute(url: string, base: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  if (/^https?:/i.test(url)) return url;
  return `${base.replace(/\/+$/, "")}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Rank results for a query: exact titles first, giant bundles last. */
export function rankResults(results: TorrentResult[], query: string): TorrentResult[] {
  const needle = query.toLowerCase().trim();
  const words = needle.split(/\s+/).filter((word) => word.length > 2);
  const bonus = (result: TorrentResult): number => {
    const title = result.title.toLowerCase();
    let value = 0;
    if (title.includes(needle)) value += 60;
    for (const word of words) if (title.includes(word)) value += 12;
    if (/collection|complete|bundle|\d+\s*audiobooks|various/i.test(title)) value -= 40;
    if ((result.size ?? 0) > 4 * 1024 ** 3) value -= 18;
    return value;
  };
  return [...results].sort((a, b) => scoreResult(b) + bonus(b) - (scoreResult(a) + bonus(a)));
}

/** Parse the /abss/<slug>/ detail page: torrent table, files, magnet. */
export function parseDetail(html: string, base = "https://audiobookbay.lu", url?: string): AbbDetail {
  const pageTitle = stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(
    /\s*Audiobook.*$/i,
    "",
  );
  const heading = stripTags(
    (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? html.match(/class="[^"]*post-title[^"]*"[^>]*>([\s\S]*?)</i) ?? [])[1] ??
      pageTitle,
  );
  const title = heading || pageTitle;
  const author =
    (html.match(/Written by\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1]
      ? stripTags(html.match(/Written by\s*<a[^>]*>([\s\S]*?)<\/a>/i)![1])
      : undefined) ??
    (title.includes(" - ") ? title.split(" - ").slice(1).join(" - ") : undefined);

  const infoHash = html
    .match(/Info Hash:\s*(?:<\/strong>)?[\s\S]{0,60}?([0-9a-f]{40})/i)?.[1]
    ?.toLowerCase();
  const trackers = Array.from(
    new Set((html.match(/(?:udp|https?):\/\/[^\s"'<>]+announce/gi) ?? []).map((item) => item.trim())),
  );

  const magnetHref = html.match(/href="(magnet:[^"]+)"/i)?.[1];
  const magnet =
    magnetHref ?? (infoHash ? buildMagnet(infoHash, title || "audiobook", trackers) : undefined) ?? undefined;
  const torrentHref = html.match(
    /href="([^"]*)"[^>]*>\s*(?:Torrent Free Downloads|Torrent Download)/i,
  )?.[1];
  const directHref = html.match(/href="([^"]*)"[^>]*>\s*(?:Start Direct Download|Direct Download)/i)?.[1];
  const coverUrl = html.match(/<img[^>]+src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp))"/i)?.[1];

  const files: AbbFile[] = [];
  const filePattern =
    /([^\n<>|]+\.(?:m4b|mp3|mp4|m4a|flac|ogg|opus|aac|zip|rar|jpg|jpeg|png|cue|nfo|txt))\s+([\d.,]+\s*[KMGT]?Bs?)/gi;
  for (const match of html.matchAll(filePattern)) {
    const name = stripTags(match[1]).trim();
    if (!name || name.length > 240) continue;
    files.push({ name, sizeBytes: parseSizeToBytes(match[2]) ?? 0 });
  }

  // "Combined File Size" is the headline number; the per-file rows are summed
  // only when the page does not state a total.
  const stated = sizeAfterLabel(html, "Combined File Size") ?? sizeAfterLabel(html, "File Size");
  const sizeText = stated?.sizeText;
  const totalBytes = stated?.size ?? files.reduce((total, file) => total + file.sizeBytes, 0);

  const synopsisRaw = html.match(/Synopsis:[\s\S]{0,40}?(?:<\/?(?:strong|p|em)>)+([\s\S]*?)(?:<\/p>|<div|PLEASE NOTE|$)/i)?.[1];
  const format = afterLabel(html, "Format", TEXT_VALUE);
  const bitrate = afterLabel(html, "Bitrate", TEXT_VALUE);
  const narrator = afterLabel(html, "Narrator", TEXT_VALUE);
  const detailUrl = url ?? base;

  const result: TorrentResult = {
    id: infoHash ?? `abb_${detailUrl}`,
    source: "audiobookbay",
    title,
    size: totalBytes || undefined,
    sizeText: sizeText ?? (totalBytes ? `${(totalBytes / 1024 ** 2).toFixed(2)} MBs` : undefined),
    magnet,
    infoHash,
    url: detailUrl,
    coverUrl,
    postedAt: undefined,
    parsed: {
      author,
      narrator,
      format,
      bitrate,
      year: Number((pageTitle.match(/\b(19|20)\d{2}\b/) ?? [])[0]) || undefined,
    },
  };

  return {
    result,
    pageTitle,
    title,
    author,
    narrator,
    format,
    bitrate,
    abridged: /Unabridged/i.test(html) ? "unabridged" : /Abridged/i.test(html) ? "abridged" : undefined,
    infoHash,
    trackers,
    magnet,
    torrentUrl: torrentHref ? absolute(torrentHref, base) : undefined,
    directUrl: directHref ? absolute(directHref, base) : undefined,
    coverUrl,
    synopsis: synopsisRaw ? stripTags(synopsisRaw).slice(0, 4000) : undefined,
    files,
    totalBytes,
    fileCount: files.length,
    multifile: /Multifile Torrent/i.test(html),
  };
}

/** Pull the magnet out of a redirect page (the site sometimes hides it). */
export function magnetFromDetailPage(html: string): string | null {
  const direct = html.match(/magnet:\?xt=[^"'<\s]+/i);
  if (direct) return direct[0];
  const hash = html.match(/urn:btih:([a-fA-F0-9]{32,40})/)?.[1] ?? html.match(/Info Hash:\D{0,40}([a-f0-9]{40})/i)?.[1];
  if (hash) {
    const parsed = parseMagnet(`magnet:?xt=urn:btih:${hash}`);
    return parsed ? buildMagnet(parsed.infoHash, stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "audiobook")) : null;
  }
  return null;
}

/** Files inside a finished torrent worth importing (audio, plus cue/cover). */
export function pickImportable(files: AbbFile[]): AbbFile[] {
  return files.filter((file) => /\.(m4b|mp3|mp4|m4a|flac|ogg|opus|aac)$/i.test(file.name));
}

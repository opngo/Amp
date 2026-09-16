/**
 * AudioBookBay network client: search, detail lookup, magnet resolution.
 * Parsing lives in abbParse.ts (and @amp/core); this file only talks to the
 * network and rotates mirrors when one is blocked.
 */

import { net } from "electron";
import type { TorrentResult } from "@amp/core";
import { logLine } from "./store";
import { magnetFromDetailPage, parseDetail, parseSearch, rankResults, type AbbDetail } from "./abbParse";

export * from "./abbParse";

export const ABB_MIRRORS = [
  "https://audiobookbay.lu",
  "https://audiobookbay.is",
  "https://audiobookbay.se",
  "https://theaudiobookbay.se",
  "https://audiobookbay.li",
];

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Amp/1.0";

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await net.fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`AudioBookBay answered with ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

let activeMirror: string | null = null;

export function currentMirror(): string | null {
  return activeMirror;
}

/** Search every configured mirror until one answers. */
export async function searchAudiobookBay(
  query: string,
  options: { mirrors?: string[]; limit?: number } = {},
): Promise<TorrentResult[]> {
  const mirrors = options.mirrors?.length ? options.mirrors : ABB_MIRRORS;
  const ordered = activeMirror ? [activeMirror, ...mirrors.filter((item) => item !== activeMirror)] : mirrors;
  let lastError: unknown = null;

  for (const mirror of ordered) {
    try {
      const html = await fetchText(`${mirror}/?s=${encodeURIComponent(query)}`);
      activeMirror = mirror;
      const results = rankResults(parseSearch(html, mirror), query);
      await logLine(`abb: ${results.length} results for "${query}" from ${mirror}`);
      return options.limit ? results.slice(0, options.limit) : results;
    } catch (error) {
      lastError = error;
      await logLine(`abb: ${mirror} failed - ${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  throw new Error(
    lastError instanceof Error
      ? `AudioBookBay is unreachable (${lastError.message})`
      : "AudioBookBay is unreachable",
  );
}

export async function fetchDetail(url: string): Promise<AbbDetail> {
  const base = new URL(url).origin;
  const html = await fetchText(url, 20000);
  return parseDetail(html, base, url);
}

/** Detail lookup that always ends with a magnet link the queue can use. */
export async function resolveMagnet(url: string): Promise<{ detail: AbbDetail; magnet?: string }> {
  const detail = await fetchDetail(url);
  if (detail.magnet) return { detail, magnet: detail.magnet };
  // Some mirrors hide the magnet behind a redirect page.
  try {
    const redirect = await fetchText(url.replace(/\/abss\//, "/downld0?downfs="), 15000);
    const magnet = magnetFromDetailPage(redirect) ?? undefined;
    return { detail: { ...detail, magnet }, magnet };
  } catch {
    return { detail };
  }
}

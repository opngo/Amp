/**
 * Where a book's artwork actually lives.
 *
 * Covers and banners are stored the same way - a picked data URL, a remote URL,
 * or an absolute path on the machine that owns the library - but the path means
 * different things to different clients:
 *
 *  - the desktop app can read the file, but only through the `amp-media`
 *    scheme (a raw `C:\Users\...` or `/Users/...` string is not a URL and never
 *    loads, which is exactly the bug that made covers vanish on Windows);
 *  - a browser talking to the tailscale server cannot read the file at all and
 *    has to ask the host for it by book id.
 *
 * This module is the single place that answers "what src do I hand the img?".
 * It is a pure function plus thin hooks, so the ordering is testable without a
 * DOM and covers and banners can never drift apart again.
 */

import { useEffect, useMemo } from "react";
import { isLoadableUrl } from "@amp/core";
import { bridgeIfReady } from "./bridge";
import { coverUrlFor, readConnection } from "./httpBridge";

/** The two kinds of artwork a book can carry. */
export type ArtworkKind = "cover" | "banner";

export interface ArtworkFields {
  id: string;
  /** A picked image, stored inline. */
  dataUrl?: string;
  /** A remote URL, or a URL the host handed back. */
  url?: string;
  /** An absolute path to a file on the machine that owns the library. */
  path?: string;
}

export interface ArtworkHosts {
  /** Ask the host for the file by book id: it can read paths, a page cannot. */
  http?: (kind: ArtworkKind, bookId: string) => string;
  /** Turn a real path into a URL the renderer may load (desktop bridge). */
  fileUrl?: (filePath: string) => string;
}

/**
 * The resolution order, in one place:
 *
 *  1. a picked image (data URL) - already loadable everywhere;
 *  2. a remote or host URL - same;
 *  3. a path that is itself a URL (an `amp-media://` one, say);
 *  4. the host over HTTP, by book id - the only way a browser can see the file;
 *  5. the desktop bridge, which builds an `amp-media://` URL from the path;
 *  6. the raw value, as a last resort (it may still be a relative URL).
 */
export function artworkSrc(
  kind: ArtworkKind,
  source: ArtworkFields,
  hosts: ArtworkHosts = {},
): string | null {
  if (source.dataUrl) return source.dataUrl;
  if (source.url) return source.url;
  const filePath = source.path;
  if (!filePath) return null;
  if (isLoadableUrl(filePath)) return filePath;
  return hosts.http?.(kind, source.id) || hosts.fileUrl?.(filePath) || filePath;
}

/**
 * The hosts the running renderer can offer, or nothing in a plain browser.
 *
 * Two ways to reach a host: a saved connection (a page that was pointed at a
 * server by address), or the page's own origin, when Amp itself served it -
 * which is the case for the web build and for a phone on the tailnet.
 */
function liveHosts(): ArtworkHosts {
  const connection = readConnection();
  const host = bridgeIfReady();
  const base = connection?.url ? connection : sameOriginConnection(host?.platform);
  return {
    http: base ? (kind, bookId) => coverUrlFor(bookId, base, kind) : undefined,
    fileUrl: host ? (filePath) => host.library.fileUrl(filePath) : undefined,
  };
}

/** The connection implied by the page's own address, when Amp served it. */
function sameOriginConnection(platform: string | undefined): { url: string; token: string } | null {
  if (typeof window === "undefined" || !/^https?:$/.test(window.location.protocol)) return null;
  // Only an Amp server has the artwork endpoints; a static host does not.
  const plate = platform ?? (window.amp ? "electron" : "");
  if (plate !== "server") return null;
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  return { url: window.location.origin, token };
}

/**
 * Resolve one book's cover or banner for display.
 *
 * Memoised per field, so a re-render never re-asks the bridge, and re-resolved
 * the moment the book gains its artwork.
 */
export function useArtworkSrc(kind: ArtworkKind, book: ArtworkFields): string | null {
  const { id, dataUrl, url, path } = book;
  return useMemo(
    () => artworkSrc(kind, { id, dataUrl, url, path }, liveHosts()),
    [kind, id, dataUrl, url, path],
  );
}

/** The src for a shelf of covers, the short way. */
export function useCoverSrc(book: {
  id: string;
  coverDataUrl?: string;
  coverUrl?: string;
  coverPath?: string;
}): string | null {
  return useArtworkSrc("cover", {
    id: book.id,
    dataUrl: book.coverDataUrl,
    url: book.coverUrl,
    path: book.coverPath,
  });
}

/** The src for a wide banner, the short way. */
export function useBannerSrc(book: {
  id: string;
  bannerDataUrl?: string;
  bannerUrl?: string;
  bannerPath?: string;
}): string | null {
  return useArtworkSrc("banner", {
    id: book.id,
    dataUrl: book.bannerDataUrl,
    url: book.bannerUrl,
    path: book.bannerPath,
  });
}

/**
 * Covers come from the file itself unless the listener picks something else.
 *
 * An m4b or an mp3 almost always carries its artwork in its tags, and the host
 * extracts it into the cover cache on import. This is the safety net for the
 * books that were already in the library when the cover came through, and for
 * any import where the background extraction had not finished: the first time a
 * cover is asked for and there is nothing to show, the host is asked once, and
 * the answer is written back onto the book.
 *
 * One attempt per book per session. A book with no embedded art at all costs a
 * single check, not a request per render.
 */
const extracted = new Set<string>();
const attempted = new Set<string>();

export function useEmbeddedCover(book: {
  id: string;
  coverDataUrl?: string;
  coverUrl?: string;
  coverPath?: string;
}): string | null {
  const resolved = useCoverSrc(book);
  const { id } = book;
  useEffect(() => {
    if (resolved || !id || attempted.has(id) || extracted.has(id)) return;
    attempted.add(id);
    const host = bridgeIfReady();
    if (!host?.library.extractCover) return;
    void (async () => {
      try {
        const library = await import("../store/useLibraryStore");
        const record = library.useLibraryStore.getState().state.books.find((item) => item.id === id);
        if (!record) return;
        const path = await host.library.extractCover({ id: record.id, sourcePath: record.sourcePath });
        if (!path) return;
        extracted.add(id);
        await library.useLibraryStore.getState().patchBook(id, { coverPath: path });
      } catch {
        /* no embedded art, an unreadable file, or a host without the call */
      }
    })();
  }, [id, resolved]);
  return resolved;
}

/**
 * How the desktop app answers a request for a file on disk.
 *
 * Audio and artwork travel over the `amp-media://` scheme, and the player asks
 * for them with `crossOrigin = "anonymous"` (WebAudio needs untainted samples
 * for the equalizer and the visualizer). That combination makes every request a
 * CORS request, so a response without `Access-Control-Allow-Origin` is refused
 * outright - and Chromium reports the refusal through the media element as
 * "no supported source was found", which reads exactly like a missing codec and
 * wasted an afternoon. Every response here carries the CORS headers, including
 * the error ones, so a real problem stays visible as itself.
 *
 * The header and range decisions are pure functions, so they are unit tested
 * without an Electron process.
 */

/** Content types for the files Amp streams. */
const MEDIA_TYPES: Record<string, string> = {
  ".m4b": "audio/mp4",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/** The content type for a path, by extension. */
export function mediaTypeFor(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MEDIA_TYPES[filePath.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/**
 * The headers every media response carries.
 *
 * `*` is deliberate rather than a specific origin: the renderer's origin is
 * different in a packaged build (a `file://` page, whose origin is opaque) than
 * in development (the Vite dev server), and both read the same files.
 */
export const MEDIA_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Range, Origin, Accept, Content-Type, Authorization",
  // Without these, a page can read the body but not the range metadata it needs
  // to seek, and a cross-origin player silently restarts instead of seeking.
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  Vary: "Origin",
};

/** A parsed byte range, with the numbers a 206 response needs. */
export interface ByteRange {
  start: number;
  end: number;
  /** Length of the requested slice. */
  length: number;
}

/**
 * Read a `Range: bytes=...` header.
 *
 * Handles the three forms the media stack actually sends: `start-end`,
 * `start-` (open ended) and `-suffix` (the last N bytes). Returns null when the
 * header is absent or unreadable, and `"unsatisfiable"` when it asks for a slice
 * past the end of the file, which is a 416 rather than a 200.
 */
export function parseByteRange(
  header: string | null | undefined,
  size: number,
): ByteRange | null | "unsatisfiable" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    // `bytes=-N`: the last N bytes.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = Math.max(0, size - 1);
  } else {
    start = Number(rawStart);
    end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  // Past the end of the file is a valid request with an empty answer: 416. It
  // has to be checked before the start/end comparison, because clamping `end`
  // to the last byte is what makes `start > end` true here.
  if (start >= size) return "unsatisfiable";
  if (start > end) return null;
  return { start, end, length: end - start + 1 };
}

/** What the protocol handler should answer with. */
export interface MediaResponsePlan {
  status: number;
  headers: Record<string, string>;
  /** Where to start reading the file (0 for a 200 or a 416). */
  start: number;
  /** Where to stop reading, inclusive (0 for a 416). */
  end: number;
}

/**
 * The whole answer for a file: status, headers and the slice to stream.
 *
 * `range` is the raw header, `size` the file's length in bytes.
 */
export function planMediaResponse(options: {
  filePath: string;
  size: number;
  range?: string | null;
}): MediaResponsePlan {
  const { filePath, size, range } = options;
  const base: Record<string, string> = {
    ...MEDIA_CORS_HEADERS,
    "Content-Type": mediaTypeFor(filePath),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  const parsed = parseByteRange(range, size);
  if (parsed === "unsatisfiable") {
    return { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` }, start: 0, end: 0 };
  }
  if (parsed) {
    return {
      status: 206,
      headers: {
        ...base,
        "Content-Length": String(parsed.length),
        "Content-Range": `bytes ${parsed.start}-${parsed.end}/${size}`,
      },
      start: parsed.start,
      end: parsed.end,
    };
  }
  return {
    status: 200,
    headers: { ...base, "Content-Length": String(size) },
    start: 0,
    end: Math.max(0, size - 1),
  };
}

/** Headers for a response that carries no file: an error, or a preflight. */
export function mediaErrorHeaders(reason?: string): Record<string, string> {
  const headers: Record<string, string> = { ...MEDIA_CORS_HEADERS, "Cache-Control": "no-store" };
  if (reason) headers["X-Amp-Reason"] = reason;
  return headers;
}

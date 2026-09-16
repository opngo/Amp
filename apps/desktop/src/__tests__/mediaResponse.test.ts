/**
 * The media responses the desktop app sends for files on disk.
 *
 * The player asks for audio and artwork with `crossOrigin = "anonymous"`, so
 * each of these responses is a CORS response. A missing
 * `Access-Control-Allow-Origin` made every book fail to load on Windows with
 * "no supported source was found" - a message that points at codecs, not at
 * headers. These tests keep the headers, the ranges and the status codes
 * honest.
 */

import { describe, expect, it } from "vitest";
import { MEDIA_CORS_HEADERS, mediaErrorHeaders, mediaTypeFor, parseByteRange, planMediaResponse } from "../main/mediaResponse";

describe("mediaTypeFor", () => {
  it("knows the formats Amp plays", () => {
    expect(mediaTypeFor("C:\\books\\one.m4b")).toBe("audio/mp4");
    expect(mediaTypeFor("/books/one.m4a")).toBe("audio/mp4");
    expect(mediaTypeFor("/books/one.mp3")).toBe("audio/mpeg");
    expect(mediaTypeFor("/books/one.flac")).toBe("audio/flac");
    expect(mediaTypeFor("/books/one.opus")).toBe("audio/opus");
    expect(mediaTypeFor("/books/one.wav")).toBe("audio/wav");
  });

  it("knows artwork, so a cover is not served as a binary blob", () => {
    expect(mediaTypeFor("/covers/bk_1.png")).toBe("image/png");
    expect(mediaTypeFor("/covers/bk_1.jpg")).toBe("image/jpeg");
    expect(mediaTypeFor("/covers/bk_1.webp")).toBe("image/webp");
  });

  it("falls back for anything else, and is case-insensitive", () => {
    expect(mediaTypeFor("/books/notes.txt")).toBe("application/octet-stream");
    expect(mediaTypeFor("/books/noextension")).toBe("application/octet-stream");
    expect(mediaTypeFor("/books/ONE.M4B")).toBe("audio/mp4");
  });
});

describe("parseByteRange", () => {
  it("reads a closed range", () => {
    expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99, length: 100 });
  });

  it("reads an open ended range, which is what a player sends to resume", () => {
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999, length: 500 });
  });

  it("reads a suffix range, which is what a player sends to read the tail", () => {
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999, length: 100 });
  });

  it("clamps a range that runs past the end rather than failing", () => {
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999, length: 100 });
  });

  it("says so when the range starts past the end of the file", () => {
    expect(parseByteRange("bytes=5000-6000", 1000)).toBe("unsatisfiable");
  });

  it("ignores headers it cannot read, instead of guessing", () => {
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange("items=0-10", 1000)).toBeNull();
    expect(parseByteRange("bytes=abc-def", 1000)).toBeNull();
    expect(parseByteRange("bytes=-", 1000)).toBeNull();
  });
});

describe("planMediaResponse", () => {
  const file = "/books/Piranesi.m4b";

  it("carries the CORS headers a cross-origin player needs", () => {
    const plan = planMediaResponse({ filePath: file, size: 2048 });
    expect(plan.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(plan.headers["Access-Control-Expose-Headers"]).toContain("Content-Range");
    expect(plan.status).toBe(200);
    expect(plan.headers["Content-Length"]).toBe("2048");
    expect(plan.headers["Content-Type"]).toBe("audio/mp4");
    expect(plan.headers["Accept-Ranges"]).toBe("bytes");
  });

  it("answers a range request with 206 and the real content range", () => {
    const plan = planMediaResponse({ filePath: file, size: 2048, range: "bytes=1024-2047" });
    expect(plan.status).toBe(206);
    expect(plan.headers["Content-Range"]).toBe("bytes 1024-2047/2048");
    expect(plan.headers["Content-Length"]).toBe("1024");
    expect(plan.start).toBe(1024);
    expect(plan.end).toBe(2047);
  });

  it("answers an impossible range with 416 and still passes CORS", () => {
    const plan = planMediaResponse({ filePath: file, size: 2048, range: "bytes=9000-" });
    expect(plan.status).toBe(416);
    expect(plan.headers["Content-Range"]).toBe("bytes */2048");
    expect(plan.headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("serves an empty file without producing a negative length", () => {
    const plan = planMediaResponse({ filePath: file, size: 0 });
    expect(plan.status).toBe(200);
    expect(plan.headers["Content-Length"]).toBe("0");
    expect(plan.end).toBe(0);
  });

  it("handles a Windows path, including the drive letter", () => {
    const plan = planMediaResponse({
      filePath: "C:\\Users\\me\\Audiobooks\\Piranesi\\01 - Chapter 01.mp3",
      size: 1000,
      range: "bytes=0-",
    });
    expect(plan.headers["Content-Type"]).toBe("audio/mpeg");
    expect(plan.status).toBe(206);
    expect(plan.start).toBe(0);
    expect(plan.end).toBe(999);
  });
});

describe("mediaErrorHeaders", () => {
  it("keeps CORS on failures, so a missing file is not reported as a codec problem", () => {
    expect(mediaErrorHeaders("not-found")["Access-Control-Allow-Origin"]).toBe("*");
    expect(mediaErrorHeaders("not-found")["X-Amp-Reason"]).toBe("not-found");
    expect(MEDIA_CORS_HEADERS["Access-Control-Allow-Headers"]).toContain("Range");
  });
});

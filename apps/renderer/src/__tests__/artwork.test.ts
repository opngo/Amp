/**
 * The artwork resolver decides what the interface puts in an <img src>.
 *
 * It is the seam that broke on Windows: a library there stores
 * `C:\Users\me\Books\cover.png`, and handing that straight to an image tag
 * gave a cover that never appeared. These tests pin the order of preference,
 * for covers and for banners, because the two must never drift apart.
 */

import { describe, expect, it } from "vitest";
import { artworkSrc } from "../platform/artwork";

const WINDOWS_COVER = "C:\\Users\\me\\AppData\\Amp\\covers\\bk_1.png";
const WINDOWS_BANNER = "C:\\Users\\me\\AppData\\Amp\\banners\\bk_1.jpg";

describe("artworkSrc", () => {
  it("prefers a picked image over everything else", () => {
    expect(
      artworkSrc("cover", {
        id: "bk_1",
        dataUrl: "data:image/png;base64,AAA",
        url: "https://example.test/cover.jpg",
        path: WINDOWS_COVER,
      }),
    ).toBe("data:image/png;base64,AAA");
  });

  it("uses a remote or host URL before a path", () => {
    expect(
      artworkSrc(
        "cover",
        { id: "bk_1", url: "https://example.test/cover.jpg", path: WINDOWS_COVER },
        { http: () => "http://host/api/cover?bookId=bk_1" },
      ),
    ).toBe("https://example.test/cover.jpg");
  });

  it("gives an absolute Windows path to the host instead of the browser", () => {
    const asked: string[] = [];
    const src = artworkSrc(
      "cover",
      { id: "bk_1", path: WINDOWS_COVER },
      {
        http: (kind, bookId) => {
          asked.push(`${kind}:${bookId}`);
          return "http://host/api/cover?bookId=bk_1&which=cover";
        },
        fileUrl: (filePath) => `amp-media://local/${encodeURIComponent(filePath)}`,
      },
    );

    // The host wins: it can read the file, a page cannot.
    expect(asked).toEqual(["cover:bk_1"]);
    expect(src).toBe("http://host/api/cover?bookId=bk_1&which=cover");
  });

  it("asks the desktop bridge to turn the path into a URL when the host is local", () => {
    const src = artworkSrc(
      "cover",
      { id: "bk_1", path: WINDOWS_COVER },
      {
        fileUrl: (filePath) => `amp-media://local/${encodeURIComponent(filePath)}`,
      },
    );

    expect(src).toBe(`amp-media://local/${encodeURIComponent(WINDOWS_COVER)}`);
    expect(src?.startsWith("amp-media://")).toBe(true);
    expect(src?.includes("C:\\")).toBe(false);
  });

  it("passes an amp-media URL through untouched", () => {
    const already = `amp-media://local/${encodeURIComponent(WINDOWS_COVER)}`;
    expect(artworkSrc("cover", { id: "bk_1", path: already }, { http: () => "http://host/x" })).toBe(already);
  });

  it("resolves a banner the same way, telling the host it is a banner", () => {
    const asked: string[] = [];
    const src = artworkSrc(
      "banner",
      { id: "bk_2", path: WINDOWS_BANNER },
      {
        http: (kind, bookId) => {
          asked.push(`${kind}:${bookId}`);
          return "http://host/api/cover?bookId=bk_2&which=banner";
        },
      },
    );

    expect(asked).toEqual(["banner:bk_2"]);
    expect(src).toBe("http://host/api/cover?bookId=bk_2&which=banner");
  });

  it("returns nothing for a book with no artwork, so the generated art shows", () => {
    expect(artworkSrc("cover", { id: "bk_3" })).toBeNull();
    expect(artworkSrc("banner", { id: "bk_3" }, { http: () => "http://host/x" })).toBeNull();
  });

  it("keeps a relative path as a last resort rather than dropping it", () => {
    expect(artworkSrc("cover", { id: "bk_4", path: "covers/bk_4.png" })).toBe("covers/bk_4.png");
  });
});

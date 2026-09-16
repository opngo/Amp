import { describe, expect, it } from "vitest";
import { isAbsolutePath, isLoadableUrl, mediaUrl, mediaUrlToPath } from "../media";

describe("mediaUrl", () => {
  it("serves Windows paths through the media scheme", () => {
    // A drive letter looks like a URL scheme. Treating it as one is how the
    // renderer ended up with src="C:\books\one.m4b" and no audio in Windows.
    expect(mediaUrl("C:\\Users\\me\\Books\\Tempest.m4b")).toBe(
      "amp-media://local/C%3A%5CUsers%5Cme%5CBooks%5CTempest.m4b",
    );
    expect(mediaUrl("D:/audio/one.mp3")).toBe("amp-media://local/D%3A%2Faudio%2Fone.mp3");
  });

  it("serves POSIX paths", () => {
    expect(mediaUrl("/home/me/books/one.m4b")).toBe("amp-media://local/%2Fhome%2Fme%2Fbooks%2Fone.m4b");
  });

  it("leaves real URLs alone", () => {
    for (const url of [
      "https://example.test/cover.jpg",
      "http://127.0.0.1:8787/api/cover?bookId=bk_1",
      "file:///home/me/cover.png",
      "data:image/png;base64,AAAA",
      "blob:http://localhost/abc",
      "amp-media://local/%2Ftmp%2Fcover.png",
    ]) {
      expect(mediaUrl(url)).toBe(url);
    }
  });

  it("keeps relative values as they are", () => {
    expect(mediaUrl("covers/one.png")).toBe("covers/one.png");
    expect(mediaUrl("")).toBe("");
  });

  it("names the scheme it was given", () => {
    expect(mediaUrl("/tmp/a.png", "amp-file", "host")).toBe("amp-file://host/%2Ftmp%2Fa.png");
  });
});

describe("mediaUrlToPath", () => {
  it("round-trips a Windows path", () => {
    const url = mediaUrl("C:\\Users\\me\\Books\\Tempest.m4b");
    expect(mediaUrlToPath(url)).toBe("C:\\Users\\me\\Books\\Tempest.m4b");
  });

  it("round-trips a POSIX path with spaces and parentheses", () => {
    const path = "/media/Books/Harry Potter (Full-Cast Edition)/01.mp3";
    expect(mediaUrlToPath(mediaUrl(path))).toBe(path);
  });

  it("ignores anything that is not the media scheme", () => {
    expect(mediaUrlToPath("https://example.test/x.png")).toBeNull();
  });
});

describe("isLoadableUrl and isAbsolutePath", () => {
  it("separates the two ideas", () => {
    expect(isLoadableUrl("C:\\books\\a.m4b")).toBe(false);
    expect(isAbsolutePath("C:\\books\\a.m4b")).toBe(true);
    expect(isAbsolutePath("\\\\server\\share\\a.m4b")).toBe(true);
    expect(isLoadableUrl("https://a.test/b")).toBe(true);
    expect(isAbsolutePath("https://a.test/b")).toBe(false);
  });
});

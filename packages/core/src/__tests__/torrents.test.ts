import { describe, expect, it } from "vitest";
import {
  buildMagnet,
  humanState,
  isTorrentActive,
  isTorrentFinished,
  normalizeQbTorrent,
  parseABBSearch,
  parseMagnet,
  parseMagnetFromDetail,
  parseSizeToBytes,
  parseTitle,
  pickAudiobookFiles,
  qbAddMagnetRequest,
  sizeAfterLabel,
  torrentFilePathCandidates,
  sortResults,
  searchUrl,
} from "../torrents";

const MAGNET = "magnet:?xt=urn:btih:c12fe1c06bba254a9dc9f519b335aa7c1367a88a&dn=Dune&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337";

describe("magnet parsing", () => {
  it("extracts hash, name and trackers", () => {
    const info = parseMagnet(MAGNET);
    expect(info?.infoHash).toBe("c12fe1c06bba254a9dc9f519b335aa7c1367a88a");
    expect(info?.displayName).toBe("Dune");
    expect(info?.trackers).toHaveLength(1);
  });

  it("rejects non magnets", () => {
    expect(parseMagnet("https://example.com")).toBeNull();
    expect(parseMagnet("magnet:?dn=no-hash")).toBeNull();
  });

  it("round trips through buildMagnet", () => {
    const magnet = buildMagnet("abc123", "Dune", ["udp://tracker"]);
    expect(parseMagnet(magnet)?.infoHash).toBe("abc123");
  });
});

describe("title parsing", () => {
  it("pulls apart a typical release name", () => {
    const parsed = parseTitle("Frank Herbert - Dune (1965) [M4B 64kbps] Narrated by Scott Brick");
    expect(parsed.author).toBe("Frank Herbert");
    expect(parsed.title).toBe("Dune");
    expect(parsed.year).toBe(1965);
    expect(parsed.format).toBe("m4b");
    expect(parsed.bitrate).toBe("64 kbps");
  });

  it("handles 'by' style titles", () => {
    const parsed = parseTitle("The Way of Kings by Brandon Sanderson mp3 96kbps");
    expect(parsed.title).toBe("The Way of Kings");
    expect(parsed.author).toBe("Brandon Sanderson");
    expect(parsed.format).toBe("mp3");
  });

  it("scores m4b above unknown formats", () => {
    expect(parseTitle("Book [M4B 128kbps]").quality).toBeGreaterThan(parseTitle("Book").quality);
  });

  it("detects abridged releases", () => {
    expect(parseTitle("Dune abridged").abridged).toBe(true);
  });
});

describe("search page parsing", () => {
  const html = `
    <div class="post">
      <div class="postTitle"><h2><a href="https://audiobookbay.lu/abs/dune/">Frank Herbert - Dune (1965) M4B</a></h2></div>
      <div class="postContent"><a href="magnet:?xt=urn:btih:aaaabbbbccccddddeeeeffff0000111122223333&dn=Dune&tr=udp%3A%2F%2Ftracker">Magnet</a>
      <span>Size: 1.2 GB</span><img src="/covers/dune.jpg" /><span>12 June 2023</span></div>
    </div>
    <div class="post">
      <div class="postTitle"><h2><a href="/abs/dune-messiah/">Dune Messiah - Frank Herbert MP3</a></h2></div>
      <div class="postContent"><span>Size: 800 MB</span></div>
    </div>`;

  it("extracts results with hashes, sizes and covers", () => {
    const results = parseABBSearch(html);
    expect(results).toHaveLength(2);
    expect(results[0].infoHash).toBe("aaaabbbbccccddddeeeeffff0000111122223333");
    expect(results[0].size).toBe(parseSizeToBytes("1.2 GB"));
    expect(results[0].coverUrl).toBe("https://audiobookbay.lu/covers/dune.jpg");
    expect(results[0].parsed?.author).toBe("Frank Herbert");
    expect(results[1].magnet).toBeUndefined();
  });

  // The live site keeps the number and the unit in different elements, and the
  // colour in the span holds digits: `File Size: <span style='color:#00f;'>72.25</span> MBs`.
  const spanSizeHtml = `
    <div class="post">
      <div class="postTitle"><h2><a href="https://audiobookbay.lu/abss/a-lovers-haunting/">A Lover's Haunting - Carrie Bates</a></h2></div>
      <div class="postContent"><p>Format: <span style='color:#a00;'>M4B</span> / Bitrate: <span style='color:#a00;'>96 Kbps</span></p>
      <p>File Size: <span style='color:#00f;'>72.25</span> MBs</p></div>
    </div>`;

  it("reads a size whose number and unit are in different elements", () => {
    const [result] = parseABBSearch(spanSizeHtml);
    expect(result.sizeText).toBe("72.25 MB");
    expect(result.size).toBe(parseSizeToBytes("72.25 MB"));
  });

  it("does not mistake a bitrate for the size", () => {
    expect(sizeAfterLabel("<p>Bitrate: 96 Kbps</p>", "File Size")).toBeNull();
    expect(sizeAfterLabel("<p>File Size: <b>1.2</b> GBs</p>", "File Size")?.sizeText).toBe("1.2 GB");
  });

  it("finds magnets on detail pages, including encodings", () => {
    expect(parseMagnetFromDetail('<a href="magnet:?xt=urn:btih:bbb">go</a>')).toContain("urn:btih:bbb");
    expect(parseMagnetFromDetail("window.location='magnet%3A%3Fxt%3Durn%3Abtih%3Accc%26dn%3DX'")).toContain("urn:btih:ccc");
    const fromHash = parseMagnetFromDetail("<title>Solo</title>urn:btih:abcdefabcdefabcdefabcdefabcdefab");
    expect(parseMagnet(fromHash ?? "")?.infoHash).toBe("abcdefabcdefabcdefabcdefabcdefab");
    expect(parseMagnetFromDetail("<p>nothing here</p>")).toBeNull();
  });

  it("builds per source search urls", () => {
    expect(searchUrl("audiobookbay", "dune messiah")).toContain("audiobookbay.lu");
    expect(searchUrl("audiobookbay", "dune messiah")).toContain("dune%20messiah");
  });
});

describe("sizes and qbittorrent", () => {
  it("parses human sizes", () => {
    expect(parseSizeToBytes("1.5 GB")).toBe(Math.round(1.5 * 1024 ** 3));
    expect(parseSizeToBytes("700MB")).toBe(700 * 1024 ** 2);
    expect(parseSizeToBytes("nope")).toBeUndefined();
  });

  it("normalises torrent list entries", () => {
    const item = normalizeQbTorrent({
      hash: "abc",
      name: "Dune",
      state: "downloading",
      progress: 0.42,
      dlspeed: 1024,
      size: 1000,
      downloaded: 420,
      savepath: "/downloads",
    });
    expect(item.progress).toBeCloseTo(0.42);
    expect(item.downloadSpeed).toBe(1024);
    expect(item.savePath).toBe("/downloads");
    expect(isTorrentActive(item.state)).toBe(true);
    expect(isTorrentFinished("uploading")).toBe(true);
    expect(humanState("metaDL")).toBe("Fetching metadata");
  });

  it("builds add requests", () => {
    const request = qbAddMagnetRequest(
      { url: "http://localhost:8080/", username: "a", password: "b", category: "audiobooks", sequential: true },
      MAGNET,
    );
    expect(request.path).toBe("/api/v2/torrents/add");
    expect(request.form?.category).toBe("audiobooks");
    expect(request.form?.sequentialDownload).toBe("true");
    expect(request.form?.urls).toBe(MAGNET);
  });

  it("finds a finished torrent's files wherever qBittorrent described them", () => {
    /*
     * The three shapes qBittorrent reports, all of which have to resolve:
     * a multi-file torrent whose entry names repeat the torrent folder, a
     * multi-file torrent whose entries are relative to the save folder, and a
     * single-file torrent whose content path is the file itself.
     */
    const repeated = torrentFilePathCandidates({
      name: "Blindsight/Chapter 01.mp3",
      savePath: "/downloads",
      contentPath: "/downloads/Blindsight",
    });
    expect(repeated[0]).toBe("/downloads/Blindsight/Chapter 01.mp3");
    expect(repeated).toContain("/downloads/Blindsight/Blindsight/Chapter 01.mp3");

    const relative = torrentFilePathCandidates({
      name: "Chapter 01.mp3",
      savePath: "/downloads",
      contentPath: "/downloads/Blindsight",
    });
    expect(relative[0]).toBe("/downloads/Chapter 01.mp3");
    expect(relative).toContain("/downloads/Blindsight/Chapter 01.mp3");

    const single = torrentFilePathCandidates({
      name: "Blindsight.m4b",
      savePath: "/downloads",
      contentPath: "/downloads/Blindsight.m4b",
    });
    expect(single[0]).toBe("/downloads/Blindsight.m4b");
    expect(new Set(single).size).toBe(single.length);
  });

  it("keeps the separator it was given", () => {
    const windows = torrentFilePathCandidates({ name: "Book\\Chapter 01.mp3", savePath: "D:\\Downloads" });
    expect(windows[0]).toBe("D:\\Downloads\\Book\\Chapter 01.mp3");
    const posix = torrentFilePathCandidates({ name: "Book/Chapter 01.mp3", savePath: "/home/me/downloads/" });
    expect(posix[0]).toBe("/home/me/downloads/Book/Chapter 01.mp3");
  });

  it("ranks results by score/seeders/size/date", () => {
    const results = [
      { id: "1", source: "s", title: "A [MP3 64kbps]", size: 500 * 1024 ** 2, seeders: 2, postedAt: 10 },
      { id: "2", source: "s", title: "B [M4B 128kbps]", size: 900 * 1024 ** 2, seeders: 50, postedAt: 5 },
    ];
    expect(sortResults(results, "seeders")[0].id).toBe("2");
    expect(sortResults(results, "size")[0].id).toBe("1");
    expect(sortResults(results, "date")[0].id).toBe("1");
    expect(sortResults(results, "relevance")[0].id).toBe("2");
  });

  it("picks the audiobook files out of a torrent", () => {
    expect(pickAudiobookFiles(["cover.jpg", "book.m4b", "notes.txt"])).toEqual(["book.m4b"]);
    expect(pickAudiobookFiles(["01.mp3", "02.mp3"])).toHaveLength(2);
    expect(pickAudiobookFiles(["readme.txt"])).toEqual([]);
  });
});

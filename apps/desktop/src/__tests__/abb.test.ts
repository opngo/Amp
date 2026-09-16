import { describe, expect, it } from "vitest";
import type { Chapter } from "@amp/core";
import {
  magnetFromDetailPage,
  parseDetail,
  parseSearch,
  pickImportable,
  rankResults,
} from "../main/abbParse";
import { buildFfmetadata, chaptersOf, escapeFfmetadata, splitChapterArgs } from "../main/ffmetadata";

/**
 * Fixtures copied from the real markup of audiobookbay.lu (2026-09): a search
 * card and the torrent table on a detail page.
 */
const searchHtml = `
<html><body>
<div class="post">
  <h2 class="post-title"><a href="https://audiobookbay.lu/abss/proaject-hail-mary-andy-weir/" rel="bookmark">Project Hail Mary - Andy Weir</a></h2>
  <div class="post-content">
    <p><strong>Category:</strong> Sci-Fi<br /><strong>Language:</strong> English <strong>Keywords:</strong> Andy Weir Project Hail Mary Road Trip</p>
    <p><img src="https://m.media-amazon.com/images/I/51b6fvQr1-L.jpg" /></p>
    <p><strong>Posted:</strong> 14 Nov 2021<br /><strong>Format:</strong> M4B / <strong>Bitrate:</strong> 128 Kbps</p>
    <p>File Size: 881.82 MBs</p>
    <p><a href="https://audiobookbay.lu/abss/proaject-hail-mary-andy-weir/">Audiobook Details</a><a href="https://audiobookbay.lu/dload-now?ll=84Andy_Weir___Project_Hail_Mary">Direct Download</a></p>
  </div>
</div>
<div class="post">
  <h2 class="post-title"><a href="https://audiobookbay.lu/abss/entirve-audiobooks-collection-various/">Entire Audiobooks Collection - Various</a></h2>
  <div class="post-content">
    <p><strong>Category:</strong> Other<br /><strong>Language:</strong> English</p>
    <p><strong>Posted:</strong> 29 May 2026<br /><strong>Format:</strong> M4B / <strong>Bitrate:</strong> Mixed</p>
    <p>File Size: 788.39 GBs</p>
  </div>
</div>
<nav><h2 class="post-title"><a href="https://audiobookbay.lu/audio-books/type/sci-fi/">Sci-Fi</a></h2></nav>
</body></html>`;

const detailHtml = `
<html><head><title>Project Hail Mary - Andy Weir Audiobook M4B </title></head><body>
<h1 class="post-title">Project Hail Mary - Andy Weir</h1>
<p>Category: <a href="/audio-books/type/sci-fi/">Sci-Fi</a></p>
<p>Written by <a href="https://audiobookbay.lu/?s=andy+weir&amp;tt=1">Andy Weir</a></p>
<p>Format: M4B</p><p>Bitrate: 128 Kbps</p><p>Unabridged</p>
<p>Narrator: Ray Porter</p>
<p>Synopsis:</p><p>A lone astronaut must save the earth from disaster.</p>
<table>
<tr><td>Announce URL:</td><td>http://googer.cc:1337/announce</td></tr>
<tr><td>Tracker:</td><td>udp://tracker.opentrackr.org:1337/announce</td></tr>
<tr><td>Tracker:</td><td>udp://open.stealth.si:80/announce</td></tr>
<tr><td>Creation Date:</td><td>Sun, 14 Nov 2021 03:17:29 +0100</td></tr>
<tr><td>This is a Multifile Torrent</td></tr>
<tr><td>Andy Weir - Project Hail Mary.cue 1.74 KBs</td></tr>
<tr><td>Andy Weir - Project Hail Mary.jpg 58.56 KBs</td></tr>
<tr><td>Andy Weir - Project Hail Mary.m4b 881.76 MBs</td></tr>
<tr><td>Combined File Size:</td><td>881.82 MBs</td></tr>
<tr><td>Info Hash:</td><td>ad5fae5ffda056f9f45131045d140326bbafc4dc</td></tr>
<tr><td>Torrent Download</td><td><a href="https://audiobookbay.lu/downld0?downfs=84Andy_Weir___Project_Hail_Mary">Torrent Free Downloads</a> | <a href="magnet:?xt=urn:btih:ad5fae5ffda056f9f45131045d140326bbafc4dc"><img src="/images/magnet.gif" /></a></td></tr>
<tr><td>Direct Download</td><td><a href="https://audiobookbay.lu/dedl4-now?teb=84">Start Direct Download</a></td></tr>
</table>
<img src="https://m.media-amazon.com/images/I/51b6fvQr1-L.jpg" />
</body></html>`;

describe("abb scraper", () => {
  it("parses search cards, skipping navigation links", () => {
    const results = parseSearch(searchHtml);
    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Project Hail Mary - Andy Weir");
    expect(results[0].url).toBe("https://audiobookbay.lu/abss/proaject-hail-mary-andy-weir/");
    expect(results[0].coverUrl).toContain("51b6fvQr1-L.jpg");
    expect(results[0].parsed?.format).toBe("M4B");
    expect(results[0].parsed?.bitrate).toBe("128 Kbps");
    expect(results[0].category).toBe("Sci-Fi");
    expect(results[0].size).toBe(Math.round(881.82 * 1024 ** 2));
    expect(results[0].sizeText).toBe("881.82 MB");
    expect(results[0].postedAt).toBe(Date.parse("14 Nov 2021"));
  });

  it("ranks a matching single book above a giant collection", () => {
    const results = rankResults(parseSearch(searchHtml), "project hail mary");
    expect(results[0].title).toContain("Project Hail Mary");
    expect(results[1].title).toContain("Entire Audiobooks Collection");
  });

  it("parses the detail page into a magnet-ready record", () => {
    const detail = parseDetail(
      detailHtml,
      "https://audiobookbay.lu",
      "https://audiobookbay.lu/abss/proaject-hail-mary-andy-weir/",
    );
    expect(detail.title).toBe("Project Hail Mary - Andy Weir");
    expect(detail.author).toBe("Andy Weir");
    expect(detail.narrator).toBe("Ray Porter");
    expect(detail.format).toBe("M4B");
    expect(detail.infoHash).toBe("ad5fae5ffda056f9f45131045d140326bbafc4dc");
    expect(detail.trackers).toHaveLength(3);
    expect(detail.magnet).toContain("urn:btih:ad5fae5ffda056f9f45131045d140326bbafc4dc");
    expect(detail.torrentUrl).toContain("downld0");
    expect(detail.directUrl).toContain("dedl4-now");
    expect(detail.abridged).toBe("unabridged");
    expect(detail.synopsis).toContain("lone astronaut");
    expect(detail.multifile).toBe(true);
    expect(detail.files.map((file) => file.name)).toContain("Andy Weir - Project Hail Mary.m4b");
    expect(detail.totalBytes).toBe(Math.round(881.82 * 1024 ** 2));
    expect(detail.result.magnet).toBe(detail.magnet);
    expect(detail.result.parsed?.author).toBe("Andy Weir");
  });

  it("extracts the magnet from a redirect page", () => {
    const magnet = magnetFromDetailPage(
      '<html><head><title>Get Lost</title></head><body><a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Get+Lost">go</a></body></html>',
    );
    expect(magnet).toContain("urn:btih:0123456789abcdef0123456789abcdef01234567");
  });

  it("picks only audio files out of a finished torrent", () => {
    const picked = pickImportable([
      { name: "book/01.mp3", sizeBytes: 10 },
      { name: "book/book.nfo", sizeBytes: 1 },
      { name: "book/book.m4b", sizeBytes: 10 },
      { name: "book/cover.jpg", sizeBytes: 1 },
    ]);
    expect(picked.map((file) => file.name)).toEqual(["book/01.mp3", "book/book.m4b"]);
  });
});

describe("ffmetadata", () => {
  const chapters: Chapter[] = [
    { id: "c1", index: 1, title: "Prologue", start: 0, duration: 1920 },
    { id: "c2", index: 2, title: "Chapter 1; the first", start: 1920, duration: 1800 },
    { id: "c3", index: 3, title: "Chapter 2 #done", start: 3720, duration: 60 },
  ];

  it("escapes ffmetadata special characters", () => {
    expect(escapeFfmetadata("a=b;c#d\\e")).toBe("a\\=b\\;c\\#d\\\\e");
  });

  it("writes timebased chapter blocks with millisecond timestamps", () => {
    const out = buildFfmetadata(chapters, { title: "A Book", artist: "Someone" });
    expect(out.startsWith(";FFMETADATA1\n")).toBe(true);
    expect(out).toContain("title=A Book");
    expect(out).toContain("artist=Someone");
    expect(out).toContain("TIMEBASE=1/1000");
    expect(out).toContain("START=0");
    expect(out).toContain("END=1920000");
    expect(out).toContain("title=Chapter 1\\; the first");
    expect(out).toContain("title=Chapter 2 \\#done");
  });

  it("uses the real duration for the final chapter", () => {
    const out = buildFfmetadata(chapters, {}, 3860);
    const blocks = out.split("[CHAPTER]");
    expect(blocks[3]).toContain("END=3860000");
  });

  it("sorts chapters by start time", () => {
    const out = buildFfmetadata([chapters[1], chapters[0]], {});
    expect(out.indexOf("title=Prologue")).toBeLessThan(out.indexOf("title=Chapter 1"));
  });

  it("describes per-chapter splitting without re-encoding", () => {
    const args = splitChapterArgs("book.m4b", 1920, 1800.25, "out.m4b");
    expect(args).toContain("-codec");
    expect(args).toContain("copy");
    expect(args[args.indexOf("-ss") + 1]).toBe("1920.000");
    expect(args[args.indexOf("-t") + 1]).toBe("1800.250");
  });

  it("falls back to the book itself when a single-file book has no chapters", () => {
    const chaptersForBook = chaptersOf({
      id: "b1",
      title: "Solo",
      duration: 1200,
      path: "/tmp/solo.m4b",
      kind: "single",
      files: [{ path: "/tmp/solo.m4b", name: "solo.m4b", sizeBytes: 1 }],
    } as never);
    expect(chaptersForBook).toHaveLength(1);
    expect(chaptersForBook[0].duration).toBe(1200);
  });
});

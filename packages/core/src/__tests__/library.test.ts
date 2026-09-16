import { describe, expect, it } from "vitest";
import { AUDIO_EXTENSIONS, basename, bookFiles, normalizeBook, bookPrimaryFile, bookSizeBytes, buildMultiBook, chapterAt, chapterFromFilename, dedupeBooks, facetCounts, filterBooks, groupFilesIntoBooks, isAudioFile, mergeBooks, mergeChapters, moveChapter, naturalCompare, reindexChapters, relayoutChapters, sortBooks, splitBookIntoBooks, splitChapter, type ScannedFile } from "../library";
import type { Book } from "../types";

function file(partial: Partial<ScannedFile> & { path: string }): ScannedFile {
  return {
    dir: partial.path.split("/").slice(0, -1).join("/"),
    name: partial.path.split("/").pop() ?? "file.mp3",
    ext: partial.path.split(".").pop() ?? "mp3",
    sizeBytes: 1_000_000,
    mtime: 1_700_000_000_000,
    ...partial,
  };
}

function book(partial: Partial<Book> & { id: string; title: string }): Book {
  return {
    author: "Unknown author",
    sourcePath: `/books/${partial.id}`,
    kind: "multi",
    chapters: [],
    duration: 3600,
    genres: [],
    tags: [],
    favorite: false,
    progress: 0,
    addedAt: 0,
    updatedAt: 0,
    ...partial,
  } as Book;
}

describe("file helpers", () => {
  it("detects audio extensions case insensitively", () => {
    expect(isAudioFile("Book.M4B")).toBe(true);
    expect(isAudioFile("notes.pdf")).toBe(false);
    expect(AUDIO_EXTENSIONS).toContain("mp4");
  });

  it("reads base names from both separators", () => {
    expect(basename("C:\\Books\\dune\\01.mp3")).toBe("01.mp3");
    expect(basename("/books/dune/01.mp3")).toBe("01.mp3");
  });
});

describe("naturalCompare", () => {
  it("sorts numbers like a human", () => {
    const sorted = ["Track 10.mp3", "Track 2.mp3", "Track 1.mp3"].sort(naturalCompare);
    expect(sorted).toEqual(["Track 1.mp3", "Track 2.mp3", "Track 10.mp3"]);
  });
});

describe("chapterFromFilename", () => {
  it("uses the default rules", () => {
    expect(chapterFromFilename("Chapter 03.mp3").title).toBe("Chapter 03");
    expect(chapterFromFilename("part-7.mp3").title).toBe("Chapter 07");
  });

  it("falls back to the clean file name", () => {
    expect(chapterFromFilename("Prologue - The Fall.mp3").title).toBe("Prologue - The Fall");
  });

  it("honours custom rules and templates", () => {
    const [rule] = [{ pattern: "^(\\d+)\\s*[-_ ]\\s*(.+)$", template: "{name} (part {n})" }];
    expect(chapterFromFilename("12 - The Long Night.mp3", [rule]).title).toBe("The Long Night (part 12)");
  });
});

describe("groupFilesIntoBooks", () => {
  const single = file({
    path: "/books/dune/Dune.m4b",
    ext: "m4b",
    duration: 7200,
    title: "Dune",
    artist: "Frank Herbert",
    album: "Dune",
    hasCover: true,
    chapters: [
      { title: "One", start: 0, duration: 3600 },
      { title: "Two", start: 3600, duration: 3600 },
    ],
  });

  it("creates one book per m4b with embedded chapters", () => {
    const books = groupFilesIntoBooks([single], { groupFolders: true, chapterRules: [] });
    expect(books).toHaveLength(1);
    expect(books[0].kind).toBe("single");
    expect(books[0].chapters).toHaveLength(2);
    expect(books[0].chapters[1].start).toBe(3600);
    expect(books[0].duration).toBe(7200);
  });

  it("groups loose mp3s in a folder into one book with offsets", () => {
    const files = [
      file({ path: "/books/dune/01 - Chapter 1.mp3", duration: 100 }),
      file({ path: "/books/dune/02 - Chapter 2.mp3", duration: 200 }),
      file({ path: "/books/dune/10 - Chapter 10.mp3", duration: 300 }),
    ];
    const [multi] = groupFilesIntoBooks(files, { groupFolders: true, chapterRules: [] });
    expect(multi.kind).toBe("multi");
    expect(multi.chapters.map((c) => c.start)).toEqual([0, 100, 300]);
    expect(multi.duration).toBe(600);
    expect(multi.title).toBe("dune");
  });

  it("keeps files as separate books when grouping is off", () => {
    const files = [
      file({ path: "/books/a/one.mp3", duration: 10 }),
      file({ path: "/books/a/two.mp3", duration: 20 }),
    ];
    const books = groupFilesIntoBooks(files, { groupFolders: false, chapterRules: [] });
    expect(books).toHaveLength(2);
    expect(books.map((b) => b.kind)).toEqual(["single", "single"]);
  });

  it("preserves progress and ids of previously known books", () => {
    const first = groupFilesIntoBooks([single], { groupFolders: true, chapterRules: [] });
    const withProgress: Book[] = [{ ...first[0], progress: 900, favorite: true, tags: ["toread"] }];
    const again = groupFilesIntoBooks([{ ...single, duration: 7300 }], {
      groupFolders: true,
      chapterRules: [],
      existing: withProgress,
    });
    expect(again[0].id).toBe(first[0].id);
    expect(again[0].progress).toBe(900);
    expect(again[0].favorite).toBe(true);
    expect(again[0].duration).toBe(7300);
  });
});

describe("chapter editing", () => {
  const chapters = [
    { id: "a", index: 1, title: "A", start: 0, duration: 100 },
    { id: "b", index: 2, title: "B", start: 100, duration: 100 },
    { id: "c", index: 3, title: "C", start: 200, duration: 100 },
  ];

  it("recomputes offsets after a reorder", () => {
    const moved = moveChapter(chapters, 2, 0);
    expect(moved.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(moved.map((c) => c.start)).toEqual([0, 100, 200]);
    expect(moved.map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it("merges and splits chapters", () => {
    const merged = mergeChapters(chapters, 0);
    expect(merged).toHaveLength(2);
    expect(merged[0].duration).toBe(200);
    const split = splitChapter(chapters, 1, 40);
    expect(split).toHaveLength(4);
    expect(split[1].duration).toBe(40);
    expect(split[2].title).toContain("part 2");
  });

  it("relayout is stable", () => {
    expect(relayoutChapters(chapters).map((c) => c.start)).toEqual([0, 100, 200]);
    expect(reindexChapters(chapters).map((c) => c.index)).toEqual([1, 2, 3]);
  });

  it("finds the chapter for a position", () => {
    expect(chapterAt(chapters, 0)).toBe(0);
    expect(chapterAt(chapters, 150)).toBe(1);
    expect(chapterAt(chapters, 999)).toBe(2);
  });
});

describe("book level operations", () => {
  it("splits a multi book into one book per chapter", () => {
    const base = buildMultiBook(
      [
        file({ path: "/books/x/01 a.mp3", duration: 5 }),
        file({ path: "/books/x/02 b.mp3", duration: 5 }),
      ],
      "bk1",
      Date.now(),
      [],
    );
    const parts = splitBookIntoBooks(base);
    expect(parts).toHaveLength(2);
    expect(parts[0].chapters).toHaveLength(1);
    expect(parts[0].sourcePath).toBe("/books/x/01 a.mp3");
  });

  it("merges books and dedupes by source path", () => {
    const a = book({ id: "1", title: "A", sourcePath: "/a" });
    const b = book({ id: "2", title: "B", sourcePath: "/b" });
    const merged = mergeBooks([a, b]);
    expect(merged.kind).toBe("multi");
    expect(merged.chapters).toHaveLength(2);
    expect(dedupeBooks([a, { ...a, updatedAt: 5 }])).toHaveLength(1);
  });
});

describe("sorting and filtering", () => {
  const books = [
    book({ id: "1", title: "Zeta", author: "B", addedAt: 3, progress: 100, duration: 100, series: "S", seriesIndex: 2 }),
    book({ id: "2", title: "alpha", author: "A", addedAt: 1, progress: 0, duration: 100, favorite: true, tags: ["t"] }),
    book({ id: "3", title: "Beta", author: "C", addedAt: 2, series: "S", seriesIndex: 1 }),
  ];

  it("sorts by title and author", () => {
    expect(sortBooks(books, "title").map((b) => b.id)).toEqual(["2", "3", "1"]);
    expect(sortBooks(books, "author").map((b) => b.id)).toEqual(["2", "1", "3"]);
  });

  it("sorts series numerically", () => {
    // books without a series sort last
    expect(sortBooks(books, "series").map((b) => b.id)).toEqual(["3", "1", "2"]);
  });

  it("filters by query, tag and favorite", () => {
    expect(filterBooks(books, { text: "alp" }).map((b) => b.id)).toEqual(["2"]);
    expect(filterBooks(books, { favorite: true }).map((b) => b.id)).toEqual(["2"]);
    expect(filterBooks(books, { tag: "t" }).length).toBe(1);
    expect(filterBooks(books, { finished: true }).map((b) => b.id)).toEqual(["1"]);
  });

  it("returns facet counts sorted by popularity", () => {
    const facets = facetCounts(books);
    expect(facets.authors[0]).toEqual(["A", 1]);
    expect(facets.series.map(([name]) => name)).toEqual(["S"]);
  });
});

describe("book file helpers", () => {
  const single: Book = {
    id: "b1",
    title: "Dune",
    author: "Frank Herbert",
    genres: [],
    sourcePath: "/books/dune.m4b",
    kind: "single",
    chapters: [{ id: "c1", index: 1, title: "Dune", start: 0, duration: 100 }],
    duration: 100,
    tags: [],
    favorite: false,
    progress: 0,
    addedAt: 1,
    updatedAt: 1,
    sizeBytes: 1234,
  };

  it("returns the container file for single-file books", () => {
    expect(bookFiles(single)).toEqual(["/books/dune.m4b"]);
    expect(bookPrimaryFile(single)).toBe("/books/dune.m4b");
    expect(bookSizeBytes(single)).toBe(1234);
  });

  it("returns chapter files in order for folder books, without duplicates", () => {
    const multi: Book = {
      ...single,
      id: "b2",
      kind: "multi",
      sourcePath: "/books/neuromancer",
      chapters: [
        { id: "c1", index: 1, title: "One", start: 0, duration: 10, file: "/books/neuromancer/01.mp3" },
        { id: "c2", index: 2, title: "Two", start: 10, duration: 10, file: "/books/neuromancer/02.mp3" },
        { id: "c3", index: 3, title: "Three", start: 20, duration: 10, file: "/books/neuromancer/02.mp3" },
      ],
    };
    expect(bookFiles(multi)).toEqual(["/books/neuromancer/01.mp3", "/books/neuromancer/02.mp3"]);
    expect(bookPrimaryFile(multi)).toBe("/books/neuromancer/01.mp3");
  });

  it("falls back to the source path when a multi book has no per-chapter files", () => {
    const multi: Book = { ...single, kind: "multi", sourcePath: "/books/multi", chapters: [
      { id: "c1", index: 1, title: "Only", start: 0, duration: 10 },
    ] };
    expect(bookFiles(multi)).toEqual(["/books/multi"]);
  });

  it("never returns empty strings", () => {
    const empty: Book = { ...single, sourcePath: "", chapters: [] };
    expect(bookFiles(empty)).toEqual([]);
    expect(bookPrimaryFile(empty)).toBe("");
  });
});

describe("timestamps", () => {
  it("widens seconds written by the Python tools into milliseconds", () => {
    const normalized = normalizeBook(book({ id: "bk_py", title: "From Python", addedAt: 1789428286.76 }));
    expect(normalized.addedAt).toBeCloseTo(1789428286760, 0);
    expect(new Date(normalized.addedAt).getFullYear()).toBe(2026);
  });

  it("keeps milliseconds as they are, and leaves an unplayed book unplayed", () => {
    const kept = normalizeBook(book({ id: "bk_ms", title: "Milliseconds", addedAt: 1789428286760, lastPlayedAt: 0 }));
    expect(kept.addedAt).toBe(1789428286760);
    expect(kept.lastPlayedAt).toBe(0);
    expect(normalizeBook(book({ id: "bk_new", title: "Never played" })).lastPlayedAt).toBeUndefined();
  });
});

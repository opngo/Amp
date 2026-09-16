/**
 * The library.json file is an interface between the Electron app, the Python
 * server and whoever edits it by hand, so the reader has to cope with a book
 * that only carries the fields the writer knew about.
 */

import { describe, expect, it } from "vitest";
import { matchesQuery, normalizeLibrary } from "../library";
import type { Book } from "../types";

const partial = {
  id: "bk_1",
  title: "Piranesi",
  author: "Susanna Clarke",
  sourcePath: "/books/Piranesi",
  kind: "multi",
  chapters: [
    { id: "ch_1", index: 1, title: "Chapter 01", start: 0, duration: 12, file: "/books/Piranesi/01.wav" },
  ],
  duration: 12,
  // tags / genres / favorite / addedAt are missing on purpose
} as unknown as Book;

describe("normalizeLibrary", () => {
  it("fills in the arrays and numbers a stored library may be missing", () => {
    const state = normalizeLibrary({ books: [partial], folders: [], playlists: [] });
    const book = state.books[0];
    expect(book.tags).toEqual([]);
    expect(book.genres).toEqual([]);
    expect(book.favorite).toBe(false);
    expect(book.progress).toBe(0);
    expect(typeof book.addedAt).toBe("number");
    expect(state.bookmarks).toEqual([]);
    expect(state.queue).toEqual([]);
  });

  it("survives an empty payload", () => {
    const state = normalizeLibrary(null);
    expect(state.books).toEqual([]);
    expect(state.folders).toEqual([]);
  });

  it("keeps the values that are there", () => {
    const state = normalizeLibrary({ books: [{ ...partial, genres: ["Fantasy"], favorite: true } as Book] });
    expect(state.books[0].genres).toEqual(["Fantasy"]);
    expect(state.books[0].favorite).toBe(true);
  });
});

describe("matchesQuery", () => {
  it("does not throw on a book without tags or genres", () => {
    const book = normalizeLibrary({ books: [partial] }).books[0];
    expect(matchesQuery(book, "piranesi")).toBe(true);
    expect(matchesQuery(book, "clarke")).toBe(true);
    expect(matchesQuery(book, "dune")).toBe(false);
  });
});

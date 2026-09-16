/**
 * The books a page is allowed to show.
 *
 * A locked folder hides its contents: that is the whole point of the lock, and
 * it has to hold everywhere a book is listed - the library, the facets, the
 * search - or the shelf is only hidden until somebody looks sideways. Books in
 * a locked folder come back the moment the folder is unlocked for the session.
 */

import { useMemo } from "react";
import type { Book, Folder } from "@amp/core";
import { useLibraryStore } from "../store/useLibraryStore";
import { useUiStore } from "../store/useUiStore";

/** Folder ids whose contents are out of sight right now. */
export function hiddenFolderIds(folders: Folder[], unlocked: string[]): Set<string> {
  const hidden = new Set<string>();
  const locked = folders.filter((folder) => folder.locked && !unlocked.includes(folder.id));
  for (const folder of locked) {
    hidden.add(folder.id);
    // Everything under a locked folder is hidden too, or the book inside the
    // nested shelf would be the one that gives it away.
    let frontier = folders.filter((item) => item.parentId === folder.id);
    while (frontier.length) {
      for (const child of frontier) hidden.add(child.id);
      frontier = folders.filter((item) => item.parentId && hidden.has(item.parentId) && !hidden.has(item.id));
    }
  }
  return hidden;
}

export function filterHiddenBooks(books: Book[], folders: Folder[], unlocked: string[]): Book[] {
  const hidden = hiddenFolderIds(folders, unlocked);
  if (hidden.size === 0) return books;
  return books.filter((book) => !book.folderId || !hidden.has(book.folderId));
}

export function useVisibleBooks(): Book[] {
  const books = useLibraryStore((s) => s.state.books);
  const folders = useLibraryStore((s) => s.state.folders);
  const unlocked = useUiStore((s) => s.unlocked);
  return useMemo(() => filterHiddenBooks(books, folders, unlocked), [books, folders, unlocked]);
}

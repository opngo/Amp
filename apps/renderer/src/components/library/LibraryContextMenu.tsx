/**
 * The right-click menu for a book.
 *
 * This used to be a reshaped DropdownMenu pinned to the pointer with
 * `originCoordinates`, and after the round-6 change - where a right click
 * stopped selecting the book - it stopped appearing at all in some views: the
 * store said the menu was open while nothing was drawn. It is now a plain panel
 * this app owns: fixed at the pointer, clamped to the window, scrollable, and
 * closed by Escape, by a click anywhere else, or by picking something. No
 * library internals decide whether it is visible.
 *
 * Groups are drawn inline (Organise, Metadata, File) rather than as fly-out
 * submenus, because a menu that opens sideways over the thing you right-clicked
 * is a menu you have to chase.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  CheckCheck,
  Copy,
  FileImage,
  FolderInput,
  FolderOpen,
  Heart,
  Info,
  ListEnd,
  ListMusic,
  ListPlus,
  ListTree,
  Pause,
  Play,
  Plus,
  Scissors,
  Shuffle,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { COLOR_TAGS, formatTime, isFinished, mergeBooks, splitBookIntoBooks } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { getBridge } from "../../platform/bridge";
import { colorHex } from "../layout/Sidebar";

/** Tags the menu offers on top of the ones a book already carries. */
const KNOWN_TAGS = ["to read", "favourite series", "lent out", "reference"];

export function LibraryContextMenu() {
  const contextMenu = useUiStore((s) => s.contextMenu);
  const close = useUiStore((s) => s.closeContextMenu);
  const openDialog = useUiStore((s) => s.openDialog);
  const toast = useUiStore((s) => s.toast);
  const books = useLibraryStore((s) => s.state.books);
  const folders = useLibraryStore((s) => s.state.folders);
  const moveToFolder = useLibraryStore((s) => s.moveToFolder);
  const moveBook = useLibraryStore((s) => s.moveBook);
  const removeBooks = useLibraryStore((s) => s.removeBooks);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const markFinished = useLibraryStore((s) => s.markFinished);
  const patchBook = useLibraryStore((s) => s.patchBook);
  const addToQueue = useLibraryStore((s) => s.addToQueue);
  const setTag = useLibraryStore((s) => s.setTag);
  const setColor = useLibraryStore((s) => s.setColor);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const playlists = useLibraryStore((s) => s.state.playlists);
  const loadBook = usePlayerStore((s) => s.loadBook);
  const seekChapter = usePlayerStore((s) => s.seekChapter);
  const chapterStopFor = usePlayerStore((s) => s.chapterStopFor);
  const isPlaying = usePlayerStore((s) => s.state.bookId === (contextMenu?.kind === "book" ? contextMenu.bookId : null));

  const book = contextMenu?.kind === "book" ? books.find((b) => b.id === contextMenu.bookId) : undefined;

  // Escape and outside clicks close it. The listener is on the document, in the
  // capture phase, so nothing underneath can swallow it first.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (panel.current && !panel.current.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu, close]);

  const placement = useMemo(() => {
    if (!contextMenu) return { left: 0, top: 0 };
    const width = 300;
    const height = Math.min(window.innerHeight - 24, 560);
    return {
      left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - height - 8)),
    };
  }, [contextMenu]);

  if (!contextMenu || contextMenu.kind !== "book" || !book) return null;

  const run = (fn: () => void | Promise<unknown>) => {
    void Promise.resolve(fn()).finally(close);
  };

  return (
    <div className="amp-menu-scrim" role="presentation" onContextMenu={(event) => event.preventDefault()}>
      <div
        ref={panel}
        className="amp-menu amp-menu-book"
        role="menu"
        aria-label={`Actions for ${book.title}`}
        style={{ left: placement.left, top: placement.top }}
      >
        <div className="amp-menu-head">
          <span className="amp-menu-head-title">{book.title}</span>
          <span className="amp-menu-head-sub">
            {book.author}
            {` - ${book.chapters.length} chapter${book.chapters.length === 1 ? "" : "s"}`}
          </span>
        </div>

        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => loadBook(book, { position: 0, autoplay: true }))}>
          <Play size={15} />
          Play from the start
        </button>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => loadBook(book, { autoplay: true }))}>
          <Undo2 size={15} />
          Resume where I left off
        </button>
        {isPlaying && (
          <button className="amp-menu-item" role="menuitem" onClick={() => run(() => usePlayerStore.getState().pause())}>
            <Pause size={15} />
            Pause
          </button>
        )}
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => addToQueue(book.id))}>
          <ListEnd size={15} />
          Add to queue
        </button>

        {book.chapters.length > 1 && (
          <>
            <p className="amp-menu-group">Jump to chapter</p>
            <div className="amp-menu-scroll">
              {book.chapters.map((chapter, index) => {
                const stop = index === book.chapters.length ? null : chapterStopFor(index);
                return (
                  <button
                    key={chapter.id}
                    className="amp-menu-item amp-menu-item-compact"
                    role="menuitem"
                    onClick={() =>
                      run(async () => {
                        if (!isPlaying) await loadBook(book, { position: chapter.start, autoplay: true });
                        else await seekChapter(index);
                      })
                    }
                  >
                    <span className="amp-menu-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="amp-menu-item-title">{chapter.title}</span>
                    <span className="amp-menu-item-tail">
                      {stop === null ? formatTime(chapter.duration) : `continue -${formatTime(Math.max(0, chapter.duration - stop))}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <p className="amp-menu-group">Organise</p>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => moveBook(book.id, -1))}>
          <ArrowUp size={15} />
          Move up
        </button>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => moveBook(book.id, 1))}>
          <ArrowDown size={15} />
          Move down
        </button>
        <div className="amp-menu-row">
          <span className="amp-menu-row-label">Colour</span>
          <span className="amp-menu-swatches">
            {COLOR_TAGS.map((tag) => (
              <button
                key={tag.value}
                className="amp-swatch"
                data-active={book.color === tag.value}
                style={{ background: colorHex(tag.value) }}
                title={tag.label}
                aria-label={tag.label}
                onClick={() => run(() => setColor([book.id], book.color === tag.value ? null : tag.value))}
              />
            ))}
            <button className="amp-swatch amp-swatch-none" data-active={!book.color} onClick={() => run(() => setColor([book.id], null))} title="No colour" aria-label="No colour" />
          </span>
        </div>
        <div className="amp-menu-row">
          <span className="amp-menu-row-label">Tags</span>
          <span className="amp-menu-chips">
            {[...new Set([...book.tags, ...KNOWN_TAGS])].map((tag) => (
              <button
                key={tag}
                className="amp-menu-chip"
                data-active={book.tags.includes(tag)}
                onClick={() => run(() => setTag(book.id, tag, !book.tags.includes(tag)))}
              >
                {tag}
              </button>
            ))}
          </span>
        </div>
        <p className="amp-menu-group">Move to folder</p>
        <div className="amp-menu-scroll amp-menu-scroll-short">
          <button className="amp-menu-item" role="menuitem" onClick={() => run(() => moveToFolder([book.id], null))}>
            <FolderOpen size={15} />
            No folder
          </button>
          {folders.map((folder) => (
            <button
              key={folder.id}
              className="amp-menu-item"
              role="menuitem"
              data-active={book.folderId === folder.id}
              style={{ paddingLeft: 10 + depthOf(folders, folder.id) * 14 }}
              onClick={() => run(() => moveToFolder([book.id], folder.id))}
            >
              <FolderInput size={15} />
              {folder.name}
              {book.folderId === folder.id && <Check size={14} className="amp-menu-check" />}
            </button>
          ))}
          <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "newFolder" }))}>
            <Plus size={15} />
            New folder…
          </button>
        </div>
        <p className="amp-menu-group">Playlists</p>
        <div className="amp-menu-scroll amp-menu-scroll-short">
          <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "newPlaylist", bookIds: [book.id] }))}>
            <Plus size={15} />
            New playlist…
          </button>
          {playlists.map((playlist) => {
            const inside = playlist.bookIds.includes(book.id);
            return (
              <button
                key={playlist.id}
                className="amp-menu-item"
                role="menuitem"
                onClick={() =>
                  run(() =>
                    useLibraryStore.getState().updatePlaylist(playlist.id, {
                      bookIds: inside
                        ? playlist.bookIds.filter((id) => id !== book.id)
                        : [...playlist.bookIds, book.id],
                    }),
                  )
                }
              >
                {inside ? <Check size={15} /> : <ListPlus size={15} />}
                {inside ? `Remove from ${playlist.name}` : `Add to ${playlist.name}`}
              </button>
            );
          })}
          <button
            className="amp-menu-item"
            role="menuitem"
            onClick={() =>
              run(async () => {
                const library = useLibraryStore.getState();
                // A new list holding this book plus the rest of the library,
                // shuffled, with the queue replaced so Next follows it.
                const mates = library.state.books.map((item) => item.id).filter((id) => id !== book.id);
                const playlist = await createPlaylist(`${book.title} shuffle`, [book.id, ...mates.slice(0, 24)]);
                await library.updatePlaylist(playlist.id, { shuffled: true });
                await usePlayerStore.getState().playQueue(playlist.bookIds, { shuffle: true });
                toast({ title: "Shuffled into a new playlist", tone: "success" });
              })
            }
          >
            <Shuffle size={15} />
            New playlist, shuffled
          </button>
        </div>

        <p className="amp-menu-group">Metadata</p>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => toggleFavorite(book.id))}>
          <Heart size={15} />
          {book.favorite ? "Remove from favourites" : "Add to favourites"}
        </button>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => markFinished(book.id, !isFinished(book)))}>
          <CheckCheck size={15} />
          {isFinished(book) ? "Mark as unplayed" : "Mark as finished"}
        </button>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "editBook", bookId: book.id }))}>
          <Info size={15} />
          Edit metadata
        </button>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "chapters", bookId: book.id }))}>
          <ListTree size={15} />
          Edit chapters
        </button>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "coverSearch", bookId: book.id }))}>
          <FileImage size={15} />
          Cover art
        </button>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "bookmarks", bookId: book.id }))}>
          <Bookmark size={15} />
          Bookmarks
        </button>
        <button className="amp-menu-item" role="menuitem" onClick={() => run(() => openDialog({ kind: "transcribe", bookId: book.id }))}>
          <Sparkles size={15} />
          Transcribe with Whisper
        </button>

        <p className="amp-menu-group">File</p>
        <button
          className="amp-menu-item"
          role="menuitem"
          onClick={() =>
            run(async () => {
              if (book.chapters.length <= 1) {
                toast({ title: "Nothing to split - the book has one chapter", tone: "info" });
                return;
              }
              const parts = splitBookIntoBooks(book);
              await removeBooks([book.id]);
              const library = useLibraryStore.getState();
              useLibraryStore.setState({ state: { ...library.state, books: [...library.state.books, ...parts] } });
              await library.persist();
              toast({ title: `Split into ${parts.length} books`, tone: "success" });
            })
          }
        >
          <Scissors size={15} />
          Split into separate books
        </button>
        <button
          className="amp-menu-item"
          role="menuitem"
          onClick={() =>
            run(async () => {
              const merged = mergeBooks([book]);
              await patchBook(book.id, { kind: "multi", chapters: merged.chapters, duration: merged.duration });
              toast({ title: "Chapters re-glued into one book", tone: "success" });
            })
          }
        >
          <ListMusic size={15} />
          Group chapters as one book
        </button>
        <button
          className="amp-menu-item"
          role="menuitem"
          onClick={() =>
            run(async () => {
              const host = await getBridge();
              await host.library.revealInFolder(book.sourcePath);
            })
          }
        >
          <FolderOpen size={15} />
          Show in file manager
        </button>
        <button
          className="amp-menu-item"
          role="menuitem"
          onClick={() =>
            run(() => {
              void navigator.clipboard?.writeText(book.sourcePath);
              toast({ title: "Path copied", tone: "success" });
            })
          }
        >
          <Copy size={15} />
          Copy the file path
        </button>
        <p className="amp-menu-group">Remove</p>
        <button
          className="amp-menu-item amp-menu-item-danger"
          role="menuitem"
          onClick={() =>
            run(async () => {
              await removeBooks([book.id]);
              toast({ title: `${book.title} removed from the library`, tone: "info" });
            })
          }
        >
          <Trash2 size={15} />
          Remove from the library
        </button>
      </div>
    </div>
  );
}

/** How far a folder sits from the top level, for the indent in the list. */
function depthOf(folders: { id: string; parentId?: string | null }[], id: string): number {
  let depth = 0;
  let current = folders.find((folder) => folder.id === id);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    current = folders.find((folder) => folder.id === current?.parentId);
    depth += 1;
    if (depth > 24) break;
  }
  return depth;
}

/**
 * The line at the end of the library toolbar saying how the shelf is ordered.
 *
 * It lives beside the menu because both answer the same question - why am I
 * looking at these books - and it keeps the toolbar from growing a second row.
 */
export function SortHint() {
  const sort = useLibraryStore((s) => s.sort);
  const filter = useLibraryStore((s) => s.filter);
  const folders = useLibraryStore((s) => s.state.folders);
  const folder = folders.find((item) => item.id === filter.folderId);
  const parts = [SORT_LABEL[sort.key] ?? "My order", sort.direction === "asc" ? "A to Z" : "Z to A"];
  if (folder) parts.push(`in ${folder.name}`);
  if (filter.text) parts.push(`matching "${filter.text}"`);
  return <span className="amp-sort-hint">{parts.join(" - ")}</span>;
}

const SORT_LABEL: Record<string, string> = {
  manual: "My order",
  added: "Recently added",
  lastPlayed: "Recently played",
  title: "Title",
  author: "Author",
  duration: "Length",
  progress: "Progress",
  series: "Series",
  year: "Year",
};

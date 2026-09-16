/**
 * The library itself: every book, with the tools to narrow it down.
 *
 * Home already answers "what should I listen to next", so this page is the
 * collection: filters across the top, one grid or list of everything below, and
 * a right-click menu for the per-book actions. Nothing is shown twice here, and
 * an empty result says why instead of leaving a blank page.
 */

import { useMemo } from "react";
import {
  ArrowDownWideNarrow,
  BookOpen,
  ArrowUpNarrowWide,
  Clock,
  Grid2x2,
  Heart,
  ListPlus,
  Play,
  Rows3,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  COLOR_TAGS,
  filterBooks,
  folderScope,
  formatDuration,
  sortBooks,
  type Book,
  type SortKey,
} from "@amp/core";
import { useVisibleBooks } from "../../hooks/useVisibleBooks";
import { SortHint } from "./LibraryContextMenu";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { useIsNarrow } from "../../hooks/useMediaQuery";
import { AddMenu } from "./AddMenu";
import { BookCard } from "./BookCard";
import { BookListRow } from "./BookListRow";
import { EmptyState } from "../common/EmptyState";
import { colorHex } from "../layout/Sidebar";

const SORT_LABELS: { value: SortKey; label: string }[] = [
  { value: "manual", label: "My order" },
  { value: "added", label: "Recently added" },
  { value: "lastPlayed", label: "Recently played" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "series", label: "Series" },
  { value: "duration", label: "Length" },
  { value: "progress", label: "Progress" },
  { value: "year", label: "Year" },
];

export function LibraryView() {
  const state = useLibraryStore((s) => s.state);
  const folders = state.folders;
  // Locked shelves are out of sight until they are unlocked.
  const books = useVisibleBooks();
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const sort = useLibraryStore((s) => s.sort);
  const setSort = useLibraryStore((s) => s.setSort);
  const view = useLibraryStore((s) => s.view);
  const setView = useLibraryStore((s) => s.setView);
  const importFromDialog = useLibraryStore((s) => s.importFromDialog);
  const removeBooks = useLibraryStore((s) => s.removeBooks);
  const addToQueue = useLibraryStore((s) => s.addToQueue);
  const selection = useUiStore((s) => s.selection);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const openDialog = useUiStore((s) => s.openDialog);
  const toast = useUiStore((s) => s.toast);
  const loadBook = usePlayerStore((s) => s.loadBook);
  const unlocked = useUiStore((s) => s.unlocked);
  const narrow = useIsNarrow();

  // Folders include what is nested inside them, and a locked folder's books are
  // not shown at all until it is unlocked.
  /*
   * A locked folder is locked from the whole library, not just from its own
   * card. Hiding the shelf while the books on it stay in every list would be a
   * lock that opens with the first click somewhere else.
   */
  const hiddenFolders = useMemo(
    () => new Set(folders.filter((folder) => folder.locked && !unlocked.includes(folder.id)).map((folder) => folder.id)),
    [folders, unlocked],
  );
  const listed = useMemo(
    () => (hiddenFolders.size === 0 ? books : books.filter((book) => !book.folderId || !hiddenFolders.has(book.folderId))),
    [books, hiddenFolders],
  );

  const folderIds = useMemo(() => {
    const id = filter.folderId;
    if (!id || id === "all") return undefined;
    return [...folderScope(folders, id)];
  }, [filter.folderId, folders]);

  const visible = useMemo(
    () =>
      sortBooks(
        filterBooks(listed, {
          ...filter,
          folderId: undefined,
          folderIds,
          text: filter.text,
          tag: filter.tag ?? undefined,
          favorite: filter.favorite || undefined,
          inProgress: filter.inProgress || undefined,
          author: filter.author ?? undefined,
          narrator: filter.narrator ?? undefined,
          series: filter.series ?? undefined,
          genre: filter.genre ?? undefined,
          color: filter.color ?? undefined,
        }),
        sort.key,
        sort.direction,
      ),
    [listed, filter, sort, folderIds],
  );

  const activeFacets = [
    filter.author && { label: `Author: ${filter.author}`, clear: () => setFilter({ author: null }) },
    filter.narrator && { label: `Narrator: ${filter.narrator}`, clear: () => setFilter({ narrator: null }) },
    filter.series && { label: `Series: ${filter.series}`, clear: () => setFilter({ series: null }) },
    filter.genre && { label: `Genre: ${filter.genre}`, clear: () => setFilter({ genre: null }) },
    filter.color && {
      label: COLOR_TAGS.find((tag) => tag.value === filter.color)?.label ?? filter.color,
      clear: () => setFilter({ color: null }),
    },
    filter.tag && { label: filter.tag, clear: () => setFilter({ tag: null }) },
    filter.text && { label: `"${filter.text}"`, clear: () => setFilter({ text: "" }) },
    filter.folderId !== "all" && {
      label: state.folders.find((folder) => folder.id === filter.folderId)?.name ?? "Folder",
      clear: () => setFilter({ folderId: "all" }),
    },
  ].filter((entry): entry is { label: string; clear: () => void } => Boolean(entry));

  const totalSeconds = books.reduce((acc, book) => acc + book.duration, 0);
  const span = totalSeconds >= 3600 ? `${Math.round((totalSeconds / 3600) * 10) / 10} hours` : formatDuration(totalSeconds);
  const queueAll = async () => {
    for (const book of visible.slice(0, 100)) await addToQueue(book.id);
    toast({ title: `${Math.min(visible.length, 100)} book(s) queued`, tone: "success" });
  };

  if (books.length === 0) {
    return (
      <div className="amp-page">
        <EmptyState
          icon={BookOpen}
          title="Nothing here yet"
          description="Amp reads the audiobooks already on this computer. Add a folder and it works out the rest: m4b files keep their embedded chapters, and a folder of mp3 or mp4 tracks becomes one book with many chapters - or separate books, your choice in Settings."
          actionLabel="Add a folder"
          onAction={() => void importFromDialog("folder")}
        />
        </div>
    );
  }

  return (
    <div className="amp-page">
      <header className="amp-page-header">
        <div>
          <h1 className="amp-page-title">{filter.folderId !== "all" ? "Folder" : "Library"}</h1>
          <p className="amp-page-subtitle">
            {visible.length} of {books.length} books - {span}
          </p>
        </div>
        <div className="amp-page-actions">
          <button className="amp-chip" onClick={() => visible[0] && void loadBook(visible[0], { position: visible[0].progress, autoplay: true })}>
            <Play size={14} />
            Play
          </button>
          <button className="amp-chip" onClick={() => void queueAll()}>
            <ListPlus size={14} />
            Queue
          </button>
          <AddMenu />
        </div>
      </header>

      <div className="amp-toolbar">
        <button
          className="amp-chip"
          data-active={filter.inProgress}
          onClick={() => setFilter({ inProgress: !filter.inProgress, favorite: false })}
        >
          <Clock size={13} />
          In progress
        </button>
        <button
          className="amp-chip"
          data-active={filter.favorite}
          onClick={() => setFilter({ favorite: !filter.favorite, inProgress: false })}
        >
          <Heart size={13} />
          Favourites
        </button>
        <span className="amp-toolbar-sep" />
        {COLOR_TAGS.map((tag) => (
          <button
            key={tag.value}
            type="button"
            className="amp-color-chip"
            data-active={filter.color === tag.value}
            title={`${tag.label} tag`}
            aria-label={`${tag.label} tag`}
            onClick={() => setFilter({ color: filter.color === tag.value ? null : tag.value })}
          >
            <span className="amp-dot" style={{ background: colorHex(tag.value) }} />
          </button>
        ))}
        <span className="amp-toolbar-end" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            className="amp-chip"
            onClick={() => setSort(sort.key, sort.direction === "asc" ? "desc" : "asc")}
            title="Reverse the order"
          >
            {sort.direction === "asc" ? <ArrowUpNarrowWide size={14} /> : <ArrowDownWideNarrow size={14} />}
          </button>
          <select
            aria-label="Sort by"
            className="amp-select"
            value={sort.key}
            onChange={(event) => setSort(event.target.value as SortKey)}
          >
            {SORT_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button className="amp-chip" data-active={view !== "list"} onClick={() => setView("grid")} title="Grid">
            <Grid2x2 size={14} />
          </button>
          <button className="amp-chip" data-active={view === "list"} onClick={() => setView("list")} title="List">
            <Rows3 size={14} />
          </button>
        </span>
      </div>

      {activeFacets.length > 0 && (
        <div className="amp-toolbar">
          {activeFacets.map((facet) => (
            <button key={facet.label} className="amp-chip" data-active onClick={facet.clear} title="Remove this filter">
              {facet.label}
              <X size={11} />
            </button>
          ))}
          <button className="amp-chip" onClick={() => setFilter({ text: "", author: null, narrator: null, series: null, genre: null, color: null, tag: null, favorite: false, inProgress: false, folderId: "all" })}>
            Clear all
          </button>
          <span className="amp-toolbar-end">
            <SortHint />
          </span>
        </div>
      )}

      {selection.length > 0 && (
        <div className="amp-selection">
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selection.length} selected</span>
          <button className="amp-chip" onClick={() => void queueAll()}>
            <ListPlus size={13} />
            Queue
          </button>
          <button className="amp-chip" onClick={() => openDialog({ kind: "newPlaylist", bookIds: selection })}>
            + Playlist
          </button>
          <button
            className="amp-chip"
            onClick={() => {
              void removeBooks(selection);
              clearSelection();
            }}
          >
            <Trash2 size={13} />
            Remove
          </button>
          <button className="amp-chip amp-toolbar-end" onClick={clearSelection}>
            Done
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nothing matches"
          description="No book in the library matches these filters. Clear them to see everything again."
          actionLabel="Clear filters"
          onAction={() =>
            setFilter({
              text: "",
              author: null,
              narrator: null,
              series: null,
              genre: null,
              color: null,
              tag: null,
              favorite: false,
              inProgress: false,
              folderId: "all",
            })
          }
        />
      ) : view === "list" || narrow ? (
        <div className="amp-list">
          {visible.map((book: Book) => (
            <BookListRow key={book.id} book={book} />
          ))}
        </div>
      ) : (
        <div className="amp-grid">
          {visible.map((book, index) => (
            <BookCard key={book.id} book={book} index={index} />
          ))}
        </div>
      )}

    </div>
  );
}

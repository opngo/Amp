/** Dense list row used by the list view and the queue/playlist screens. */

import { Text } from "reshaped";
import { GripVertical, Heart, MoreHorizontal, Pause, Play } from "lucide-react";
import { bookProgress, formatDuration, formatTime, timeAgo } from "@amp/core";
import type { Book } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { CoverArt } from "../common/CoverArt";

export function BookListRow({
  book,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  book: Book;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent) => void;
  onDragOver?: (event: React.DragEvent) => void;
  onDrop?: (event: React.DragEvent) => void;
}) {
  const playingId = usePlayerStore((s) => s.state.bookId);
  const playing = usePlayerStore((s) => s.state.playing);
  const loadBook = usePlayerStore((s) => s.loadBook);
  const toggle = usePlayerStore((s) => s.toggle);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const select = useUiStore((s) => s.select);
  const setRoute = useUiStore((s) => s.setRoute);
  const openContextMenu = useUiStore((s) => s.openContextMenu);
  const selected = useUiStore((s) => s.selectedBookId === book.id);
  const isCurrent = playingId === book.id;

  return (
    <div
      className="amp-row-line"
      data-selected={selected}
      data-playing={isCurrent}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu(book.id, event.clientX, event.clientY);
      }}
      onClick={() => {
        select(book.id);
        setRoute("library");
      }}
    >
      {draggable && <GripVertical size={14} style={{ opacity: 0.4 }} />}
      <div style={{ width: 46, flex: "0 0 auto" }}>
        <CoverArt book={book} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text variant="body-2" weight="semibold" maxLines={1}>
          {book.title}
        </Text>
        <Text variant="caption-1" color="neutral-faded" maxLines={1}>
          {book.author}
          {book.narrator ? ` - read by ${book.narrator}` : ""}
        </Text>
      </div>
      <div style={{ width: 130, flex: "0 0 auto" }}>
        <div className="amp-player-progress" style={{ height: 4 }}>
          <span style={{ width: `${bookProgress(book) * 100}%` }} />
        </div>
        <Text variant="caption-2" color="neutral-faded">
          {formatTime(book.progress)} / {formatDuration(book.duration)}
        </Text>
      </div>
      <Text variant="caption-2" color="neutral-faded" attributes={{ style: { width: 96, textAlign: "right" } }}>
        {timeAgo(book.lastPlayedAt)}
      </Text>
      <button
        type="button"
        className="amp-chip"
        style={{ padding: 7, color: isCurrent ? "var(--amp-tint)" : "var(--amp-text-2)" }}
        aria-label={isCurrent && playing ? "Pause" : "Play"}
        onClick={(event) => {
          event.stopPropagation();
          if (isCurrent) void toggle();
          else void loadBook(book, { autoplay: true });
        }}
      >
        {isCurrent && playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} />}
      </button>
      <button
        type="button"
        className="amp-chip"
        style={{ padding: 7, color: book.favorite ? "var(--amp-tint)" : "var(--amp-text-3)" }}
        aria-label={book.favorite ? "Remove from favourites" : "Add to favourites"}
        onClick={(event) => {
          event.stopPropagation();
          void toggleFavorite(book.id);
        }}
      >
        <Heart size={15} fill={book.favorite ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        className="amp-chip"
        style={{ padding: 7, color: "var(--amp-text-3)" }}
        aria-label="More actions"
        onClick={(event) => {
          event.stopPropagation();
          const native = event.nativeEvent as MouseEvent;
          openContextMenu(book.id, native.clientX ?? 0, native.clientY ?? 0);
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {book.series && (
        <span className="amp-book-meta" style={{ width: 92, textAlign: "right", flex: "0 0 auto" }}>
          {book.series}
          {book.seriesIndex ? ` #${book.seriesIndex}` : ""}
        </span>
      )}
    </div>
  );
}

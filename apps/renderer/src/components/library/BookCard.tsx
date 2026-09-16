/**
 * Library tile: square artwork, one hover play button, title, author, meta.
 * The shape is deliberately album-like - nothing is drawn over the cover until
 * you point at it.
 */

import { Check, Heart, Pause, Play } from "lucide-react";
import { bookProgress, formatDuration, isFinished } from "@amp/core";
import type { Book } from "@amp/core";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { CoverArt } from "../common/CoverArt";

export function BookCard({ book, index = 0 }: { book: Book; index?: number }) {
  const playingId = usePlayerStore((s) => s.state.bookId);
  const playing = usePlayerStore((s) => s.state.playing);
  const loadBook = usePlayerStore((s) => s.loadBook);
  const toggle = usePlayerStore((s) => s.toggle);
  const selected = useUiStore((s) => s.selection.includes(book.id));
  const toggleSelection = useUiStore((s) => s.toggleSelection);
  const select = useUiStore((s) => s.select);
  const setRoute = useUiStore((s) => s.setRoute);
  const openContextMenu = useUiStore((s) => s.openContextMenu);
  const isCurrent = playingId === book.id;
  const progress = bookProgress(book);
  const finished = isFinished(book);
  const remaining = book.duration > 0 ? Math.max(0, book.duration - book.progress) : 0;

  const activate = () => {
    if (isCurrent) void toggle();
    else void loadBook(book, { autoplay: true });
  };

  return (
    <div
      className="amp-book-card"
      data-playing={isCurrent}
      data-selected={selected}
      style={{ animationDelay: `${Math.min(index * 14, 200)}ms` }}
      onContextMenu={(event) => {
        event.preventDefault();
        openContextMenu(book.id, event.clientX, event.clientY);
      }}
      onClick={() => {
        select(book.id);
        setRoute("library");
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          select(book.id);
          setRoute("library");
        }
        if (event.key === " ") {
          event.preventDefault();
          toggleSelection(book.id, event.ctrlKey || event.metaKey);
        }
      }}
      aria-label={`${book.title} by ${book.author}`}
    >
      <div className="amp-book-cover">
        <CoverArt book={book} />

        <button
          type="button"
          className="amp-book-play"
          aria-label={isCurrent && playing ? `Pause ${book.title}` : `Play ${book.title}`}
          onClick={(event) => {
            event.stopPropagation();
            activate();
          }}
        >
          {isCurrent && playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>

        {selected && (
          <span
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              display: "grid",
              placeItems: "center",
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "var(--amp-tint)",
              color: "var(--amp-tint-ink)",
            }}
          >
            <Check size={13} strokeWidth={3} />
          </span>
        )}

        {book.favorite && !selected && (
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              color: "var(--amp-cover-icon)",
              filter: "var(--amp-cover-icon-shadow)",
            }}
          >
            <Heart size={14} fill="currentColor" />
          </span>
        )}
      </div>

      <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
        <span className="amp-book-title">{book.title}</span>
        <span className="amp-book-author">{book.author}</span>
        <span className="amp-book-meta">
          {finished
            ? `Finished - ${formatDuration(book.duration)}`
            : progress > 0.01
              ? `${formatDuration(remaining)} left`
              : `${formatDuration(book.duration)} - ${book.chapters.length} chapters`}
        </span>
      </div>
    </div>
  );
}

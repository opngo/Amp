/** Seek bar with chapter ticks, hover preview time and keyboard support. */

import { useRef, useState } from "react";
import { Text } from "reshaped";
import { formatTime } from "@amp/core";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useLibraryStore } from "../../store/useLibraryStore";

interface ScrubberProps {
  onSeek?: (seconds: number) => void;
  /** Show the elapsed / remaining labels under the bar (off inside the player bar). */
  times?: boolean;
}

export function Scrubber({ onSeek, times = true }: ScrubberProps) {
  const book = usePlayerStore((s) => s.book);
  const position = usePlayerStore((s) => s.state.position);
  const seek = usePlayerStore((s) => s.seek);
  const bookmarks = useLibraryStore((s) => s.state.bookmarks);
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; value: number } | null>(null);

  if (!book || book.duration <= 0) return null;
  const percent = Math.max(0, Math.min(100, (position / book.duration) * 100));

  const valueFromEvent = (clientX: number) => {
    const element = ref.current;
    if (!element) return 0;
    const rect = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * book.duration;
  };

  const commit = (clientX: number) => {
    const value = valueFromEvent(clientX);
    if (onSeek) onSeek(value);
    else seek(value);
  };

  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div
        ref={ref}
        className="amp-player-progress amp-scrub"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(book.duration)}
        aria-valuenow={Math.round(position)}
        tabIndex={0}
        onMouseMove={(event) => setHover({ x: event.clientX, value: valueFromEvent(event.clientX) })}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(event) => commit(event.clientX)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") seek(position + 10);
          if (event.key === "ArrowLeft") seek(position - 10);
          if (event.key === "Home") seek(0);
          if (event.key === "End") seek(book.duration - 1);
        }}
      >
        <span style={{ width: `${percent}%` }} />
        {book.chapters.map((chapter) => (
          <i
            key={chapter.id}
            title={chapter.title}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: `${(chapter.start / book.duration) * 100}%`,
              width: 1,
              background: "var(--amp-hairline-strong)",
              pointerEvents: "none",
            }}
          />
        ))}
        {bookmarks
          .filter((mark) => mark.bookId === book.id)
          .map((mark) => (
            <i
              key={mark.id}
              title={mark.label}
              style={{
                position: "absolute",
                top: -2,
                left: `${(mark.position / book.duration) * 100}%`,
                width: 3,
                height: 10,
                background: "var(--amp-accent-3)",
              }}
            />
          ))}
      </div>
      {times && (
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Text variant="caption-2" numeric color="neutral-faded">
            {formatTime(position)}
          </Text>
          {hover && (
            <Text variant="caption-2" numeric color="neutral-faded">
              {formatTime(hover.value)}
            </Text>
          )}
          <Text variant="caption-2" numeric color="neutral-faded">
            -{formatTime(Math.max(0, book.duration - position))}
          </Text>
        </div>
      )}
    </div>
  );
}

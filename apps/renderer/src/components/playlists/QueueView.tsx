/** The queue: drag to reorder, jump, remove, play next. */

import { Button, Divider, Select, Text } from "reshaped";
import { ListOrdered, Play, Shuffle, Trash2 } from "lucide-react";
import { formatDuration } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { BookListRow } from "../library/BookListRow";
import { EmptyState } from "../common/EmptyState";

export function QueueView() {
  const queue = useLibraryStore((s) => s.state.queue);
  const books = useLibraryStore((s) => s.state.books);
  const reorderQueue = useLibraryStore((s) => s.reorderQueue);
  const removeFromQueue = useLibraryStore((s) => s.removeFromQueue);
  const clearQueue = useLibraryStore((s) => s.clearQueue);
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const loadBook = usePlayerStore((s) => s.loadBook);
  const shuffle = usePlayerStore((s) => s.state.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const openDialog = useUiStore((s) => s.openDialog);
  const toast = useUiStore((s) => s.toast);

  const queued = queue
    .map((item) => ({ item, book: books.find((b) => b.id === item.bookId) }))
    .filter((entry): entry is { item: typeof entry.item; book: NonNullable<typeof entry.book> } => Boolean(entry.book));

  const totalSeconds = queued.reduce((acc, entry) => acc + entry.book.duration, 0);

  if (queued.length === 0) {
    return (
      <EmptyState
        icon={ListOrdered}
        title="Your queue is empty"
        description="Queue books from the library with the right-click menu, then Amp plays through them one after another - perfect for a series."
        actionLabel="Browse the library"
        onAction={() => useUiStore.getState().setRoute("library")}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 14, paddingBottom: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <Text variant="headline-3" weight="bold">
          Queue
        </Text>
        <Text variant="caption-1" color="neutral-faded">
          {queued.length} books - {formatDuration(totalSeconds)} of listening
        </Text>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Button
            size="small"
            color="primary"
            icon={Play}
            onClick={() => void loadBook(queued[0].book, { position: 0, autoplay: true })}
          >
            Play queue
          </Button>
          <Button
            size="small"
            variant={shuffle ? "solid" : "outline"}
            color={shuffle ? "primary" : "neutral"}
            icon={Shuffle}
            onClick={toggleShuffle}
          >
            Shuffle
          </Button>
          <Button
            size="small"
            variant="outline"
            onClick={() =>
              void createPlaylist(`Queue ${new Date().toLocaleDateString()}`, queued.map((entry) => entry.book.id)).then(
                () => toast({ title: "Queue saved as a playlist", tone: "success" }),
              )
            }
          >
            Save as playlist
          </Button>
          <Button
            size="small"
            variant="ghost"
            color="critical"
            icon={Trash2}
            onClick={() => void clearQueue()}
          >
            Clear
          </Button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        {queued.map((entry, index) => (
          <BookListRow
            key={entry.item.bookId}
            book={entry.book}
            draggable
            onDragStart={(event) => {
              window.__ampQueueDragIndex = index;
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={() => {
              const from = Number(window.__ampQueueDragIndex ?? index);
              void reorderQueue(from, index);
            }}
          />
        ))}
      </div>

      <Divider />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Text variant="caption-1" color="neutral-faded">
          Drag rows to reorder, or use the right-click menu.
        </Text>
        <Select name="queue-move" size="small" placeholder="Move first book to…" value="" onChange={({ value }) => void reorderQueue(0, Number(value))}>
          {queued.map((entry, index) => (
            <Select.Option key={entry.item.bookId} value={String(index)}>
              {`Position ${index + 1}`}
            </Select.Option>
          ))}
        </Select>
        <Button
          size="small"
          variant="ghost"
          onClick={() => openDialog({ kind: "newPlaylist", bookIds: queued.map((entry) => entry.book.id) })}
        >
          New playlist from queue
        </Button>
        <Button size="small" variant="ghost" onClick={() => void removeFromQueue(queued[queued.length - 1].book.id)}>
          Remove last
        </Button>
      </div>
    </div>
  );
}

import { useMemo } from "react";
/** Bookmarks for one book: jump, rename, delete - plus quick add at playhead. */

import { Button, Modal, Text, TextField } from "reshaped";
import { formatTime, timeAgo } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";

export function BookmarksDialog({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const book = useLibraryStore((s) => s.state.books.find((b) => b.id === bookId));
  const allBookmarks = useLibraryStore((s) => s.state.bookmarks);
  const bookmarks = useMemo(() => allBookmarks.filter((b) => b.bookId === bookId), [allBookmarks, bookId]);
  const removeBookmark = useLibraryStore((s) => s.removeBookmark);
  const updateBookmark = useLibraryStore((s) => s.updateBookmark);
  const addBookmark = usePlayerStore((s) => s.addBookmark);
  const seek = usePlayerStore((s) => s.seek);
  const position = usePlayerStore((s) => s.state.position);
  const isPlaying = usePlayerStore((s) => s.state.bookId === bookId);
  const toast = useUiStore((s) => s.toast);

  if (!book) return null;

  return (
    <Modal active onClose={onClose} size="600px" padding={6}>
      <Modal.Title>Bookmarks</Modal.Title>
      <Modal.Subtitle>{book.title}</Modal.Subtitle>
      <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        <Button
          color="primary"
          disabled={!isPlaying}
          onClick={() =>
            void addBookmark().then(() => toast({ title: "Bookmark added at the playhead", tone: "success" }))
          }
        >
          Add bookmark at {formatTime(position)}
        </Button>
      </div>
      <div style={{ display: "grid", gap: 8, maxHeight: 420, overflowY: "auto" }}>
        {bookmarks.length === 0 && (
          <Text variant="body-2" color="neutral-faded">
            No bookmarks yet. Press B while listening to drop one instantly.
          </Text>
        )}
        {bookmarks
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((bookmark) => (
            <div key={bookmark.id} className="amp-row-line" style={{ margin: 0 }}>
              <Text variant="caption-1" color="neutral-faded" attributes={{ style: { width: 64 } }}>
                {formatTime(bookmark.position)}
              </Text>
              <TextField
                name={`bm-${bookmark.id}`}
                value={bookmark.label}
                onChange={({ value }) => void updateBookmark(bookmark.id, { label: value })}
              />
              <Text variant="caption-2" color="neutral-faded" attributes={{ style: { width: 90 } }}>
                {timeAgo(bookmark.createdAt)}
              </Text>
              <div style={{ display: "flex", gap: 4 }}>
                <Button size="small" variant="outline" onClick={() => seek(bookmark.position)}>
                  Play
                </Button>
                <Button size="small" variant="ghost" onClick={() => void removeBookmark(bookmark.id)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
      </div>
    </Modal>
  );
}

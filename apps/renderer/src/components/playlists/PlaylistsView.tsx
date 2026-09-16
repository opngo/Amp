/**
 * Playlists: a list of books, in an order, with its own identity.
 *
 * Playing a playlist loads the whole thing as the queue, so Next and Previous
 * walk it. Shuffle is a first-class control here rather than a hidden setting:
 * press it and the queue is reordered before playback starts, and a playlist
 * can be marked to always start shuffled.
 */

import { Badge, Button, Divider, Text, TextField } from "reshaped";
import { ListMusic, Play, Plus, Shuffle, Trash2 } from "lucide-react";
import { formatDuration, type Book } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { BookListRow } from "../library/BookListRow";
import { EmptyState } from "../common/EmptyState";

export function PlaylistsView() {
  const playlists = useLibraryStore((s) => s.state.playlists);
  const books = useLibraryStore((s) => s.state.books);
  const updatePlaylist = useLibraryStore((s) => s.updatePlaylist);
  const removePlaylist = useLibraryStore((s) => s.removePlaylist);
  const playQueue = usePlayerStore((s) => s.playQueue);
  const openDialog = useUiStore((s) => s.openDialog);
  const selectPlaylist = useUiStore((s) => s.selectPlaylist);
  const toast = useUiStore((s) => s.toast);
  // The open playlist lives in the shell store so the sidebar highlights it and
  // both places switch together.
  const activeId = useUiStore((s) => s.selectedPlaylistId);

  const active = playlists.find((playlist) => playlist.id === activeId) ?? playlists[0];
  const activeBooks = active
    ? active.bookIds
        .map((id) => books.find((book) => book.id === id))
        .filter((book): book is Book => Boolean(book))
    : [];
  const totalSeconds = activeBooks.reduce((acc, book) => acc + book.duration, 0);

  if (playlists.length === 0) {
    return (
      <EmptyState
        icon={ListMusic}
        title="No playlists yet"
        description="Group books into playlists for moods, series or commutes. A playlist plays as a queue, in order or shuffled, and nothing is copied on disk."
        actionLabel="New playlist"
        onAction={() => openDialog({ kind: "newPlaylist" })}
      />
    );
  }

  const start = (shuffle: boolean) => {
    if (!active || activeBooks.length === 0) return;
    void playQueue(
      activeBooks.map((book) => book.id),
      { shuffle },
    );
  };

  return (
    <div className="amp-page">
      <header className="amp-page-header">
        <div>
          <h1 className="amp-page-title">Playlists</h1>
          <p className="amp-page-subtitle">
            {playlists.length} playlist{playlists.length === 1 ? "" : "s"}
            {active ? ` - ${activeBooks.length} books, ${formatDuration(totalSeconds)}` : ""}
          </p>
        </div>
        <div className="amp-page-actions">
          <Button size="small" variant="outline" icon={Plus} onClick={() => openDialog({ kind: "newPlaylist" })}>
            New playlist
          </Button>
          {active && (
            <>
              <Button size="small" color="primary" icon={Play} disabled={activeBooks.length === 0} onClick={() => start(false)}>
                Play
              </Button>
              <Button size="small" variant="outline" icon={Shuffle} disabled={activeBooks.length === 0} onClick={() => start(true)}>
                Shuffle
              </Button>
              <Button
                size="small"
                variant={active.shuffled ? "solid" : "outline"}
                color={active.shuffled ? "primary" : "neutral"}
                icon={Shuffle}
                disabled={activeBooks.length === 0}
                onClick={() => void updatePlaylist(active.id, { shuffled: !active.shuffled })}
              >
                Always shuffle
              </Button>
              <Button
                size="small"
                variant="ghost"
                color="critical"
                icon={Trash2}
                onClick={() => {
                  void removePlaylist(active.id);
                  selectPlaylist(null);
                }}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="amp-playlists-layout">
        <div className="amp-playlists">
          {playlists.map((playlist) => (
            <button
              key={playlist.id}
              className="amp-playlist-row"
              data-active={playlist.id === active?.id}
              onClick={() => selectPlaylist(playlist.id)}
            >
              <ListMusic size={15} />
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {playlist.name}
              </span>
              {playlist.shuffled && <Shuffle size={12} />}
              <span className="amp-nav-count">{playlist.bookIds.length}</span>
            </button>
          ))}
        </div>

        {active && (
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <TextField
                name="playlist-name"
                value={active.name}
                onChange={({ value }) => void updatePlaylist(active.id, { name: value })}
                attributes={{ style: { maxWidth: 260 } }}
              />
              <TextField
                name="playlist-description"
                placeholder="Description"
                value={active.description ?? ""}
                onChange={({ value }) => void updatePlaylist(active.id, { description: value })}
                attributes={{ style: { maxWidth: 300 } }}
              />
              <Badge size="small" variant="faded">
                {formatDuration(totalSeconds)}
              </Badge>
            </div>
            <Divider />
            {activeBooks.length === 0 ? (
              <Text variant="body-2" color="neutral-faded">
                This playlist is empty. Right-click any book and use Playlist to add it here.
              </Text>
            ) : (
              <div style={{ display: "grid", gap: 4 }}>
                {activeBooks.map((book) => (
                  <BookListRow
                    key={book.id}
                    book={book}
                    draggable
                    onDragStart={(event) => {
                      window.__ampPlaylistDragId = book.id;
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={() => {
                      // Dropping a row onto another reorders the list, which is
                      // the only editing a playlist needs.
                      const movedId = window.__ampPlaylistDragId;
                      if (!movedId || movedId === book.id) return;
                      const list = active.bookIds.filter((id) => id !== movedId);
                      const index = list.indexOf(book.id);
                      list.splice(index, 0, movedId);
                      void updatePlaylist(active.id, { bookIds: list });
                      toast({ title: "Playlist reordered", tone: "success" });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

import { useState } from "react";
import { Button, FormControl, Modal, Text, TextField } from "reshaped";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useUiStore } from "../../store/useUiStore";

export function NewPlaylistDialog({ bookIds = [], onClose }: { bookIds?: string[]; onClose: () => void }) {
  const createPlaylist = useLibraryStore((s) => s.createPlaylist);
  const books = useLibraryStore((s) => s.state.books);
  const toast = useUiStore((s) => s.toast);
  const [name, setName] = useState("");

  return (
    <Modal active onClose={onClose} size="440px" padding={6}>
      <Modal.Title>New playlist</Modal.Title>
      <Modal.Subtitle>
        {bookIds.length > 0 ? `${bookIds.length} book(s) will be added` : "Add books later from the library"}
      </Modal.Subtitle>
      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        <FormControl>
            <FormControl.Label>Playlist name</FormControl.Label>
          <TextField name="playlist" value={name} onChange={({ value }) => setName(value)} placeholder="Long flights" />
        </FormControl>
        {bookIds.length > 0 && (
          <Text variant="caption-1" color="neutral-faded">
            {bookIds
              .map((id) => books.find((b) => b.id === id)?.title)
              .filter(Boolean)
              .join(", ")}
          </Text>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="primary"
            disabled={!name.trim()}
            onClick={() => {
              void createPlaylist(name.trim(), bookIds).then(() => toast({ title: `Playlist "${name}" created`, tone: "success" }));
              onClose();
            }}
          >
            Create playlist
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Metadata editor: title, author, narrator, series, year, tags, folders.
 *
 * Artwork lives here too, because picking a cover or a banner is an edit to the
 * book, not a setting: the cover is the square identity, the banner is the wide
 * image a page is built around, and a book without one gets generated art.
 */

import { useEffect, useState } from "react";
import { Button, FormControl, Modal, Select, Text, TextField } from "reshaped";
import { ImageIcon, Sparkles } from "lucide-react";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useUiStore } from "../../store/useUiStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { BannerArt, BannerImage } from "../common/BannerArt";
import { CoverArt } from "../common/CoverArt";

export function EditBookDialog({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const book = useLibraryStore((s) => s.state.books.find((b) => b.id === bookId));
  const folders = useLibraryStore((s) => s.state.folders);
  const patchBook = useLibraryStore((s) => s.patchBook);
  const toast = useUiStore((s) => s.toast);
  const openDialog = useUiStore((s) => s.openDialog);
  const palette = useSettingsStore((s) => s.palette);
  const [draft, setDraft] = useState({
    title: "",
    author: "",
    narrator: "",
    series: "",
    seriesIndex: "",
    year: "",
    album: "",
    tags: "",
    description: "",
    folderId: "" as string,
  });

  useEffect(() => {
    if (!book) return;
    setDraft({
      title: book.title,
      author: book.author,
      narrator: book.narrator ?? "",
      series: book.series ?? "",
      seriesIndex: book.seriesIndex ? String(book.seriesIndex) : "",
      year: book.year ? String(book.year) : "",
      album: book.album ?? "",
      tags: book.tags.join(", "),
      description: book.description ?? "",
      folderId: book.folderId ?? "",
    });
  }, [book]);

  if (!book) return null;

  const save = async () => {
    await patchBook(book.id, {
      title: draft.title.trim() || book.title,
      author: draft.author.trim() || "Unknown author",
      narrator: draft.narrator.trim() || undefined,
      series: draft.series.trim() || undefined,
      seriesIndex: draft.seriesIndex ? Number(draft.seriesIndex) : undefined,
      year: draft.year ? Number(draft.year) : undefined,
      album: draft.album.trim() || undefined,
      tags: draft.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      description: draft.description.trim() || undefined,
      folderId: draft.folderId || null,
    });
    toast({ title: "Book updated", tone: "success" });
    onClose();
  };

  return (
    <Modal active onClose={onClose} size="620px" padding={6}>
      <Modal.Title>Edit metadata</Modal.Title>
      <Modal.Subtitle>Changes are written straight into the library .json</Modal.Subtitle>

      <div style={{ display: "grid", gridTemplateColumns: "132px minmax(0, 1fr)", gap: 16, marginTop: 16 }}>
        <CoverArt book={book} glow={0.35} />
        <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <div>
            <Text variant="caption-2" color="neutral-faded">
              Cover
            </Text>
            <Text variant="body-2">Square artwork, used across the library and the player</Text>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="outline"
              size="small"
              icon={ImageIcon}
              onClick={() => openDialog({ kind: "coverSearch", bookId: book.id, target: "cover" })}
            >
              Search or upload
            </Button>
          </div>
          {book.bannerUrl || book.bannerDataUrl || book.bannerPath ? (
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <Text variant="caption-2" color="neutral-faded">
                  Banner
                </Text>
                <Text variant="body-2">The wide image behind this book</Text>
              </div>
              <BannerImage
                book={book}
                style={{
                  width: "100%",
                  aspectRatio: "16/9",
                  objectFit: "cover",
                  borderRadius: 10,
                  display: "block",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="outline"
                  size="small"
                  onClick={() => openDialog({ kind: "coverSearch", bookId: book.id, target: "banner" })}
                >
                  Replace
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() =>
                    void patchBook(book.id, {
                      bannerDataUrl: undefined,
                      bannerUrl: undefined,
                      bannerPath: undefined,
                    })
                  }
                >
                  Clear
                </Button>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <div>
                <Text variant="caption-2" color="neutral-faded">
                  Banner
                </Text>
                <Text variant="body-2">
                  None yet: Amp draws abstract art from the cover colours, different for every book
                </Text>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "120px minmax(0, 1fr)",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <BannerArt book={book} palette={palette} />
                <Button
                  variant="outline"
                  size="small"
                  icon={Sparkles}
                  onClick={() => openDialog({ kind: "coverSearch", bookId: book.id, target: "banner" })}
                >
                  Search for a banner
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
        <FormControl>
          <FormControl.Label>Title</FormControl.Label>
          <TextField
            name="title"
            value={draft.title}
            onChange={({ value }) => setDraft({ ...draft, title: value })}
          />
        </FormControl>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FormControl>
            <FormControl.Label>Author</FormControl.Label>
            <TextField
              name="author"
              value={draft.author}
              onChange={({ value }) => setDraft({ ...draft, author: value })}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>Narrator</FormControl.Label>
            <TextField
              name="narrator"
              value={draft.narrator}
              onChange={({ value }) => setDraft({ ...draft, narrator: value })}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>Series</FormControl.Label>
            <TextField
              name="series"
              value={draft.series}
              onChange={({ value }) => setDraft({ ...draft, series: value })}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>Series book number</FormControl.Label>
            <TextField
              name="seriesIndex"
              value={draft.seriesIndex}
              onChange={({ value }) => setDraft({ ...draft, seriesIndex: value.replace(/[^0-9.]/g, "") })}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>Year</FormControl.Label>
            <TextField
              name="year"
              value={draft.year}
              onChange={({ value }) => setDraft({ ...draft, year: value.replace(/[^0-9]/g, "") })}
            />
          </FormControl>
          <FormControl>
            <FormControl.Label>Album</FormControl.Label>
            <TextField
              name="album"
              value={draft.album}
              onChange={({ value }) => setDraft({ ...draft, album: value })}
            />
          </FormControl>
        </div>
        <FormControl>
          <FormControl.Label>Tags (comma separated)</FormControl.Label>
          <TextField
            name="tags"
            value={draft.tags}
            onChange={({ value }) => setDraft({ ...draft, tags: value })}
          />
        </FormControl>
        <FormControl>
          <FormControl.Label>Folder</FormControl.Label>
          <Select
            name="folderId"
            value={draft.folderId}
            onChange={({ value }) => setDraft({ ...draft, folderId: value })}
            placeholder="No folder"
          >
            <Select.Option value="">No folder</Select.Option>
            {folders.map((folder) => (
              <Select.Option key={folder.id} value={folder.id}>
                {folder.name}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
        <FormControl>
          <FormControl.Label>Description</FormControl.Label>
          <TextField
            name="description"
            multiline
            value={draft.description}
            onChange={({ value }) => setDraft({ ...draft, description: value })}
          />
        </FormControl>
        <Text variant="caption-1" color="neutral-faded" attributes={{ style: { wordBreak: "break-all" } }}>
          Source: {book.sourcePath}
        </Text>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button color="primary" onClick={() => void save()}>
            Save changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}

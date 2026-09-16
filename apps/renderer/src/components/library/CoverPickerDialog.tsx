/**
 * Artwork picker: the square cover, or the wide banner behind a book.
 *
 * The banner is not a cover: it is the atmosphere of a page, so it is chosen
 * separately and is only searched for when the book has none yet.
 */

import { useState } from "react";
import { isLoadableUrl } from "@amp/core";
import { Button, Divider, Loader, Modal, Select, Text, TextField } from "reshaped";
import { useLibraryStore } from "../../store/useLibraryStore";
import { useUiStore } from "../../store/useUiStore";
import { getBridge, type CoverCandidate } from "../../platform/bridge";
import { useSettingsStore } from "../../store/useSettingsStore";
import { BannerArt, BannerImage } from "../common/BannerArt";
import { CoverArt } from "../common/CoverArt";

export function CoverPickerDialog({
  bookId,
  target = "cover",
  onClose,
}: {
  bookId: string;
  target?: "cover" | "banner";
  onClose: () => void;
}) {
  const book = useLibraryStore((s) => s.state.books.find((b) => b.id === bookId));
  const patchBook = useLibraryStore((s) => s.patchBook);
  const provider = useUiStore((s) => s);
  const toast = useUiStore((s) => s.toast);
  const [query, setQuery] = useState(book ? `${book.title} ${book.author}` : "");
  const [providerName, setProviderName] = useState("openlibrary");
  const [results, setResults] = useState<CoverCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const palette = useSettingsStore((s) => s.palette);
  void provider;

  if (!book) return null;

  const isBanner = target === "banner";

  /**
   * Put a chosen image where the interface can actually load it.
   *
   * The host answers with a path in its own cover cache, not a URL: storing
   * that in coverDataUrl gave the page an <img src="C:\...\cover.png"> that
   * silently never loaded. Paths go to coverPath (resolved through the media
   * scheme), data URLs and remote URLs go to the field that matches them.
   */
  const apply = async (image: { dataUrl?: string; url?: string }) => {
    const host = await getBridge();
    // The host keeps covers in its own cache and answers with a path in there;
    // banners are kept by the renderer, so there is nothing to store for them.
    const stored = isBanner ? null : await host.library.saveCover(book.id, image);
    const value = stored ?? image.dataUrl ?? image.url ?? undefined;
    const isPath = Boolean(value) && !isLoadableUrl(value as string);
    // Covers and banners hold the same three fields, so they get the same
    // rule: a path is a path, a data URL stays inline, a remote URL stays a URL.
    const fields = isBanner
      ? isPath
        ? { bannerDataUrl: undefined, bannerUrl: undefined, bannerPath: value }
        : {
            bannerDataUrl: image.dataUrl ?? undefined,
            bannerUrl: image.dataUrl ? undefined : value,
            bannerPath: undefined,
          }
      : isPath
        ? { coverDataUrl: undefined, coverUrl: undefined, coverPath: value }
        : {
            coverDataUrl: image.dataUrl ?? undefined,
            coverUrl: image.dataUrl ? undefined : value,
            coverPath: undefined,
          };
    await patchBook(book.id, fields);
    toast({ title: isBanner ? "Banner updated" : "Cover updated", tone: "success" });
  };

  const search = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearched(true);
      setResults([]);
      return;
    }
    setBusy(true);
    setSearched(false);
    setFailed(null);
    const host = await getBridge();
    try {
      const found = await host.library.searchCovers(trimmed, providerName);
      setResults(found);
      setSearched(true);
    } catch (error) {
      // Silence here is what made "search does nothing" impossible to read.
      setResults([]);
      setSearched(true);
      setFailed((error as Error).message || "The cover services could not be reached.");
    } finally {
      setBusy(false);
    }
  };

  const extract = async () => {
    setBusy(true);
    const host = await getBridge();
    const stored = await host.library.extractCover(book);
    setBusy(false);
    if (!stored) {
      toast({
        title: "No embedded cover found",
        description: "The file has no artwork, try the search instead.",
        tone: "danger",
      });
      return;
    }
    // A path from the host, not a data URL: keep it in the field that gets
    // resolved through the media scheme.
    await patchBook(book.id, { coverDataUrl: undefined, coverUrl: undefined, coverPath: stored });
    toast({ title: "Embedded cover extracted", tone: "success" });
  };

  return (
    <Modal active onClose={onClose} size="720px" padding={6}>
      <Modal.Title>{isBanner ? "Banner art" : "Cover art"}</Modal.Title>
      <Modal.Subtitle>
        {isBanner
          ? "The wide image behind the book. Leave it empty for generated art from the cover"
          : "Square artwork keeps the player stage steady"}
      </Modal.Subtitle>
      <div style={{ display: "flex", gap: 18, marginTop: 16 }}>
        <div style={{ width: isBanner ? 240 : 168, flex: "0 0 auto" }}>
          {isBanner ? (
            book.bannerUrl || book.bannerDataUrl || book.bannerPath ? (
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
            ) : (
              <BannerArt book={book} palette={palette} />
            )
          ) : (
            <CoverArt book={book} glow={0.4} />
          )}
        </div>
        <div style={{ display: "grid", gap: 10, flex: 1 }}>
          {!isBanner && (
            <Button variant="outline" onClick={() => void extract()} loading={busy}>
              Use embedded cover
            </Button>
          )}
          <label className="amp-nav-item" style={{ cursor: "pointer" }}>
            Upload an image
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => void apply({ dataUrl: String(reader.result) });
                reader.readAsDataURL(file);
              }}
            />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <TextField
              name={isBanner ? "bannerUrl" : "coverUrl"}
              placeholder={isBanner ? "https://…/banner.jpg" : "https://…/cover.jpg"}
              value={url}
              onChange={({ value }) => setUrl(value)}
            />
            <Button variant="outline" disabled={!url} onClick={() => void apply({ url })}>
              Use URL
            </Button>
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              isBanner
                ? void patchBook(book.id, {
                    bannerDataUrl: undefined,
                    bannerUrl: undefined,
                    bannerPath: undefined,
                  })
                : void getBridge()
                    .then((host) => host.library.removeCover(book.id))
                    .then(() => patchBook(book.id, { coverDataUrl: undefined, coverPath: undefined }))
            }
          >
            {isBanner ? "Clear banner" : "Remove cover"}
          </Button>
        </div>
      </div>

      <Divider />
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <Text variant="body-2" weight="semibold">
          {isBanner ? "Search for banner art" : "Search for cover art"}
        </Text>
        <div style={{ display: "flex", gap: 8 }}>
          <TextField
            name="coverQuery"
            value={query}
            placeholder={`Title and author, e.g. Piranesi Susanna Clarke`}
            onChange={({ value }) => setQuery(value)}
            // Enter searches: reaching for the mouse to run a search you just
            // typed is a needless step.
            inputAttributes={{ onKeyDown: (event) => event.key === "Enter" && void search() }}
          />
          <Select name="provider" value={providerName} onChange={({ value }) => setProviderName(value)}>
            <Select.Option value="openlibrary">Open Library</Select.Option>
            <Select.Option value="googlebooks">Google Books</Select.Option>
            <Select.Option value="itunes">Apple Books / iTunes</Select.Option>
          </Select>
          <Button color="primary" onClick={() => void search()} loading={busy}>
            Search
          </Button>
        </div>
        {busy && <Loader />}
        {!busy && failed && (
          <Text variant="caption-1" color="critical">
            {failed}
          </Text>
        )}
        {!busy && !failed && searched && results.length === 0 && (
          <Text variant="caption-1" color="neutral-faded">
            {`No ${isBanner ? "banner" : "cover"} art came back for "${query.trim()}". Try the title and author, or paste an image URL above.`}
          </Text>
        )}
        <div
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 10 }}
        >
          {results.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => void apply({ url: candidate.full })}
              className="amp-book-card"
              style={{ padding: 6, border: "1px solid var(--amp-hairline)", borderRadius: 10 }}
            >
              <img
                src={candidate.thumbnail}
                alt={candidate.title}
                style={{
                  width: "100%",
                  aspectRatio: isBanner ? "16/9" : "1/1",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <Text variant="caption-2" color="neutral-faded" maxLines={2}>
                {candidate.author ?? candidate.source}
              </Text>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

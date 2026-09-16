/** One book: big cover, chapter list, bookmarks, transcript, actions. */

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Divider, DropdownMenu, Select, Text } from "reshaped";
import {
  ArrowLeft,
  Bookmark,
  Clock,
  FileImage,
  Heart,
  Image,
  MoreHorizontal,
  Pencil,
  Play,
  SkipForward,
  Tags,
  TextSearch,
  Trash2,
  User,
} from "lucide-react";
import { bookProgress, formatBytes, formatDate, formatDuration, formatTime, searchTranscript, timeAgo } from "@amp/core";
import type { TranscriptDoc } from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { getBridge } from "../../platform/bridge";
import { CoverArt } from "../common/CoverArt";
import { Waveform } from "../common/Waveform";

export function BookDetailView({ bookId }: { bookId: string }) {
  const book = useLibraryStore((s) => s.state.books.find((b) => b.id === bookId));
  const allBookmarks = useLibraryStore((s) => s.state.bookmarks);
  const bookmarks = useMemo(() => allBookmarks.filter((b) => b.bookId === bookId), [allBookmarks, bookId]);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const removeBooks = useLibraryStore((s) => s.removeBooks);
  const select = useUiStore((s) => s.select);
  const openDialog = useUiStore((s) => s.openDialog);
  const setRoute = useUiStore((s) => s.setRoute);
  const loadBook = usePlayerStore((s) => s.loadBook);
  const seekChapter = usePlayerStore((s) => s.seekChapter);
  const playingBookId = usePlayerStore((s) => s.state.bookId);
  const playing = usePlayerStore((s) => s.state.playing);
  const position = usePlayerStore((s) => s.state.position);
  const addBookmark = usePlayerStore((s) => s.addBookmark);
  const [transcript, setTranscript] = useState<TranscriptDoc | null>(null);

  useEffect(() => {
    void getBridge().then(async (host) => {
      setTranscript(await host.transcription.get(bookId));
    });
  }, [bookId]);

  const transcriptHits = useMemo(
    () => (transcript ? searchTranscript(transcript, book?.title ?? "").slice(0, 3) : []),
    [transcript, book],
  );

  if (!book) return null;
  const isCurrent = playingBookId === book.id;
  const progress = bookProgress(book);

  return (
    <div style={{ display: "grid", gap: 18, paddingBottom: 20 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="ghost" icon={ArrowLeft} onClick={() => select(null)}>
          Library
        </Button>
      </div>

      <div className="amp-hero">
        <CoverArt book={book} interactive />
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {book.series && (
              <Badge color="primary" size="small">
                {book.series}
                {book.seriesIndex ? ` #${book.seriesIndex}` : ""}
              </Badge>
            )}
            {book.tags.map((tag) => (
              <Badge key={tag} size="small" variant="faded">
                {tag}
              </Badge>
            ))}
            {book.year && <Badge size="small" variant="faded">{book.year}</Badge>}
          </div>
          <Text variant="headline-2" weight="bold">
            {book.title}
          </Text>
          <Text variant="body-1" color="neutral-faded">
            <User size={14} /> {book.author}
            {book.narrator ? ` - narrated by ${book.narrator}` : ""}
          </Text>
          <Text variant="caption-1" color="neutral-faded">
            {formatDuration(book.duration)} - {book.chapters.length} chapters - {book.kind === "single" ? "single file" : "multi file"} -{" "}
            {book.sizeBytes ? formatBytes(book.sizeBytes) : "size unknown"} - added {timeAgo(book.addedAt)}
          </Text>
          {book.description && (
            <Text variant="body-2" color="neutral-faded">
              {book.description.slice(0, 320)}
            </Text>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Button
              color="primary"
              icon={Play}
              onClick={() => void loadBook(book, { autoplay: true })}
            >
              {progress > 0.01 && progress < 0.99 ? "Resume" : "Play"}
            </Button>
            <Button variant="outline" icon={Bookmark} onClick={() => void addBookmark()}>
              Bookmark {isCurrent ? formatTime(position) : ""}
            </Button>
            <Button
              variant="ghost"
              icon={Heart}
              highlighted={book.favorite}
              onClick={() => void toggleFavorite(book.id)}
            >
              Favourite
            </Button>
            {/* One menu instead of a wall of buttons. Artwork and transcription
                choices are edits, and edits belong behind the dots. */}
            <DropdownMenu position="bottom-end" fallbackPositions={["top-end", "bottom-start"]} trapFocusMode="action-menu">
              <DropdownMenu.Trigger>
                {(attributes) => (
                  <Button {...attributes} variant="outline" icon={MoreHorizontal} aria-label="More actions">
                    More
                  </Button>
                )}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item
                  icon={SkipForward}
                  onClick={() => void loadBook(book, { position: 0, autoplay: true })}
                >
                  Play from the start
                </DropdownMenu.Item>
                <DropdownMenu.Item icon={Pencil} onClick={() => openDialog({ kind: "editBook", bookId: book.id })}>
                  Edit metadata
                </DropdownMenu.Item>
                <DropdownMenu.Item icon={Tags} onClick={() => openDialog({ kind: "chapters", bookId: book.id })}>
                  Chapters
                </DropdownMenu.Item>
                <DropdownMenu.Item icon={Image} onClick={() => openDialog({ kind: "coverSearch", bookId: book.id })}>
                  Cover and banner
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  icon={TextSearch}
                  onClick={() => openDialog({ kind: "transcribe", bookId: book.id })}
                >
                  Transcribe
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  icon={FileImage}
                  onClick={() => void getBridge().then((host) => host.library.revealInFolder(book.sourcePath))}
                >
                  Show in file manager
                </DropdownMenu.Item>
                <Divider />
                <DropdownMenu.Item
                  icon={Trash2}
                  onClick={() => {
                    void removeBooks([book.id]);
                    select(null);
                  }}
                >
                  Remove from library
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="amp-player-progress" style={{ flex: 1 }}>
              <span style={{ width: `${progress * 100}%` }} />
            </div>
            <Text variant="caption-1" numeric color="neutral-faded">
              {Math.round(progress * 100)}%
            </Text>
            {isCurrent && (
              <span style={{ color: "var(--amp-accent)" }}>
                <Waveform active={playing} bars={7} />
              </span>
            )}
          </div>
        </div>
      </div>

      <Divider />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 20 }}>
        <section style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Text variant="featured-5" weight="semibold">
              Chapters
            </Text>
            <Select
              name="chapter-jump"
              size="small"
              placeholder="Jump to…"
              value=""
              onChange={({ value }) => {
                const index = Number(value);
                if (Number.isNaN(index)) return;
                if (isCurrent) void seekChapter(index);
                else void loadBook(book, { chapterIndex: index, autoplay: true });
              }}
            >
              {book.chapters.map((chapter, index) => (
                <Select.Option key={chapter.id} value={String(index)}>
                  {`${index + 1}. ${chapter.title}`}
                </Select.Option>
              ))}
            </Select>
          </div>
          <div style={{ maxHeight: 380, overflowY: "auto", display: "grid", gap: 2 }}>
            {book.chapters.map((chapter, index) => {
              const active = isCurrent && position >= chapter.start && position < chapter.start + chapter.duration;
              return (
                <button
                  key={chapter.id}
                  className="amp-row-line"
                  data-selected={active}
                  onClick={() => {
                    if (isCurrent) void seekChapter(index);
                    else void loadBook(book, { chapterIndex: index, autoplay: true });
                  }}
                >
                  <Text variant="caption-1" numeric color="neutral-faded" attributes={{ style: { width: 30 } }}>
                    {index + 1}
                  </Text>
                  <Text variant="body-2" attributes={{ style: { flex: 1, textAlign: "left" } }} maxLines={1}>
                    {chapter.title}
                  </Text>
                  <Text variant="caption-1" numeric color="neutral-faded">
                    <Clock size={11} /> {formatTime(chapter.duration)}
                  </Text>
                </button>
              );
            })}
          </div>
        </section>

        <section style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 8 }}>
            <Text variant="featured-5" weight="semibold">
              Bookmarks
            </Text>
            {bookmarks.length === 0 && (
              <Text variant="caption-1" color="neutral-faded">
                No bookmarks yet - press B while listening.
              </Text>
            )}
            {bookmarks.slice(0, 6).map((bookmark) => (
              <button
                key={bookmark.id}
                className="amp-row-line"
                onClick={() => (isCurrent ? void seekChapter(bookmark.chapterIndex) : void loadBook(book, { position: bookmark.position, autoplay: true }))}
              >
                <Bookmark size={13} />
                <Text variant="body-2" attributes={{ style: { flex: 1, textAlign: "left" } }} maxLines={1}>
                  {bookmark.label}
                </Text>
                <Text variant="caption-1" numeric color="neutral-faded">
                  {formatTime(bookmark.position)}
                </Text>
              </button>
            ))}
            <Button variant="ghost" onClick={() => openDialog({ kind: "bookmarks", bookId: book.id })}>
              Manage bookmarks
            </Button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <Text variant="featured-5" weight="semibold">
              Transcript
            </Text>
            {transcript ? (
              <>
                <Text variant="caption-1" color="neutral-faded">
                  {transcript.cues.length} cues - {transcript.model} - {formatDate(transcript.createdAt)}
                </Text>
                {transcriptHits.map((hit) => (
                  <Text key={hit.id} variant="caption-1" color="neutral-faded" maxLines={2}>
                    {formatTime(hit.start)} - {hit.text}
                  </Text>
                ))}
                <Button variant="outline" icon={TextSearch} onClick={() => setRoute("transcript")}>
                  Open transcript search
                </Button>
              </>
            ) : (
              <>
                <Text variant="caption-1" color="neutral-faded">
                  No transcript yet. Amp can run Whisper locally to transcribe, search and auto-split chapters.
                </Text>
                <Button variant="outline" icon={TextSearch} onClick={() => openDialog({ kind: "transcribe", bookId: book.id })}>
                  Transcribe with Whisper
                </Button>
              </>
            )}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <Text variant="featured-5" weight="semibold">
              Files
            </Text>
            <Text variant="caption-1" color="neutral-faded" attributes={{ style: { wordBreak: "break-all" } }}>
              {book.sourcePath}
            </Text>

          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * Transcript browser: search spoken words across books, jump playback to a
 * cue, detect chapters from silence, and export SRT / VTT / Markdown.
 */

import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Divider, Select, Text, TextField } from "reshaped";
import { Download, FileText, Search, Sparkles, Wand2 } from "lucide-react";
import { chaptersFromCues, cueSnippet, cuesToSrt, cuesToVtt, searchTranscript, transcriptToChapters, transcriptToMarkdown, formatTime } from "@amp/core";
import type { TranscriptDoc } from "@amp/core";
import { getBridge } from "../../platform/bridge";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { EmptyState } from "../common/EmptyState";

export function TranscriptView() {
  const books = useLibraryStore((s) => s.state.books);
  const updateChapters = useLibraryStore((s) => s.updateChapters);
  const loadBook = usePlayerStore((s) => s.loadBook);
  const seek = usePlayerStore((s) => s.seek);
  const playingBookId = usePlayerStore((s) => s.state.bookId);
  const openDialog = useUiStore((s) => s.openDialog);
  const toast = useUiStore((s) => s.toast);
  const [bookId, setBookId] = useState<string>("");
  const [doc, setDoc] = useState<TranscriptDoc | null>(null);
  const [query, setQuery] = useState("");
  const [jumpTo, setJumpTo] = useState("");

  useEffect(() => {
    const host = getBridge;
    void host().then(async (bridge) => {
      const target = bookId || playingBookId || books[0]?.id;
      if (!target) return;
      setBookId(target);
      setDoc(await bridge.transcription.get(target));
    });
  }, [bookId, playingBookId, books]);

  const hits = useMemo(() => (doc ? searchTranscript(doc, query, 80) : []), [doc, query]);
  const book = books.find((b) => b.id === bookId);

  const exportAs = (kind: "srt" | "vtt" | "md") => {
    if (!doc || !book) return;
    const content =
      kind === "srt" ? cuesToSrt(doc.cues) : kind === "vtt" ? cuesToVtt(doc.cues) : transcriptToMarkdown(doc, book);
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${book.title.replace(/[^\w\s-]/g, "").trim()}.${kind}`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast({ title: `Exported ${kind.toUpperCase()}`, tone: "success" });
  };

  const detectChapters = async () => {
    if (!doc || !book) return;
    const detected = chaptersFromCues(doc.cues, { totalDuration: book.duration });
    if (detected.length === 0) {
      toast({ title: "No chapter boundaries found in the transcript", tone: "danger" });
      return;
    }
    await updateChapters(book.id, transcriptToChapters(detected));
    toast({ title: `Applied ${detected.length} chapters from speech breaks`, tone: "success" });
  };

  return (
    <div style={{ display: "grid", gap: 16, paddingBottom: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
        <div>
          <Text variant="headline-3" weight="bold">
            Transcripts
          </Text>
          <Text variant="caption-1" color="neutral-faded">
            Local Whisper transcripts make the library searchable by what is actually spoken - and can rebuild a
            chapter list from the audio itself.
          </Text>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Select
            name="transcript-book"
            size="small"
            value={bookId}
            onChange={({ value }) => setBookId(value)}
            placeholder="Pick a book"
          >
            {books.map((item) => (
              <Select.Option key={item.id} value={item.id}>
                {item.title}
              </Select.Option>
            ))}
          </Select>
          <Button size="small" variant="outline" icon={Sparkles} onClick={() => openDialog({ kind: "transcribe", bookId: bookId || books[0]?.id || "" })}>
            Transcribe a book
          </Button>
        </div>
      </div>

      {!doc ? (
        <EmptyState
          icon={FileText}
          title="No transcript for this book yet"
          description="Point Amp at a local Whisper install (whisper.cpp, faster-whisper or openai-whisper) and it will transcribe chapter by chapter in the background."
          actionLabel="Open transcription"
          onAction={() => openDialog({ kind: "transcribe", bookId: bookId || books[0]?.id || "" })}
        />
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <TextField
              name="transcript-search"
              icon={Search}
              placeholder="Search the spoken text…"
              value={query}
              onChange={({ value }) => setQuery(value)}
              attributes={{
                style: { flex: "1 1 320px" },
                onKeyDown: (event: React.KeyboardEvent) => {
                  if (event.key === "Enter" && hits[0]) setJumpTo(String(hits[0].start));
                },
              }}
            />
            <Select name="jump" size="small" value={jumpTo} onChange={({ value }) => setJumpTo(value)} placeholder="Jump to time">
              {hits.slice(0, 60).map((hit) => (
                <Select.Option key={hit.id} value={String(hit.start)}>
                  {`${formatTime(hit.start)} - ${hit.text.slice(0, 48)}`}
                </Select.Option>
              ))}
            </Select>
            <Button
              size="small"
              color="primary"
              icon={Wand2}
              onClick={() => {
                const target = Number(jumpTo);
                if (!Number.isFinite(target)) return;
                if (playingBookId === doc.bookId) seek(target);
                else if (book) void loadBook(book, { position: target, autoplay: true });
              }}
            >
              Play from hit
            </Button>
            <Button size="small" variant="outline" onClick={() => void detectChapters()}>
              Chapter list from speech
            </Button>
            <Button size="small" variant="outline" icon={Download} onClick={() => exportAs("srt")}>
              SRT
            </Button>
            <Button size="small" variant="outline" onClick={() => exportAs("vtt")}>
              VTT
            </Button>
            <Button size="small" variant="outline" onClick={() => exportAs("md")}>
              Markdown
            </Button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Badge size="small" variant="faded">
              {doc.cues.length} cues
            </Badge>
            <Badge size="small" variant="faded">
              model: {doc.model}
            </Badge>
            <Badge size="small" variant="faded">
              language: {doc.language}
            </Badge>
            <Text variant="caption-1" color="neutral-faded">
              {query ? `${hits.length} matches` : "Search to jump around the book"}
            </Text>
          </div>

          <Divider />

          <div style={{ display: "grid", gap: 6, maxHeight: "52vh", overflowY: "auto" }}>
            {(query ? hits.map((hit) => ({ id: hit.id, start: hit.start, text: cueSnippet({ start: hit.start, end: hit.start + 3, text: hit.text }, query) })) : doc.cues.map((cue, index) => ({ id: `${index}-${cue.start}`, start: cue.start, text: cue.text }))).map(
              (entry) => (
                <button
                  key={entry.id}
                  className="amp-row-line"
                  style={{ alignItems: "flex-start", cursor: "pointer" }}
                  onClick={() => {
                    if (playingBookId === doc.bookId) seek(entry.start);
                    else if (book) void loadBook(book, { position: entry.start, autoplay: true });
                  }}
                >
                  <Text variant="caption-1" numeric color="neutral-faded" attributes={{ style: { width: 62 } }}>
                    {formatTime(entry.start)}
                  </Text>
                  <Text variant="body-2" attributes={{ style: { flex: 1, textAlign: "left" } }}>
                    {entry.text}
                  </Text>
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

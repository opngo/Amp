/**
 * Chapter editor: rename, reorder, merge, split, re-run filename rules and
 * (desktop only) write the result back into the m4b with ffmpeg.
 */

import { useMemo, useState } from "react";
import { Alert, Button, Divider, Modal, Select, Text, TextField } from "reshaped";
import {
  DEFAULT_CHAPTER_RULES,
  formatTime,
  mergeChapters,
  moveChapter,
  relayoutChapters,
  splitChapter,
  splitBookIntoBooks,
  mergeBooks,
  chaptersFromCues,
  transcriptToChapters,
} from "@amp/core";
import { useLibraryStore } from "../../store/useLibraryStore";
import { usePlayerStore } from "../../store/usePlayerStore";
import { useUiStore } from "../../store/useUiStore";
import { getBridge } from "../../platform/bridge";
import type { Chapter } from "@amp/core";

export function ChapterEditorDialog({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const book = useLibraryStore((s) => s.state.books.find((b) => b.id === bookId));
  const updateChapters = useLibraryStore((s) => s.updateChapters);
  const patchBook = useLibraryStore((s) => s.patchBook);
  const replaceBooks = useLibraryStore((s) => s.removeBooks);
  const seek = usePlayerStore((s) => s.seek);
  const seekChapter = usePlayerStore((s) => s.seekChapter);
  const position = usePlayerStore((s) => s.state.position);
  const playingBookId = usePlayerStore((s) => s.state.bookId);
  const toast = useUiStore((s) => s.toast);
  const [chapters, setChapters] = useState<Chapter[]>(() => book?.chapters ?? []);
  const [writeBusy, setWriteBusy] = useState(false);

  const total = useMemo(() => chapters.reduce((acc, c) => acc + c.duration, 0), [chapters]);
  if (!book) return null;
  const isCurrent = playingBookId === book.id;

  const persist = async (next: Chapter[]) => {
    setChapters(next);
    await updateChapters(book.id, next);
  };

  const applyFilenameRules = async () => {
    const rules = DEFAULT_CHAPTER_RULES;
    const next = chapters.map((chapter) => {
      const source = chapter.file ?? chapter.title;
      const name = source.split(/[\\/]/).pop() ?? source;
      let title = chapter.title;
      for (const rule of rules) {
        const match = name.match(new RegExp(rule.pattern, "i"));
        if (match) {
          title = rule.template
            .replace(/\{n\}/g, match[1] ?? "")
            .replace(/\{name\}/g, (match[2] ?? name.replace(/\.[a-z0-9]+$/i, "")).trim());
          break;
        }
      }
      return { ...chapter, title };
    });
    await persist(next);
    toast({ title: "Chapter titles refreshed from file names", tone: "success" });
  };

  const fromTranscript = async () => {
    const host = await getBridge();
    const doc = await host.transcription.get(book.id);
    if (!doc) {
      toast({ title: "No transcript yet", description: "Transcribe the book first.", tone: "danger" });
      return;
    }
    const detected = chaptersFromCues(doc.cues, { totalDuration: book.duration });
    if (detected.length === 0) {
      toast({ title: "Could not detect chapters in the transcript", tone: "danger" });
      return;
    }
    await persist(transcriptToChapters(detected));
    toast({ title: `${detected.length} chapters detected from the transcript`, tone: "success" });
  };

  const writeBack = async () => {
    setWriteBusy(true);
    const host = await getBridge();
    const result = await host.library.writeChapters(book.id, chapters);
    setWriteBusy(false);
    toast({
      title: result.ok ? "Chapters written into the file" : "Could not write chapters",
      description: result.detail,
      tone: result.ok ? "success" : "danger",
    });
  };

  const splitIntoBooks = async () => {
    const parts = splitBookIntoBooks(book);
    await replaceBooks([book.id]);
    for (const part of parts) {
      await useLibraryStore.getState().patchBook(part.id, part);
    }
    useLibraryStore.setState((state) => ({
      state: { ...state.state, books: [...state.state.books, ...parts.map((p) => ({ ...p, id: p.id }))] },
    }));
    await useLibraryStore.getState().persist();
    toast({ title: `Split into ${parts.length} books`, tone: "success" });
    onClose();
  };

  const reglueIntoOneBook = async () => {
    const merged = mergeBooks([book]);
    await patchBook(book.id, { kind: "multi", chapters: merged.chapters, duration: merged.duration });
    toast({ title: "All tracks grouped as one book", tone: "success" });
  };

  return (
    <Modal active onClose={onClose} size="720px" padding={6}>
      <Modal.Title>Chapters</Modal.Title>
      <Modal.Subtitle>
        {chapters.length} chapters - {formatTime(total)} total
      </Modal.Subtitle>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0" }}>
        <Button size="small" variant="outline" onClick={() => void applyFilenameRules()}>
          Rebuild titles from file names
        </Button>
        <Button size="small" variant="outline" onClick={() => void fromTranscript()}>
          Detect from transcript
        </Button>
        <Button
          size="small"
          variant="outline"
          onClick={() =>
            void persist([
              ...chapters,
              {
                id: `manual-${Date.now()}`,
                index: chapters.length + 1,
                title: `Chapter ${chapters.length + 1}`,
                start: position,
                duration: Math.max(30, book.duration - position),
                manual: true,
              },
            ].sort((a, b) => a.start - b.start)).then(() => toast({ title: "Chapter added at the playhead", tone: "success" }))
          }
        >
          Add chapter at playhead
        </Button>
        <Button size="small" variant="outline" disabled={writeBusy} onClick={() => void writeBack()}>
          Write chapters into file (ffmpeg)
        </Button>
        <Button size="small" variant="outline" onClick={() => void reglueIntoOneBook()}>
          Group tracks as one book
        </Button>
        <Button size="small" variant="outline" onClick={() => void splitIntoBooks()}>
          Split into separate books
        </Button>
      </div>

      {book.kind === "single" && (
        <Alert color="neutral">
          This book is a single file, so splits and reorders are stored in Amp and applied on the fly. Use
          "Write chapters into file" to bake them into the m4b.
        </Alert>
      )}

      <div style={{ maxHeight: 380, overflowY: "auto", display: "grid", gap: 6 }}>
        {chapters.map((chapter, index) => (
          <div
            key={chapter.id}
            className="amp-row-line"
            style={{ alignItems: "center", gap: 10, margin: 0 }}
            data-selected={isCurrent && Math.abs(position - chapter.start) < chapter.duration}
          >
            <Text variant="caption-1" color="neutral-faded" attributes={{ style: { width: 34 } }}>
              {index + 1}
            </Text>
            <TextField
              name={`chapter-${chapter.id}`}
              value={chapter.title}
              onChange={({ value }) =>
                setChapters((list) => list.map((c) => (c.id === chapter.id ? { ...c, title: value } : c)))
              }
            />
            <Text variant="caption-1" color="neutral-faded" attributes={{ style: { width: 118, textAlign: "right" } }}>
              {formatTime(chapter.start)} - {formatTime(chapter.duration)}
            </Text>
            <div style={{ display: "flex", gap: 4 }}>
              <Button size="small" variant="ghost" onClick={() => void persist(moveChapter(chapters, index, index - 1))}>
                Up
              </Button>
              <Button size="small" variant="ghost" onClick={() => void persist(moveChapter(chapters, index, index + 1))}>
                Down
              </Button>
              <Button size="small" variant="ghost" onClick={() => void persist(mergeChapters(chapters, index))}>
                Merge
              </Button>
              <Button
                size="small"
                variant="ghost"
                onClick={() => {
                  const at = isCurrent ? position - chapter.start : Math.round(chapter.duration / 2);
                  void persist(splitChapter(chapters, index, at));
                }}
              >
                Split
              </Button>
              <Button
                size="small"
                variant="ghost"
                onClick={() => void persist(relayoutChapters(chapters.filter((c) => c.id !== chapter.id)))}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Divider />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 12 }}>
        <Select
          name="jump"
          placeholder={isCurrent ? `Jump to chapter (now ${formatTime(position)})` : "Jump to chapter"}
          value=""
          onChange={({ value }) => {
            const index = Number(value);
            if (Number.isNaN(index)) return;
            if (isCurrent) void seekChapter(index);
            else seek(chapters[index]?.start ?? 0);
          }}
        >
          {chapters.map((chapter, index) => (
            <Select.Option key={chapter.id} value={String(index)}>
              {`${index + 1}. ${chapter.title} - ${formatTime(chapter.start)}`}
            </Select.Option>
          ))}
        </Select>
        <Button color="primary" onClick={() => void persist(chapters).then(onClose)}>
          Save chapters
        </Button>
      </div>
    </Modal>
  );
}

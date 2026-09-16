/** Chapter dropdown + prev/next buttons that also work as a compact list. */

import { Button, Select, Text } from "reshaped";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatTime } from "@amp/core";
import { usePlayerStore } from "../../store/usePlayerStore";

export function ChapterSelect({ compact = false }: { compact?: boolean }) {
  const book = usePlayerStore((s) => s.book);
  const chapterIndex = usePlayerStore((s) => s.state.chapterIndex);
  const seekChapter = usePlayerStore((s) => s.seekChapter);
  const nextChapter = usePlayerStore((s) => s.nextChapter);
  const prevChapter = usePlayerStore((s) => s.prevChapter);
  const position = usePlayerStore((s) => s.state.position);
  const stopFor = usePlayerStore((s) => s.chapterStopFor);

  if (!book) return null;
  const chapter = book.chapters[chapterIndex];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
      <Button size="small" variant="ghost" icon={ChevronLeft} onClick={() => void prevChapter()} attributes={{ "aria-label": "Previous chapter" }} />
      <Select
        name="chapter"
        size="small"
        value={String(chapterIndex)}
        onChange={({ value }) => void seekChapter(Number(value))}
        attributes={{ style: { minWidth: compact ? 190 : 260, maxWidth: compact ? 250 : 320 } }}
      >
        {book.chapters.map((item, index) => {
          const stop = index === chapterIndex ? null : stopFor(index);
          const title = item.title.length > 40 ? `${item.title.slice(0, 40)}…` : item.title;
          // "Continue with the remaining" is the whole point of remembering:
          // the dropdown is where a listener picks a chapter up again.
          const tail = stop === null
            ? formatTime(item.duration)
            : `Continue with the remaining ${formatTime(Math.max(0, item.duration - stop))}`;
          return (
            <Select.Option key={item.id} value={String(index)}>
              {`${index + 1}. ${title} - ${tail}`}
            </Select.Option>
          );
        })}
      </Select>
      <Button size="small" variant="ghost" icon={ChevronRight} onClick={() => void nextChapter()} attributes={{ "aria-label": "Next chapter" }} />
      {!compact && chapter && (
        <Text variant="caption-2" color="neutral-faded" numeric attributes={{ style: { marginLeft: 4 } }}>
          {chapterIndex + 1}/{book.chapters.length} - {formatTime(position - chapter.start)} / {formatTime(chapter.duration)}
        </Text>
      )}
    </div>
  );
}

/**
 * Whisper / transcript utilities: subtitle parsing, cue search, chapter
 * splitting from silence and export back to SRT/VTT/Markdown.
 */

import type { Chapter, TranscriberJob, TranscriptDoc, WhisperCue } from "./types";

const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;

export function parseTimestamp(stamp: string): number {
  const match = stamp.match(TIME_RE);
  if (!match) return 0;
  const [, h, m, s, ms] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
}

export function formatTimestamp(seconds: number, comma = true): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  const pad = (v: number, len = 2) => String(v).padStart(len, "0");
  const sep = comma ? "," : ".";
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms, 3)}`;
}

/** Parse SRT or WebVTT into cues. */
export function parseSubtitles(input: string): WhisperCue[] {
  const text = input.replace(/\r/g, "").replace(/^WEBVTT.*\n/, "");
  const blocks = text.split(/\n{2,}/);
  const cues: WhisperCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    const timeLineIndex = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIndex === -1) continue;
    const [startRaw, endRaw] = lines[timeLineIndex].split("-->");
    const content = lines
      .slice(timeLineIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!content) continue;
    cues.push({
      start: parseTimestamp(startRaw),
      end: parseTimestamp(endRaw ?? startRaw),
      text: content,
    });
  }
  return cues;
}

export function cuesToSrt(cues: WhisperCue[]): string {
  return cues
    .map((cue, i) => `${i + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text}\n`)
    .join("\n");
}

export function cuesToVtt(cues: WhisperCue[]): string {
  const body = cues
    .map(
      (cue) => `${formatTimestamp(cue.start, false)} --> ${formatTimestamp(cue.end, false)}\n${cue.text}\n`,
    )
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export interface ChapterFromTranscript {
  title: string;
  start: number;
  duration: number;
}

/**
 * Whisper transcribes long audio as one stream, so we reconstruct chapter
 * breaks from the long silences it leaves between cues.
 */
export function chaptersFromCues(
  cues: WhisperCue[],
  options: { gapSeconds?: number; totalDuration?: number; minChapterSeconds?: number } = {},
): ChapterFromTranscript[] {
  const { gapSeconds = 2.5, totalDuration, minChapterSeconds = 300 } = options;
  if (cues.length === 0) return [];
  const groups: WhisperCue[][] = [[cues[0]]];
  for (let i = 1; i < cues.length; i += 1) {
    const gap = cues[i].start - cues[i - 1].end;
    if (gap >= gapSeconds) groups.push([cues[i]]);
    else groups[groups.length - 1].push(cues[i]);
  }
  // Merge groups that are too short to be a real chapter.
  const merged: WhisperCue[][] = [];
  for (const group of groups) {
    const span = group[group.length - 1].end - group[0].start;
    if (span < minChapterSeconds && merged.length > 0) merged[merged.length - 1].push(...group);
    else merged.push(group);
  }
  return merged.map((group, i) => {
    const start = group[0].start;
    const end =
      i === merged.length - 1 ? (totalDuration ?? group[group.length - 1].end) : merged[i + 1][0].start;
    const firstWords = group[0].text.split(/\s+/).slice(0, 6).join(" ");
    return {
      title: `${firstWords}${group[0].text.split(/\s+/).length > 6 ? "…" : ""}` || `Part ${i + 1}`,
      start,
      duration: Math.max(1, end - start),
    };
  });
}

export function searchTranscript(doc: TranscriptDoc | undefined, query: string, limit = 60) {
  if (!doc || !query.trim()) return [];
  const needle = query.trim().toLowerCase();
  const words = needle.split(/\s+/);
  return doc.cues
    .map((cue) => {
      const text = cue.text.toLowerCase();
      let score = 0;
      for (const word of words) {
        if (text.includes(word)) score += 1;
      }
      return { cue, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.cue.start - b.cue.start)
    .slice(0, limit)
    .map((entry, index) => ({
      id: `${index}-${entry.cue.start}`,
      start: entry.cue.start,
      text: entry.cue.text,
      score: entry.score,
    }));
}

/** Snippet around a cue for the search UI. */
export function cueSnippet(cue: WhisperCue, query: string, radius = 90): string {
  const text = cue.text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase().split(/\s+/)[0] ?? "");
  if (idx === -1 || text.length <= radius * 2) return text;
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function transcriptToMarkdown(doc: TranscriptDoc, book: { title: string; author: string }): string {
  let out = `# ${book.title}\n\n_${book.author}_\n\nTranscribed with ${doc.model} (${doc.language}) on ${new Date(doc.createdAt).toLocaleString()}\n\n`;
  let last = 0;
  for (const cue of doc.cues) {
    if (cue.start - last > 45) out += "\n";
    out += `${cue.text} `;
    last = cue.end;
  }
  return `${out.trim()}\n`;
}

/** Progress of a transcription job, 0..1. */
export function jobProgress(job: TranscriberJob, totalChapters: number): number {
  if (job.status === "done") return 1;
  if (job.status === "queued") return 0;
  const done = job.progress;
  return Math.max(0, Math.min(0.99, totalChapters ? done / totalChapters : done));
}

export function estimatedJobSeconds(totalSeconds: number, model = "base", speedFactor = 8): number {
  const modelMultiplier: Record<string, number> = {
    tiny: 0.4,
    base: 1,
    small: 1.8,
    medium: 3.4,
    "large-v3": 6.2,
    "large-v3-turbo": 2.2,
  };
  return (totalSeconds / speedFactor) * (modelMultiplier[model] ?? 1);
}

/** Convert our transcript sections back into Amp chapters. */
export function transcriptToChapters(sections: ChapterFromTranscript[]): Chapter[] {
  return sections.map((section, i) => ({
    id: `tr-${i}-${Math.round(section.start)}`,
    index: i + 1,
    title: section.title,
    start: section.start,
    duration: section.duration,
    manual: true,
  }));
}

/**
 * Local transcription helpers.
 *
 * Amp drives two flavours of Whisper without caring which one is installed:
 * whisper.cpp (`whisper-cli`, `main`, `whisper-cpp`) and the OpenAI Python
 * package (`whisper`, `faster-whisper`). Both print progress to stderr in
 * slightly different ways, and both accept roughly the same flags.
 */

export interface WhisperModel {
  id: string;
  label: string;
  /** Rough download size in megabytes, shown before anything is fetched. */
  sizeMb: number;
  speed: "fastest" | "balanced" | "best";
  note: string;
}

export const WHISPER_MODELS: WhisperModel[] = [
  {
    id: "tiny.en",
    label: "tiny (English)",
    sizeMb: 75,
    speed: "fastest",
    note: "Quick draft, good for previews",
  },
  {
    id: "base.en",
    label: "base (English)",
    sizeMb: 142,
    speed: "balanced",
    note: "Best speed to accuracy for audiobooks",
  },
  {
    id: "small.en",
    label: "small (English)",
    sizeMb: 466,
    speed: "balanced",
    note: "Sharper names and places",
  },
  { id: "medium.en", label: "medium (English)", sizeMb: 1500, speed: "best", note: "Slow but very accurate" },
  { id: "base", label: "base (multilingual)", sizeMb: 142, speed: "balanced", note: "Any language" },
  {
    id: "small",
    label: "small (multilingual)",
    sizeMb: 466,
    speed: "balanced",
    note: "Any language, sharper",
  },
  {
    id: "large-v3",
    label: "large v3",
    sizeMb: 3100,
    speed: "best",
    note: "Highest quality, needs a strong machine",
  },
];

export function findWhisperModel(id: string): WhisperModel | undefined {
  return WHISPER_MODELS.find((model) => model.id === id);
}

export interface WhisperArgsOptions {
  input: string;
  outputDir: string;
  model?: string;
  language?: string;
  /** Emit srt, vtt, txt and json together. */
  formats?: Array<"srt" | "vtt" | "txt" | "json">;
  threads?: number;
  translate?: boolean;
  wordTimestamps?: boolean;
  initialPrompt?: string;
  device?: "cpu" | "cuda";
}

/** Command line for the OpenAI `whisper` CLI. */
export function openAiWhisperArgs(options: WhisperArgsOptions): string[] {
  const formats = options.formats ?? ["srt", "vtt", "txt", "json"];
  const args = [
    options.input,
    "--model",
    options.model ?? "base.en",
    "--output_dir",
    options.outputDir,
    "--output_format",
    formats.join(","),
    "--verbose",
    "False",
  ];
  if (options.language) args.push("--language", options.language);
  if (options.translate) args.push("--task", "translate");
  if (options.threads) args.push("--threads", String(options.threads));
  if (options.wordTimestamps) args.push("--word_timestamps", "True");
  if (options.initialPrompt) args.push("--initial_prompt", options.initialPrompt);
  return args;
}

/** Command line for whisper.cpp, which wants a model file path. */
export function whisperCppArgs(options: WhisperArgsOptions, modelPath: string): string[] {
  const args = [
    "-m",
    modelPath,
    "-f",
    options.input,
    "-of",
    options.outputDir.replace(/\/?$/, "/") + "transcript",
    "-osrt",
    "-ovtt",
    "-otxt",
    "--print-progress",
  ];
  if (options.language) args.push("-l", options.language === "auto" ? "auto" : options.language);
  if (options.threads) args.push("-t", String(options.threads));
  if (options.translate) args.push("--translate");
  return args;
}

export interface WhisperProgress {
  percent?: number;
  segment?: string;
  status?: "loading" | "running" | "done" | "error";
  message?: string;
}

/**
 * Best-effort progress parser for both stderr dialects:
 *   whisper.cpp      "[00:00:12.000 --> ...] ..." plus "progress = 43%"
 *   openai-whisper   "Detecting language...", "12%|██ | 3/25 [00:12<01:02]"
 */
export function parseWhisperProgress(line: string): WhisperProgress | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const percentMatch = trimmed.match(/(\d{1,3})\s*%/);
  if (percentMatch) {
    const percent = Math.min(100, Math.max(0, Number(percentMatch[1])));
    const segmentMatch = trimmed.match(/(\d+)\s*\/\s*(\d+)/);
    return {
      percent,
      status: percent >= 100 ? "done" : "running",
      segment: segmentMatch ? `${segmentMatch[1]} of ${segmentMatch[2]} segments` : undefined,
    };
  }
  if (/error|failed|couldn't|cannot/i.test(trimmed)) {
    return { status: "error", message: trimmed.slice(0, 200) };
  }
  if (/detecting language|loading model|processing/i.test(trimmed)) {
    return { status: "loading", message: trimmed.slice(0, 200) };
  }
  if (/^\s*\[[\d:.,\s\->]+\]/.test(trimmed)) {
    return { status: "running", segment: trimmed.replace(/^\s*\[[^\]]*\]\s*/, "").slice(0, 160) };
  }
  return null;
}

/** Candidate binary names, most likely first, per platform. */
export const WHISPER_BINARIES = ["whisper-cli", "whisper-cpp", "main", "whisper", "whisper-ctranslate2"];

export function defaultWhisperThreads(cpuCount: number): number {
  return Math.max(1, Math.min(8, Math.floor(cpuCount / 2) || 1));
}

/** Files a finished job is expected to leave behind. */
export function transcriptFileNames(outputDir: string, base = "transcript"): string[] {
  const prefix = `${outputDir.replace(/\/+$/, "")}/${base}`;
  return [`${prefix}.srt`, `${prefix}.vtt`, `${prefix}.txt`, `${prefix}.json`];
}

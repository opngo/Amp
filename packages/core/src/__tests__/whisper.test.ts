import { describe, expect, it } from "vitest";
import { chaptersFromCues, cueSnippet, cuesToSrt, cuesToVtt, defaultWhisperThreads, estimatedJobSeconds, findWhisperModel, formatTimestamp, openAiWhisperArgs, parseSubtitles, parseTimestamp, parseWhisperProgress, searchTranscript, transcriptFileNames, transcriptToChapters, transcriptToMarkdown, WHISPER_MODELS, whisperCppArgs } from "../whisper";
import type { TranscriptDoc } from "../types";

const SRT = `1
00:00:01,000 --> 00:00:04,500
Chapter one begins here.

2
00:00:05,000 --> 00:00:08,000
The spice must flow.
`;

const VTT = `WEBVTT

00:00:10.000 --> 00:00:12.000
<i>Later</i> in the story
`;

describe("subtitle parsing", () => {
  it("parses SRT", () => {
    const cues = parseSubtitles(SRT);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(4.5);
    expect(cues[0].text).toBe("Chapter one begins here.");
  });

  it("parses VTT and strips markup", () => {
    const cues = parseSubtitles(VTT);
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe("Later in the story");
  });

  it("round trips timestamps", () => {
    expect(parseTimestamp("01:02:03,456")).toBeCloseTo(3723.456, 3);
    expect(formatTimestamp(3723.456)).toBe("01:02:03,456");
    expect(formatTimestamp(3723.456, false)).toBe("01:02:03.456");
  });

  it("exports back to srt and vtt", () => {
    const cues = parseSubtitles(SRT);
    expect(cuesToSrt(cues)).toContain("-->");
    expect(cuesToVtt(cues).startsWith("WEBVTT")).toBe(true);
  });

  it("ignores malformed blocks", () => {
    expect(parseSubtitles("garbage\n\nmore garbage")).toHaveLength(0);
  });
});

describe("chapter detection from transcripts", () => {
  it("splits on long silences but merges short groups", () => {
    const cues = [
      { start: 0, end: 4, text: "Intro words here" },
      { start: 5, end: 9, text: "more" },
      { start: 400, end: 404, text: "Second part starts" },
      { start: 405, end: 900, text: "continues" },
    ];
    const chapters = chaptersFromCues(cues, { minChapterSeconds: 300, totalDuration: 1000 });
    expect(chapters).toHaveLength(2);
    expect(chapters[0].start).toBe(0);
    expect(chapters[1].start).toBe(400);
    expect(chapters[0].duration).toBeCloseTo(400);
  });

  it("handles empty input", () => {
    expect(chaptersFromCues([])).toEqual([]);
  });

  it("converts to chapters", () => {
    const chapters = transcriptToChapters([{ title: "Start", start: 0, duration: 100 }]);
    expect(chapters[0]).toMatchObject({ index: 1, title: "Start", start: 0, manual: true });
  });
});

describe("transcript search and export", () => {
  const doc: TranscriptDoc = {
    bookId: "bk1",
    language: "en",
    model: "base",
    createdAt: 0,
    text: "the spice must flow",
    cues: [
      { start: 0, end: 3, text: "A beginning about the desert" },
      { start: 10, end: 15, text: "the spice must flow" },
      { start: 20, end: 25, text: "spice and worms" },
    ],
  };

  it("ranks matching cues", () => {
    const hits = searchTranscript(doc, "spice");
    expect(hits).toHaveLength(2);
    expect(hits[0].start).toBe(10);
    expect(searchTranscript(doc, "")).toEqual([]);
    expect(searchTranscript(undefined, "spice")).toEqual([]);
  });

  it("snippets long cues around the hit", () => {
    const long = { start: 0, end: 1, text: `${"x".repeat(200)}needle${"y".repeat(200)}` };
    const snippet = cueSnippet(long, "needle", 20);
    expect(snippet).toContain("needle");
    expect(snippet.startsWith("…")).toBe(true);
  });

  it("exports markdown", () => {
    const markdown = transcriptToMarkdown(doc, { title: "Dune", author: "Frank Herbert" });
    expect(markdown).toContain("# Dune");
    expect(markdown).toContain("spice must flow");
  });

  it("estimates job times", () => {
    expect(estimatedJobSeconds(3600, "tiny")).toBeLessThan(estimatedJobSeconds(3600, "large-v3"));
  });
});

describe("whisper model catalogue", () => {
  it("exposes models with sizes and looks them up by id", () => {
    expect(WHISPER_MODELS.length).toBeGreaterThan(4);
    expect(findWhisperModel("base.en")?.sizeMb).toBeGreaterThan(0);
    expect(findWhisperModel("nope")).toBeUndefined();
  });

  it("every model id is unique", () => {
    const ids = WHISPER_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("whisper command lines", () => {
  it("builds an openai-whisper command with all formats", () => {
    const args = openAiWhisperArgs({
      input: "/books/dune.m4b",
      outputDir: "/tmp/out",
      model: "small.en",
      language: "en",
      threads: 4,
      wordTimestamps: true,
      initialPrompt: "Dune, Arrakis",
    });
    expect(args[0]).toBe("/books/dune.m4b");
    expect(args[args.indexOf("--model") + 1]).toBe("small.en");
    expect(args[args.indexOf("--output_format") + 1]).toBe("srt,vtt,txt,json");
    expect(args[args.indexOf("--threads") + 1]).toBe("4");
    expect(args[args.indexOf("--initial_prompt") + 1]).toBe("Dune, Arrakis");
    expect(args).toContain("--word_timestamps");
  });

  it("builds a whisper.cpp command with the model file path", () => {
    const args = whisperCppArgs(
      { input: "/books/dune.m4b", outputDir: "/tmp/out", language: "en", threads: 6 },
      "/models/base.en.bin",
    );
    expect(args[args.indexOf("-m") + 1]).toBe("/models/base.en.bin");
    expect(args[args.indexOf("-of") + 1]).toBe("/tmp/out/transcript");
    expect(args).toContain("-osrt");
    expect(args[args.indexOf("-t") + 1]).toBe("6");
  });

  it("passes auto language through for whisper.cpp", () => {
    const args = whisperCppArgs({ input: "a.m4b", outputDir: "/tmp", language: "auto" }, "/m.bin");
    expect(args[args.indexOf("-l") + 1]).toBe("auto");
  });
});

describe("whisper progress parsing", () => {
  it("reads whisper.cpp percentages", () => {
    const progress = parseWhisperProgress("whisper_print_progress_callback: progress = 43%");
    expect(progress?.percent).toBe(43);
    expect(progress?.status).toBe("running");
  });

  it("reads segment counters from the python CLI", () => {
    const progress = parseWhisperProgress(" 43%|████     | 13/30 [00:12<00:16,  1.2it/s]");
    expect(progress?.percent).toBe(43);
    expect(progress?.segment).toBe("13 of 30 segments");
  });

  it("clamps and detects completion", () => {
    expect(parseWhisperProgress("progress = 140%")?.percent).toBe(100);
    expect(parseWhisperProgress("progress = 100%")?.status).toBe("done");
  });

  it("reports failures and loading states", () => {
    expect(parseWhisperProgress("error: model not found")?.status).toBe("error");
    expect(parseWhisperProgress("Detecting language using up to the first 30 seconds")?.status).toBe("loading");
    expect(parseWhisperProgress("")).toBeNull();
  });

  it("surfaces transcript lines as running segments", () => {
    const progress = parseWhisperProgress("[00:00:12.000 --> 00:00:15.000]  The spice must flow");
    expect(progress?.status).toBe("running");
    expect(progress?.segment).toBe("The spice must flow");
  });
});

describe("whisper job helpers", () => {
  it("sizes the thread pool to the machine", () => {
    expect(defaultWhisperThreads(1)).toBe(1);
    expect(defaultWhisperThreads(8)).toBe(4);
    expect(defaultWhisperThreads(64)).toBe(8);
  });

  it("lists the files a job writes", () => {
    expect(transcriptFileNames("/tmp/out/")).toEqual([
      "/tmp/out/transcript.srt",
      "/tmp/out/transcript.vtt",
      "/tmp/out/transcript.txt",
      "/tmp/out/transcript.json",
    ]);
  });
});

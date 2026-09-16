/**
 * Local transcription runner.
 *
 * Amp never ships a model and never uploads anything: it looks for a local
 * Whisper install (whisper.cpp or the OpenAI Python package), runs the job as
 * a child process, streams progress to the transcript view and writes
 * srt/vtt/txt/json into the app's transcripts folder.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  WHISPER_BINARIES,
  defaultWhisperThreads,
  openAiWhisperArgs,
  parseSubtitles,
  parseWhisperProgress,
  whisperCppArgs,
  type TranscriberJob,
  type TranscriptDoc,
} from "@amp/core";
import { logLine, paths } from "./store";

interface RunningJob {
  job: TranscriberJob;
  process: ChildProcess;
  outputDir: string;
}

const running = new Map<string, RunningJob>();
const history: TranscriberJob[] = [];
const MAX_LOG_LINES = 200;

export interface ProbeResult {
  available: boolean;
  binary?: string;
  kind?: "whisper.cpp" | "openai-whisper";
  models: string[];
  message: string;
}

let cachedProbe: ProbeResult | null = null;

async function which(binary: string): Promise<string | null> {
  const isWin = process.platform === "win32";
  const dirs = (process.env.PATH ?? "").split(isWin ? ";" : ":");
  const names = isWin ? [`${binary}.exe`, `${binary}.cmd`, binary] : [binary];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        await fs.access(candidate, fs.constants.F_OK);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/** Detect a local Whisper install and which models are already cached. */
export async function probeWhisper(force = false): Promise<ProbeResult> {
  if (cachedProbe && !force) return cachedProbe;
  const modelDir = path.join(paths.cache(), "models");
  let models: string[] = [];
  try {
    models = (await fs.readdir(modelDir)).filter((file) => file.endsWith(".bin"));
  } catch {
    /* no models cached yet */
  }

  for (const name of WHISPER_BINARIES) {
    const binary = await which(name);
    if (!binary) continue;
    const kind: ProbeResult["kind"] = /whisper|faster/i.test(name) ? "openai-whisper" : "whisper.cpp";
    cachedProbe = {
      available: true,
      binary,
      kind,
      models,
      message:
        kind === "whisper.cpp"
          ? `Using whisper.cpp at ${binary}${models.length ? ` (${models.length} model file(s) cached)` : " - no model cached yet"}`
          : `Using the Python whisper package at ${binary}`,
    };
    return cachedProbe;
  }

  cachedProbe = {
    available: false,
    models,
    message:
      "Whisper was not found. Install whisper.cpp (recommended) or `pip install openai-whisper`, then run the probe again.",
  };
  return cachedProbe;
}

export function listJobs(): TranscriberJob[] {
  return [...running.values()].map((entry) => entry.job).concat(history.slice(-30));
}

export function jobStatus(id: string): TranscriberJob | undefined {
  return running.get(id)?.job ?? history.find((job) => job.id === id);
}

function pushLog(job: TranscriberJob, line: string): void {
  job.log.push(line);
  if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
}

export interface StartOptions {
  id?: string;
  bookId: string;
  input: string;
  model?: string;
  language?: string;
  translate?: boolean;
  chapterIndexes?: number[];
}

/** Start a transcription job for one audio file. */
export async function startTranscription(options: StartOptions): Promise<TranscriberJob> {
  const probe = await probeWhisper();
  if (!probe.available || !probe.binary) throw new Error(probe.message);

  const id = options.id ?? `job_${Date.now().toString(36)}`;
  const outputDir = path.join(paths.transcripts(), options.bookId);
  await fs.mkdir(outputDir, { recursive: true });

  const threads = defaultWhisperThreads(os.cpus().length);
  const model = options.model ?? "base.en";
  const isCpp = probe.kind === "whisper.cpp";
  const modelPath = path.join(paths.cache(), "models", `${model}.bin`);
  const args = isCpp
    ? whisperCppArgs(
        { input: options.input, outputDir, language: options.language, threads, translate: options.translate },
        modelPath,
      )
    : openAiWhisperArgs({
        input: options.input,
        outputDir,
        model,
        language: options.language,
        threads,
        translate: options.translate,
        initialPrompt: "Audiobook narration",
      });

  const job: TranscriberJob = {
    id,
    bookId: options.bookId,
    chapterIndexes: options.chapterIndexes ?? [],
    status: "running",
    progress: 0,
    log: [`Whisper started with ${model} (${threads} threads)`],
    startedAt: Date.now(),
  };

  const child = spawn(probe.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  const handle = (chunk: Buffer): void => {
    for (const line of chunk.toString().split("\n")) {
      const progress = parseWhisperProgress(line);
      if (!progress) continue;
      if (typeof progress.percent === "number") job.progress = progress.percent / 100;
      if (progress.segment) pushLog(job, progress.segment);
      if (progress.status === "error") {
        job.status = "error";
        job.error = progress.message;
      }
    }
  };
  child.stdout.on("data", handle);
  child.stderr.on("data", handle);

  child.on("error", (error) => {
    job.status = "error";
    job.error = error.message;
    job.finishedAt = Date.now();
    running.delete(id);
    history.push({ ...job });
    void logLine(`whisper: job ${id} failed to start - ${error.message}`);
  });

  child.on("close", async (code) => {
    running.delete(id);
    job.finishedAt = Date.now();
    if (code === 0) {
      job.status = "done";
      job.progress = 1;
      pushLog(job, "Transcript ready");
      await logLine(`whisper: job ${id} finished for ${options.bookId}`);
    } else if (job.status !== "cancelled") {
      job.status = "error";
      job.error = job.error ?? `Whisper exited with code ${code}`;
      await logLine(`whisper: job ${id} exited with ${code}`);
    }
    history.push({ ...job });
  });

  running.set(id, { job, process: child, outputDir });
  await logLine(`whisper: job ${id} started (${model}, ${threads} threads)`);
  return job;
}

export function cancelTranscription(id: string): boolean {
  const entry = running.get(id);
  if (!entry) return false;
  entry.job.status = "cancelled";
  entry.job.finishedAt = Date.now();
  entry.process.kill("SIGTERM");
  setTimeout(() => entry.process.kill("SIGKILL"), 4000);
  running.delete(id);
  history.push({ ...entry.job });
  void logLine(`whisper: job ${id} cancelled`);
  return true;
}

/** Read the transcript a finished job left behind, as a TranscriptDoc. */
export async function readTranscript(bookId: string, model = "base.en"): Promise<TranscriptDoc | null> {
  const dir = path.join(paths.transcripts(), bookId);
  const read = async (name: string): Promise<string | null> => {
    try {
      return await fs.readFile(path.join(dir, name), "utf8");
    } catch {
      return null;
    }
  };

  const srt = (await read("transcript.srt")) ?? (await read("transcript.vtt"));
  const plain = await read("transcript.txt");
  const raw = await read("transcript.json");
  if (!srt && !plain && !raw) return null;

  let cues = srt ? parseSubtitles(srt) : [];
  let text = plain ?? cues.map((cue) => cue.text).join(" ");
  let language = "en";

  if (raw) {
    try {
      const payload = JSON.parse(raw) as {
        text?: string;
        language?: string;
        segments?: Array<{ start: number; end: number; text: string }>;
      };
      if (payload.segments?.length && cues.length === 0) {
        cues = payload.segments.map((segment) => ({
          start: segment.start,
          end: segment.end,
          text: segment.text.trim(),
        }));
      }
      if (payload.text) text = payload.text;
      if (payload.language) language = payload.language;
    } catch {
      /* json is optional */
    }
  }

  const stat = await fs.stat(path.join(dir, srt ? "transcript.srt" : "transcript.txt")).catch(() => null);
  return {
    bookId,
    language,
    model,
    createdAt: stat?.mtimeMs ?? Date.now(),
    cues,
    text: text.trim(),
  };
}

export async function listTranscriptBooks(): Promise<string[]> {
  try {
    const entries = await fs.readdir(paths.transcripts(), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

export async function deleteTranscript(bookId: string): Promise<void> {
  await fs.rm(path.join(paths.transcripts(), bookId), { recursive: true, force: true });
  await logLine(`whisper: removed transcript for ${bookId}`);
}

export function transcriberStats(): { running: number; finished: number } {
  return { running: running.size, finished: history.filter((job) => job.status === "done").length };
}

/** Absolute paths of a book's transcript files, for "reveal in folder". */
export function transcriptDir(bookId: string): string {
  return path.join(paths.transcripts(), bookId);
}

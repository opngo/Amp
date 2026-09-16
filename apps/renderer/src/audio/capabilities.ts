/**
 * What this Chromium build can actually decode.
 *
 * Amp plays whatever the engine supports, and Chromium builds differ: Electron
 * and Chrome ship AAC (which is what most .m4b audiobooks use), while a plain
 * Chromium build often does not. Asking the element up front turns a silent
 * dead player into a sentence the reader can act on.
 */

export type SourceKind = "m4b" | "mp4" | "mp3" | "flac" | "ogg" | "opus" | "wav" | "webm" | "unknown";

/**
 * Containers and the codec strings worth testing, in order of preference.
 *
 * A bare "audio/mp4" is deliberately absent for .m4b/.mp4: a build without the
 * AAC decoder still answers "maybe" for the container, which is exactly the
 * answer that hides the problem. The codec has to be named to count.
 */
const PROBES: Record<Exclude<SourceKind, "unknown">, string[]> = {
  m4b: [
    'audio/mp4; codecs="mp4a.40.2"',
    'audio/mp4; codecs="mp4a.40.5"',
    'audio/mp4; codecs="alac"',
    'audio/mp4; codecs="flac"',
    'audio/mp4; codecs="mp3"',
  ],
  mp4: [
    'audio/mp4; codecs="mp4a.40.2"',
    'audio/mp4; codecs="mp4a.40.5"',
    'audio/mp4; codecs="alac"',
    'audio/mp4; codecs="flac"',
    'audio/mp4; codecs="mp3"',
  ],
  mp3: ["audio/mpeg", 'audio/mp4; codecs="mp3"'],
  flac: ["audio/flac", 'audio/ogg; codecs="flac"'],
  ogg: ['audio/ogg; codecs="vorbis"', "audio/ogg"],
  opus: ['audio/ogg; codecs="opus"', 'audio/webm; codecs="opus"'],
  wav: ["audio/wav", "audio/x-wav", 'audio/wave; codecs="1"'],
  webm: ['audio/webm; codecs="opus"', "audio/webm"],
};

/**
 * Read the container out of a URL or a path.
 *
 * Browser clients play ``/api/audio?path=/books/Tempest.m4b``, where the
 * extension is not at the end of the string, so the whole thing is searched
 * rather than just the tail.
 */
export function sourceKindFromPath(path: string): SourceKind {
  const decoded = decodeURIComponent(path).toLowerCase();
  const match = /\.(m4b|m4a|aac|mp4|mp3|flac|oga|ogg|opus|wav|wave|weba|webm)(?![a-z0-9])/.exec(decoded);
  const extension = match?.[1] ?? "";
  switch (extension) {
    case "m4b":
    case "m4a":
    case "aac":
      return "m4b";
    case "mp4":
      return "mp4";
    case "mp3":
      return "mp3";
    case "flac":
      return "flac";
    case "ogg":
    case "oga":
      return "ogg";
    case "opus":
      return "opus";
    case "wav":
    case "wave":
      return "wav";
    case "webm":
    case "weba":
      return "webm";
    default:
      return "unknown";
  }
}

/** Human wording for the format, used in the message when decoding is refused. */
const LABELS: Record<SourceKind, string> = {
  m4b: "AAC audio in an .m4b file",
  mp4: "AAC audio in an .mp4 file",
  mp3: "MP3 audio",
  flac: "FLAC audio",
  ogg: "Ogg audio",
  opus: "Opus audio",
  wav: "WAV audio",
  webm: "WebM audio",
  unknown: "this audio format",
};

export interface DecodeVerdict {
  playable: boolean;
  kind: SourceKind;
  /** Whether this build carries the AAC decoder: what most .m4b files use. */
  aac: boolean;
  /** Empty when the format is playable or unknown to the probe. */
  reason: string;
}

/** The codec an audiobook is most likely to be in. */
const AAC_PROBES = ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.5"'];

/**
 * Test a source against the running engine. ``unknown`` extensions are left
 * alone: guessing would block files that play perfectly well.
 */
export function canPlaySource(path: string): DecodeVerdict {
  const kind = sourceKindFromPath(path);
  if (kind === "unknown" || typeof document === "undefined") {
    return { playable: true, kind, aac: true, reason: "" };
  }
  const element = document.createElement("audio");
  const aac = AAC_PROBES.some((type) => element.canPlayType(type) !== "");
  // Alternative codecs count as "might play": an .m4b holding FLAC or MP3 is
  // real, so the container alone is not grounds to refuse the file. The AAC
  // answer is kept separately, because that is what explains a failed load.
  const supported = PROBES[kind].some((type) => element.canPlayType(type) !== "");
  if (supported) return { playable: true, kind, aac, reason: "" };
  return {
    playable: false,
    kind,
    aac,
    reason: `${LABELS[kind]} is not decodable in this build of Chromium. The desktop app, Chrome and Safari all play it.`,
  };
}

/**
 * Why a source failed, when the reason can be established.
 *
 * Chromium reports one message - "no supported source" - for a missing decoder
 * and for a genuinely broken file. When a .m4b/.mp4 fails and this build has no
 * AAC decoder, that is almost certainly the answer, and it is worth saying.
 */
export function explainFailedSource(path: string): string | null {
  const verdict = canPlaySource(path);
  if (!verdict.playable) return verdict.reason;
  if ((verdict.kind === "m4b" || verdict.kind === "mp4") && !verdict.aac) {
    return `${LABELS[verdict.kind]} needs the AAC decoder, which this build of Chromium omits. The desktop app, Chrome and Safari all play it.`;
  }
  return null;
}

/** The file name inside a source URL or path, decoded, for a message. */
function nameFromSource(source: string): string {
  const withoutQuery = source.split("?")[0] ?? "";
  const last = withoutQuery.split(/[\\/]/).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * What an <audio> error code means, in words a listener can act on.
 *
 * `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) is the misleading one: Chromium reports it
 * for a missing decoder *and* for a file the page was not allowed to read, so
 * it gets the codec sentence only when this build genuinely lacks the codec,
 * and otherwise says plainly that the file could not be read.
 */
export function describeMediaError(code: number | undefined, source = ""): string {
  switch (code) {
    case 1:
      return "Playback aborted.";
    case 2:
      return "Network error while reading the audio file.";
    case 3:
      return "The file could not be decoded - it may be corrupt or an unsupported codec.";
    case 4: {
      const codec = explainFailedSource(source);
      if (codec) return codec;
      const name = nameFromSource(source);
      return name
        ? `Amp could not read ${name}. The file may have moved, or the app was not allowed to read it.`
        : "Amp could not read this file. It may have moved, or the app was not allowed to read it.";
    }
    default:
      return "Unknown playback error.";
  }
}

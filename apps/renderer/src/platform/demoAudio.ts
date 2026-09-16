/**
 * The browser demo has no files on disk, so we synthesise a pleasant
 * "narration bed" (a slow arpeggio plus a whisper of noise) as a WAV blob.
 * It makes the seek bar, EQ and visualizer genuinely interactive in the web
 * preview and in the Tailscale build.
 *
 * Generation is tiled: one 2 second pattern is rendered once and then copied
 * across the buffer with a slowly moving envelope, which keeps the cost of a
 * 10 minute demo track in the low milliseconds.
 */

const CACHE = new Map<string, string>();
const SAMPLE_RATE = 22050;
const PATTERN_SECONDS = 2;

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const length = samples.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

/** Deterministic pseudo random so a book always sounds the same. */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function renderPattern(seed: number): Float32Array {
  const frames = PATTERN_SECONDS * SAMPLE_RATE;
  const pattern = new Float32Array(frames);
  const root = 96 + (seed % 48);
  const scale = [0, 3, 5, 7, 10, 12];
  let noise = 0;
  let state = seed || 1;
  for (let i = 0; i < frames; i += 1) {
    const t = i / SAMPLE_RATE;
    const step = Math.floor(t / 0.33);
    const semitone = scale[(step + scale.length) % scale.length];
    const freq = root * 2 ** (semitone / 12);
    const env = Math.exp(-(t % 0.33) * 9) * 0.9 + 0.1;
    state = (state * 1664525 + 1013904223) % 4294967296;
    noise = noise * 0.96 + (state / 4294967296 - 0.5) * 0.04;
    const voice =
      Math.sin(2 * Math.PI * freq * t) * 0.6 +
      Math.sin(2 * Math.PI * freq * 2 * t) * 0.12 +
      Math.sin(2 * Math.PI * freq * 3.01 * t) * 0.04;
    pattern[i] = (voice * env + noise) * 0.3;
  }
  return pattern;
}

/** `seconds` of audio for a demo book, cached per seed + length. */
export function demoAudioUrl(seed: string, seconds = 600): string {
  const key = `${seed}:${seconds}`;
  const cached = CACHE.get(key);
  if (cached) return cached;

  const seedNumber = hashSeed(seed) || 1;
  const pattern = renderPattern(seedNumber);
  const total = Math.floor(seconds * SAMPLE_RATE);
  const buffer = new Float32Array(total);
  const frames = pattern.length;
  for (let offset = 0; offset < total; offset += frames) {
    // A very slow tremolo keeps the visualizer alive across the whole track.
    const gain = 0.85 + 0.15 * Math.sin((offset / SAMPLE_RATE) * 0.06);
    const end = Math.min(total, offset + frames);
    for (let i = offset, j = 0; i < end; i += 1, j += 1) {
      buffer[i] = pattern[j] * gain;
    }
  }

  const url = URL.createObjectURL(encodeWav(buffer, SAMPLE_RATE));
  CACHE.set(key, url);
  return url;
}

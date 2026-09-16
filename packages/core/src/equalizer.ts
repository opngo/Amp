/**
 * 10 band parametric-ish equalizer maths. The renderer feeds the gains into a
 * WebAudio BiquadFilter chain; the Python/TUI tools reuse the presets for CLI
 * previews, and tests pin the interpolation behaviour.
 */

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;

export interface EqPreset {
  id: string;
  name: string;
  /** Gains in dB for the 10 EQ_BANDS, in order. */
  gains: number[];
  preamp?: number;
}

export const EQ_PRESETS: EqPreset[] = [
  { id: "flat", name: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "spoken", name: "Audiobook (clear voice)", gains: [-3, -2, -1, 1, 3, 4, 3, 1, -1, -2], preamp: 1 },
  { id: "podcast", name: "Podcast / radio", gains: [-4, -3, -1, 2, 4, 4, 2, 0, -2, -3], preamp: 1.5 },
  { id: "loudness", name: "Loudness night mode", gains: [-6, -4, -1, 2, 3, 2, 1, 0, -1, -3], preamp: 3 },
  { id: "bass", name: "Bass boost", gains: [7, 6, 4, 2, 0, 0, 0, 0, 0, 0], preamp: -1 },
  { id: "basscut", name: "Bass cut (thin walls)", gains: [-9, -7, -5, -2, 0, 1, 2, 2, 1, 0] },
  { id: "treble", name: "Treble boost", gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 6], preamp: -1 },
  { id: "vocal", name: "Vocal forward", gains: [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1] },
  { id: "cinema", name: "Cinema", gains: [5, 4, 2, 1, -1, -1, 1, 3, 4, 4] },
  { id: "sleep", name: "Soft / sleep", gains: [-5, -4, -3, -1, 1, 2, 2, 1, -1, -4], preamp: 2 },
  { id: "walk", name: "Walking (traffic)", gains: [-8, -5, -2, 1, 4, 5, 4, 2, 0, -1], preamp: 2 },
];

export function presetById(id: string): EqPreset {
  return EQ_PRESETS.find((p) => p.id === id) ?? EQ_PRESETS[0];
}

export function clampGain(db: number): number {
  return Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, db));
}

/** Linear amplitude multiplier for a dB gain. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-6, gain));
}

/**
 * Resample a preset onto an arbitrary number of bands (WebAudio nodes are
 * configurable in settings) using linear interpolation over log frequency.
 */
export function resampleGains(gains: number[], bandCount: number): number[] {
  if (gains.length === 0) return new Array(bandCount).fill(0);
  if (gains.length === bandCount) return [...gains];
  const srcMax = EQ_BANDS[EQ_BANDS.length - 1];
  const srcMin = EQ_BANDS[0];
  const out: number[] = [];
  for (let i = 0; i < bandCount; i += 1) {
    const freq = 20 * (20000 / 20) ** (i / Math.max(1, bandCount - 1));
    const t = (Math.log(freq) - Math.log(srcMin)) / (Math.log(srcMax) - Math.log(srcMin));
    const pos = Math.max(0, Math.min(gains.length - 1, t * (gains.length - 1)));
    const lo = Math.floor(pos);
    const hi = Math.min(gains.length - 1, lo + 1);
    out.push(gains[lo] + (gains[hi] - gains[lo]) * (pos - lo));
  }
  return out;
}

/**
 * Automatic headroom so a boosted EQ never clips. Returns a preamp in dB that
 * the caller applies to the audio gain node.
 */
export function autoPreamp(gains: number[], userPreamp = 0): number {
  const max = Math.max(0, ...gains);
  const min = Math.min(0, ...gains);
  const headroom = -Math.max(0, max);
  const makeup = min < 0 ? Math.min(2, -min * 0.25) : 0;
  return clampPreamp(headroom + makeup + userPreamp);
}

export function clampPreamp(db: number): number {
  return Math.max(-18, Math.min(12, db));
}

/** Simple RMS/peak driven level meter used by the player UI. */
export function meterLevel(samples: Float32Array | number[], peak = false): number {
  if (!samples.length) return 0;
  let acc = 0;
  let max = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i]);
    acc += v * v;
    if (v > max) max = v;
  }
  const rms = Math.sqrt(acc / samples.length);
  const value = peak ? max : rms * 1.6;
  return Math.max(0, Math.min(1, value));
}

export function eqBandsFor(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(Math.round(20 * (20000 / 20) ** (i / Math.max(1, count - 1))));
  }
  return out;
}

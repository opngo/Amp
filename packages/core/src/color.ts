/**
 * Adaptive colour engine.
 *
 * `extractPalette` works on raw RGBA pixels so the exact same maths can be
 * reused by the Electron renderer (Canvas ImageData), the Python tools
 * (PNG decode) and the unit tests (hand built pixel buffers).
 */

import type { Palette } from "./types";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function hexToRgb(hex: string): RGB {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const int = Number.parseInt(h, 16);
  if (Number.isNaN(int)) return { r: 0, g: 0, b: 0 };
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const to = (v: number) => clampByte(Math.round(v)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, v));
}

export function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      default:
        h = ((rn - gn) / d + 4) * 60;
    }
  }
  return { h, s, l };
}

/** Shortest distance between two hues, in degrees (0 - 180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function hslToRgb({ h, s, l }: { h: number; s: number; l: number }): RGB {
  const hh = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(hue(hh + 1 / 3) * 255),
    g: Math.round(hue(hh) * 255),
    b: Math.round(hue(hh - 1 / 3) * 255),
  };
}

export function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function mix(a: RGB, b: RGB, amount: number): RGB {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** Push a colour to a readable tone against a dark or light surface. */
export function readable(rgb: RGB, dark: boolean, minLightness = 0.34, maxLightness = 0.78): RGB {
  const hsl = rgbToHsl(rgb);
  const l = dark
    ? Math.min(maxLightness, Math.max(minLightness, hsl.l))
    : Math.max(0.16, Math.min(0.62, hsl.l));
  const s = Math.max(0.18, Math.min(0.85, hsl.s * 1.15));
  return hslToRgb({ h: hsl.h, s, l: dark ? l : Math.min(l, 0.55) });
}

export interface PixelSource {
  data: Uint8ClampedArray | Uint8Array | number[];
  width: number;
  height: number;
}

export interface PaletteOptions {
  /** Sample stride in px, higher = faster. */
  stride?: number;
  /** Buckets per channel when quantising. */
  buckets?: number;
  /** Prefer palettes that fit a dark UI. */
  dark?: boolean;
}

/**
 * Median-cut-lite quantiser: bucket the image, score buckets by
 * population * saturation * mid-luminance, then build a UI palette.
 */
export function extractPalette(source: PixelSource, options: PaletteOptions = {}): Palette {
  const { stride = 4, buckets = 5, dark = true } = options;
  const { data, width, height } = source;
  const totals = new Map<number, { count: number; r: number; g: number; b: number }>();
  let lumSum = 0;
  let samples = 0;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const i = (y * width + x) * 4;
      const a = data[i + 3];
      if (a !== undefined && a < 125) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r === undefined || g === undefined || b === undefined) continue;
      // Ignore near-black / near-white poster noise.
      const lum = relativeLuminance({ r, g, b });
      lumSum += lum;
      samples += 1;
      if (lum < 0.02 || lum > 0.96) continue;
      const key = (((r / 255) * buckets) << 8) + (((g / 255) * buckets) << 4) + ((b / 255) * buckets);
      const entry = totals.get(key);
      if (entry) {
        entry.count += 1;
        entry.r += r;
        entry.g += g;
        entry.b += b;
      } else {
        totals.set(key, { count: 1, r, g, b });
      }
    }
  }

  const luminance = samples ? lumSum / samples : 0.2;
  const candidates = [...totals.values()]
    .map((bucket) => {
      const rgb = {
        r: bucket.r / bucket.count,
        g: bucket.g / bucket.count,
        b: bucket.b / bucket.count,
      };
      const hsl = rgbToHsl(rgb);
      // Saturated mid tones look best as UI accents.
      const score =
        bucket.count *
        (0.35 + hsl.s * 1.6) *
        (1 - Math.abs(hsl.l - (dark ? 0.5 : 0.42)) * 1.25);
      return { rgb, score, hsl };
    })
    .sort((a, b) => b.score - a.score);

  const fallback: RGB = dark ? { r: 96, g: 110, b: 168 } : { r: 82, g: 96, b: 150 };
  const primary = readable(candidates[0]?.rgb ?? fallback, dark);
  const primaryHue = rgbToHsl(primary).h;
  /*
   * The secondary and the accent are two more colours that are actually in the
   * artwork: the next clusters whose hue is far enough from the ones already
   * taken to read as separate colours. A cover with a single flat colour has no
   * third cluster, and only then does the accent fall back to a shifted hue of
   * the primary - the interface should never invent a colour the cover does not
   * have when there is one to use instead.
   */
  const distinct = (candidate: { rgb: RGB; hsl: { h: number } } | undefined, taken: number[]) =>
    Boolean(
      candidate &&
        candidate.rgb !== candidates[0]?.rgb &&
        taken.every((hue) => hueDistance(candidate.hsl.h, hue) > 18),
    );
  const second = candidates.find((c) => distinct(c, [primaryHue]));
  const secondary = readable(second?.rgb ?? mix(primary, dark ? { r: 12, g: 14, b: 20 } : { r: 250, g: 250, b: 255 }, 0.45), dark);
  const secondaryHue = rgbToHsl(secondary).h;
  const third = candidates.find((c) => distinct(c, [primaryHue, secondaryHue]));
  const accent = readable(
    third?.rgb ?? hslToRgb({ h: (primaryHue + 32) % 360, s: 0.72, l: 0.58 }),
    dark,
  );
  const primaryRgb = primary;
  const base = dark ? { r: 9, g: 10, b: 14 } : { r: 250, g: 250, b: 252 };

  // Every stop is a cover colour thinned towards the page, so the player's
  // gradient is the artwork's palette and not a theme of its own.
  const gradient = [
    rgbToHex(mix(primaryRgb, base, 0.82)),
    rgbToHex(mix(primaryRgb, base, 0.66)),
    rgbToHex(mix(secondary, base, 0.78)),
    rgbToHex(mix(accent, base, 0.86)),
  ];

  return {
    primary: rgbToHex(primary),
    secondary: rgbToHex(secondary),
    accent: rgbToHex(accent),
    text: dark ? "#f4f6fb" : "#10131a",
    muted: dark ? "rgba(244,246,251,0.62)" : "rgba(16,19,26,0.6)",
    gradient,
    luminance,
    dark: luminance < 0.55 ? true : !dark ? false : dark,
  };
}

/** A pleasant palette for books that have no cover art at all. */
export function paletteFromSeed(seed: string, dark = true): Palette {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash) % 360;
  // A seeded colour only has to tint the interface, and on a white page a
  // saturated mix towards black turns into grey mud: keep light mode softer.
  const primary = hslToRgb({ h: hue, s: dark ? 0.52 : 0.36, l: dark ? 0.52 : 0.54 });
  const secondary = hslToRgb({ h: (hue + 48) % 360, s: dark ? 0.44 : 0.28, l: dark ? 0.42 : 0.48 });
  const base = dark ? { r: 9, g: 10, b: 14 } : { r: 250, g: 250, b: 252 };
  return {
    primary: rgbToHex(primary),
    secondary: rgbToHex(secondary),
    accent: rgbToHex(hslToRgb({ h: (hue + 180) % 360, s: 0.6, l: 0.6 })),
    text: dark ? "#f4f6fb" : "#10131a",
    muted: dark ? "rgba(244,246,251,0.62)" : "rgba(16,19,26,0.6)",
    gradient: [
      rgbToHex(mix(primary, base, 0.8)),
      rgbToHex(mix(primary, base, 0.62)),
      rgbToHex(mix(secondary, base, 0.86)),
      rgbToHex(mix(primary, base, 0.95)),
    ],
    luminance: dark ? 0.18 : 0.72,
    dark,
  };
}

/** CSS declarations for the app background gradient. */
/**
 * Alpha-blended version of a colour, for the soft ambient tint. Keeping the
 * alpha in the gradient (rather than in a CSS opacity) means the tint can be
 * layered over the white page without washing out text or artwork.
 */
function soften(color: string, alpha: number): string {
  const hex = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  const parts = short
    ? [short[1] + short[1], short[2] + short[2], short[3] + short[3]]
    : long
      ? [long[1], long[2], long[3]]
      : null;
  if (!parts) return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`;
  const [r, g, b] = parts.map((part) => Number.parseInt(part, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

export function gradientCss(palette: Palette, mode: string, intensity = 1): string {
  const stops = palette.gradient;
  const a = Math.max(0.15, Math.min(1, intensity));
  if (mode === "off") return "none";
  if (mode === "solid") return palette.gradient[3];
  if (mode === "ambient") {
    // The default: three soft colour clouds that drift behind a white page.
    // Subtle by design - the accent colour and the movement are the effect,
    // not a saturated wallpaper.
    const [first, second, third] = stops;
    return [
      `radial-gradient(52% 46% at 8% 4%, ${soften(first, 0.5)} 0%, transparent 68%)`,
      `radial-gradient(46% 42% at 92% 8%, ${soften(second, 0.42)} 0%, transparent 70%)`,
      `radial-gradient(64% 54% at 46% 106%, ${soften(third, 0.4)} 0%, transparent 72%)`,
    ].join(", ");
  }
  if (mode === "mesh") {
    return [
      `radial-gradient(60% 55% at 12% 8%, ${stops[0]} 0%, transparent 60%)`,
      `radial-gradient(55% 60% at 88% 12%, ${stops[1]} 0%, transparent 62%)`,
      `radial-gradient(70% 60% at 50% 108%, ${stops[2]} 0%, transparent 65%)`,
      stops[3],
    ].join(", ");
  }
  return `linear-gradient(155deg, ${stops[0]} 0%, ${stops[1]} ${Math.round(38 * a)}%, ${stops[2]} 72%, ${stops[3]} 100%)`;
}

/** Returns a cover-matched text colour for chips and badges. */
export function onColor(rgb: RGB): string {
  return relativeLuminance(rgb) > 0.45 ? "#0b0d12" : "#ffffff";
}

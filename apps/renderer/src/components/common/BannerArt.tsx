/**
 * Wide artwork for a book.
 *
 * Audiobooks ship a square cover, not a banner, so every place that wants 16:9
 * art (Home, the player backdrop, the book header) would otherwise crop the
 * cover or show an empty rectangle. The rules here:
 *
 *  1. If the book has a banner of its own, use it, untoucheffekt.
 *  2. Otherwise draw one: soft abstract shapes seeded from the book id, in the
 *     colours of its cover. No text, no title, nothing that pretends to be
 *     artwork the book actually has - it is a generated gradient, and it is
 *     different for every book.
 *
 * The drawing is inline SVG, so it costs nothing, scales to any box and works
 * in the Electron window, the web build and the sandboxed preview alike.
 */

import { useMemo } from "react";
import { paletteFromSeed, type Book, type Palette } from "@amp/core";
import { useBannerSrc } from "../../platform/artwork";

/** FNV-1a: the same seed always gives the same artwork. */
export function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) || 1;
}

/** Small deterministic PRNG, so shapes look scattered without looking random. */
function mulberry(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BannerShape {
  cx: number;
  cy: number;
  r: number;
  opacity: number;
  color: string;
}

export interface BannerPlan {
  id: string;
  from: string;
  via: string;
  to: string;
  shapes: BannerShape[];
  angle: number;
  sheen: number;
}

/** The colours a banner is drawn with: the cover palette when known. */
export function bannerPalette(palette: Palette | null, seed: string): [string, string, string] {
  if (palette) return [palette.primary, palette.secondary, palette.accent];
  const fallback = paletteFromSeed(seed, false);
  return [fallback.primary, fallback.secondary, fallback.accent];
}

export function planBanner(seed: string, palette: Palette | null): BannerPlan {
  const numeric = seedFrom(seed);
  const random = mulberry(numeric);
  const [primary, secondary, accent] = bannerPalette(palette, seed);
  const shapes: BannerShape[] = [];
  for (let index = 0; index < 5; index += 1) {
    shapes.push({
      cx: 20 + random() * 280,
      cy: 10 + random() * 160,
      r: 46 + random() * 96,
      opacity: 0.28 + random() * 0.4,
      color: [primary, secondary, accent][index % 3],
    });
  }
  return {
    id: `bn${numeric.toString(36)}`,
    from: primary,
    via: secondary,
    to: accent,
    shapes,
    angle: 20 + random() * 140,
    sheen: 0.06 + random() * 0.1,
  };
}

export function BannerArt({
  book,
  palette = null,
  className = "amp-banner",
  blur = 0,
}: {
  book: Pick<Book, "id" | "title" | "bannerDataUrl" | "bannerUrl" | "bannerPath">;
  palette?: Palette | null;
  className?: string;
  /** Rounds of blur applied to the generated art (for backdrops). */
  blur?: number;
}) {
  const plan = useMemo(() => planBanner(`${book.id}:${book.title}`, palette), [book.id, book.title, palette]);
  // A configured banner goes through the same resolver as a cover: an absolute
  // path from a desktop library is not a URL, and only the bridge knows that.
  const configured = useBannerSrc(book);

  if (configured) {
    return <img className={className} src={configured} alt="" draggable={false} />;
  }

  return (
    <svg
      className={className}
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      focusable="false"
      style={blur ? { filter: `blur(${blur}px)` } : undefined}
    >
      <defs>
        <linearGradient id={`${plan.id}-base`} gradientTransform={`rotate(${plan.angle} 0.5 0.5)`}>
          <stop offset="0%" stopColor={plan.from} />
          <stop offset="55%" stopColor={plan.via} />
          <stop offset="100%" stopColor={plan.to} />
        </linearGradient>
        <radialGradient id={`${plan.id}-sheen`} cx="20%" cy="0%" r="90%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity={plan.sheen * 4} />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <filter id={`${plan.id}-soft`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
      </defs>
      <rect width="320" height="180" fill={`url(#${plan.id}-base)`} />
      <g filter={`url(#${plan.id}-soft)`}>
        {plan.shapes.map((shape, index) => (
          <circle
            key={index}
            cx={shape.cx}
            cy={shape.cy}
            r={shape.r}
            fill={shape.color}
            opacity={shape.opacity}
          />
        ))}
      </g>
      <rect width="320" height="180" fill={`url(#${plan.id}-sheen)`} />
    </svg>
  );
}

/**
 * The book's own banner as a plain image.
 *
 * Exists so a caller that may be rendering without a book (the picker dialogs,
 * before a book is chosen) can still honour the rules of hooks: the hook lives
 * in here, behind the null check.
 */
export function BannerImage({
  book,
  className = "",
  style,
}: {
  book: Pick<Book, "id" | "bannerDataUrl" | "bannerUrl" | "bannerPath">;
  className?: string;
  style?: React.CSSProperties;
}) {
  const src = useBannerSrc(book);
  if (!src) return null;
  return <img className={className} src={src} alt="" draggable={false} style={style} />;
}

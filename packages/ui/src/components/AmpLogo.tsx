import type { CSSProperties } from "react";

/**
 * The Amp mark: a cover square with circles riding around it, in the brand
 * gradient.
 *
 * It is the player's own shape reduced to a logo - the same picture the
 * visualizer draws over the artwork - and the same geometry that
 * `scripts/make-icons.mjs` renders for the app icon, written against the same
 * 512 unit grid so the two can never drift apart. Drawn inline, so it scales,
 * can fall back to `currentColor`, and needs no asset pipeline.
 */
export interface AmpLogoProps {
  size?: number;
  /** Render as a single flat colour (inherits `currentColor`). */
  mono?: boolean;
  style?: CSSProperties;
  title?: string;
}

/** Geometry on the 512 grid, matching MARK in scripts/make-icons.mjs. */
const TILE = { x: 30.7, y: 30.7, side: 450.6, radius: 112.6 };
const COVER = { x: 190.5, y: 190.5, side: 131, radius: 20.5 };
const RINGS = [
  { r: 105, width: 13.8, opacity: 0.94 },
  { r: 139.3, width: 12.3, opacity: 0.6 },
  { r: 173.6, width: 10.8, opacity: 0.32 },
];
const SMALL_RING = { r: 128, width: 25.6, opacity: 0.88 };

/**
 * The mark simplifies as it shrinks, exactly as the icon files do: three
 * hairlines turn into mud in a 26 px sidebar, and below that only the cover
 * square survives.
 */
function ringsFor(size: number) {
  if (size >= 40) return RINGS;
  if (size >= 26) return [SMALL_RING];
  return [];
}

export function AmpLogo({ size = 32, mono = false, style, title = "Amp" }: AmpLogoProps) {
  const gradientId = `amp-logo-${mono ? "mono" : "grad"}-${Math.round(size)}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role="img"
      aria-label={title}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
    >
      {!mono && (
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#6c8cff" />
            <stop offset="100%" stopColor="#ff9ecb" />
          </linearGradient>
        </defs>
      )}
      <rect
        x={TILE.x}
        y={TILE.y}
        width={TILE.side}
        height={TILE.side}
        rx={TILE.radius}
        fill={mono ? "currentColor" : `url(#${gradientId})`}
      />
      {ringsFor(size).map((ring) => (
        <circle
          key={ring.r}
          cx={256}
          cy={256}
          r={ring.r}
          fill="none"
          stroke="#ffffff"
          strokeWidth={ring.width}
          opacity={ring.opacity}
        />
      ))}
      <rect
        x={COVER.x}
        y={COVER.y}
        width={COVER.side}
        height={COVER.side}
        rx={COVER.radius}
        fill="#ffffff"
        opacity="0.96"
      />
    </svg>
  );
}

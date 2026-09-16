#!/usr/bin/env node
/**
 * Generates the Amp brand assets from one source of truth.
 *
 * The mark is the player's own shape, reduced to a logo: a cover square with
 * circles riding around it, on the Amp gradient. It is the same picture the
 * visualizer draws over the artwork, which is what makes the icon recognisable
 * next to the app instead of merely related to it. AmpLogo in packages/ui draws
 * the same geometry inline. Running this script rewrites:
 *
 *   apps/desktop/resources/icon.png        1024 px app icon
 *   apps/desktop/resources/tray.png         32 px tray icon
 *   apps/desktop/resources/tray@2x.png      64 px tray icon (retina)
 *   apps/website/public/icon.png           512 px site icon
 *   assets/icon.png                        512 px repository icon
 *   assets/logo.svg                        the vector source
 *   apps/desktop/resources/icon.svg        the same vector, next to the app icon
 *
 * No dependencies: PNG encoding here is a few lines of zlib plus a CRC.
 *
 *   node scripts/make-icons.mjs
 *   node scripts/make-icons.mjs --sizes 1024,512,256
 */

import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ drawing */

const FROM = [0x6c, 0x8c, 0xff];
const TO = [0xff, 0x9e, 0xcb];

/**
 * The mark, as fractions of the canvas.
 *
 * A cover square in the middle, and rings around it whose alpha falls off
 * outward - the visualizer's decay, in one frame. Everything is a distance
 * field, so the shape is identical at 32 px and at 1024 px.
 */
const MARK = {
  /** Tile: the app icon's rounded square, inset from the canvas edge. */
  tileHalf: 0.44,
  tileRadius: 0.22,
  /** The cover itself, centred and white. */
  coverHalf: 0.128,
  coverRadius: 0.04,
  coverAlpha: 0.96,
  /** Rings, innermost first: the closest one clears the cover's corners. */
  rings: [
    { radius: 0.205, thickness: 0.027, alpha: 0.94 },
    { radius: 0.272, thickness: 0.024, alpha: 0.6 },
    { radius: 0.339, thickness: 0.021, alpha: 0.32 },
  ],
  /**
   * One ring for the small sizes, pushed out far enough to stay a ring: at
   * 64 px the innermost ring of the full mark would touch the cover's corners
   * and the two shapes would fuse into a white blob.
   */
  smallRing: { radius: 0.25, thickness: 0.05, alpha: 0.88 },
};

/**
 * The mark simplifies as it shrinks: three hairline rings turn into mud below
 * 160 px, and a tray icon below 48 px is legible only as the cover square on its
 * own tile.
 */
function ringsFor(size) {
  if (size >= 160) return MARK.rings;
  if (size >= 48) return [MARK.smallRing];
  return [];
}

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/** Signed distance from a point to a rounded rectangle, negative inside. */
function roundedRectDistance(x, y, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x) - (halfWidth - radius);
  const dy = Math.abs(y) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Renders the mark at `size` pixels.
 *
 * Bars became rings: the cover square keeps the middle, the rings around it are
 * clipped to the tile, and the whole thing is anti-aliased by sampling coverage.
 * The ring count follows the size - a 32 px tray icon gets one ring, the app
 * icon gets all three.
 */
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const centre = size / 2;
  const tileHalf = size * MARK.tileHalf;
  const tileRadius = size * MARK.tileRadius;
  const coverHalf = size * MARK.coverHalf;
  const coverRadius = size * MARK.coverRadius;
  const rings = ringsFor(size);
  const samples = size >= 256 ? 3 : 4;
  const total = samples * samples;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let coverage = 0;
      let whiteSum = 0;
      let shade = [0, 0, 0];

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = px + (sx + 0.5) / samples;
          const y = py + (sy + 0.5) / samples;
          const dx = x - centre;
          const dy = y - centre;
          const insideTile = roundedRectDistance(dx, dy, tileHalf, tileHalf, tileRadius) <= 0;
          if (!insideTile) continue;

          coverage += 1;
          shade = mix(FROM, TO, (dx + tileHalf) / (tileHalf * 2));

          // The cover square, then the rings, drawn white over the gradient.
          let white = 0;
          if (roundedRectDistance(dx, dy, coverHalf, coverHalf, coverRadius) <= 0) {
            white = MARK.coverAlpha;
          }
          const distance = Math.hypot(dx, dy);
          for (const ring of rings) {
            const edge = Math.abs(distance - ring.radius * size) - (ring.thickness * size) / 2;
            if (edge <= 0) white = Math.max(white, ring.alpha);
          }
          whiteSum += white;
        }
      }

      const alpha = Math.round((coverage / total) * 255);
      const white = whiteSum / total;
      const base = coverage ? shade : [0, 0, 0];
      const offset = (py * size + px) * 4;
      pixels[offset] = Math.round(base[0] + (255 - base[0]) * white);
      pixels[offset + 1] = Math.round(base[1] + (255 - base[1]) * white);
      pixels[offset + 2] = Math.round(base[2] + (255 - base[2]) * white);
      pixels[offset + 3] = Math.round(Math.max(alpha, white * 255));
    }
  }

  return pixels;
}

/* ------------------------------------------------------------- png encoding */

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    raw[row * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, row * stride, stride).copy(raw, row * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------- assets */

function logoSvg(size = 512) {
  const inset = size * (0.5 - MARK.tileHalf);
  const rings = MARK.rings
    .map(
      (ring) =>
        `  <circle cx="${(size / 2).toFixed(1)}" cy="${(size / 2).toFixed(1)}" r="${(ring.radius * size).toFixed(1)}" fill="none" stroke="#ffffff" stroke-width="${(ring.thickness * size).toFixed(1)}" opacity="${ring.alpha}"/>`,
    )
    .join("\n");
  const coverSide = MARK.coverHalf * 2 * size;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Amp">
  <defs>
    <linearGradient id="amp" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6c8cff"/>
      <stop offset="100%" stop-color="#ff9ecb"/>
    </linearGradient>
  </defs>
  <rect x="${inset.toFixed(1)}" y="${inset.toFixed(1)}" width="${(MARK.tileHalf * 2 * size).toFixed(1)}" height="${(MARK.tileHalf * 2 * size).toFixed(1)}" rx="${(MARK.tileRadius * size).toFixed(1)}" fill="url(#amp)"/>
${rings}
  <rect x="${((size - coverSide) / 2).toFixed(1)}" y="${((size - coverSide) / 2).toFixed(1)}" width="${coverSide.toFixed(1)}" height="${coverSide.toFixed(1)}" rx="${(MARK.coverRadius * size).toFixed(1)}" fill="#ffffff" opacity="${MARK.coverAlpha}"/>
</svg>
`;
}

const TARGETS = [
  { file: "apps/desktop/resources/icon.png", size: 1024 },
  { file: "apps/desktop/resources/tray.png", size: 32 },
  { file: "apps/desktop/resources/tray@2x.png", size: 64 },
  { file: "apps/website/public/icon.png", size: 512 },
  { file: "assets/icon.png", size: 512 },
];

async function main() {
  const argv = process.argv.slice(2);
  const sizesArg = argv.indexOf("--sizes");
  const wanted = sizesArg >= 0 ? argv[sizesArg + 1].split(",").map(Number) : null;
  const cache = new Map();

  const render = (size) => {
    if (!cache.has(size)) cache.set(size, renderIcon(size));
    return cache.get(size);
  };

  for (const target of TARGETS) {
    if (wanted && !wanted.includes(target.size)) continue;
    const absolute = path.join(root, target.file);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, encodePng(render(target.size), target.size));
    console.log(`${target.file}  ${target.size}x${target.size}  ${(await import("node:fs")).statSync(absolute).size} bytes`);
  }

  if (!wanted || wanted.includes(512)) {
    const svg = logoSvg(512);
    for (const file of ["assets/logo.svg", "apps/desktop/resources/icon.svg"]) {
      const svgPath = path.join(root, file);
      await mkdir(path.dirname(svgPath), { recursive: true });
      await writeFile(svgPath, svg, "utf8");
      console.log(`${file}  vector source`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

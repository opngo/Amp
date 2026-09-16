import { describe, expect, it } from "vitest";
import { contrastRatio, extractPalette, gradientCss, hexToRgb, hueDistance, mix, paletteFromSeed, readable, relativeLuminance, rgbToHex, rgbToHsl, hslToRgb } from "../color";

function pixels(width: number, height: number, color: [number, number, number]): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

function bands(colors: Array<[number, number, number]>, width = 30, height = 30): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const color = colors[Math.floor((y / height) * colors.length)] ?? colors[0]!;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("colour maths", () => {
  it("round trips hex", () => {
    expect(rgbToHex(hexToRgb("#ff8800"))).toBe("#ff8800");
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(rgbToHex(hexToRgb("nonsense"))).toBe("#000000");
  });

  it("round trips hsl", () => {
    const rgb = { r: 200, g: 40, b: 90 };
    const back = hslToRgb(rgbToHsl(rgb));
    expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
  });

  it("computes luminance and contrast", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 3);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 3);
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeGreaterThan(20);
  });

  it("mixes colours", () => {
    expect(mix({ r: 0, g: 0, b: 0 }, { r: 100, g: 100, b: 100 }, 0.5)).toEqual({ r: 50, g: 50, b: 50 });
  });

  it("keeps accent colours readable on dark surfaces", () => {
    const dark = readable({ r: 10, g: 10, b: 12 }, true);
    const hsl = rgbToHsl(dark);
    expect(hsl.l).toBeGreaterThanOrEqual(0.3);
    expect(hsl.l).toBeLessThanOrEqual(0.8);
  });
});

describe("extractPalette", () => {
  it("returns the obvious colour for a flat cover", () => {
    const palette = extractPalette(pixels(40, 40, [220, 60, 40]));
    const primary = hexToRgb(palette.primary);
    const hsl = rgbToHsl(primary);
    expect(hsl.h).toBeLessThan(30);
    expect(hsl.s).toBeGreaterThan(0.3);
    expect(palette.gradient).toHaveLength(4);
  });

  it("takes every accent colour from the artwork", () => {
    // Three flat bands: a cover with three real colours. All three palette
    // colours must be hues the cover actually has, not a hue shifted off the
    // primary - that is the whole point of adapting to the artwork.
    const source: Array<[number, number, number]> = [
      [214, 54, 48],
      [42, 92, 214],
      [58, 168, 96],
    ];
    const palette = extractPalette(bands(source), { stride: 1, dark: false });
    const sourceHues = source.map(([r, g, b]) => rgbToHsl({ r, g, b }).h);
    for (const hex of [palette.primary, palette.secondary, palette.accent]) {
      const hue = rgbToHsl(hexToRgb(hex)).h;
      const nearest = Math.min(...sourceHues.map((candidate) => hueDistance(hue, candidate)));
      expect(nearest).toBeLessThan(24);
    }
    // And the three stay apart, or the palette collapses into one colour.
    const picked = [palette.primary, palette.secondary, palette.accent].map(
      (hex) => rgbToHsl(hexToRgb(hex)).h,
    );
    expect(hueDistance(picked[0]!, picked[1]!)).toBeGreaterThan(18);
    expect(hueDistance(picked[0]!, picked[2]!)).toBeGreaterThan(18);
  });

  it("falls back to a shifted primary when the cover has one colour", () => {
    const palette = extractPalette(pixels(30, 30, [220, 60, 40]), { stride: 1, dark: false });
    const primaryHue = rgbToHsl(hexToRgb(palette.primary)).h;
    const accentHue = rgbToHsl(hexToRgb(palette.accent)).h;
    expect(hueDistance(primaryHue, accentHue)).toBeGreaterThan(18);
  });

  it("ignores transparent pixels", () => {
    const { data, width, height } = pixels(20, 20, [30, 200, 120]);
    for (let i = 0; i < width * height; i += 1) {
      if (i % 2 === 0) data[i * 4 + 3] = 0;
    }
    const palette = extractPalette({ data, width, height });
    expect(palette.primary).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("produces a dark flag consistent with the luminance", () => {
    const palette = extractPalette(pixels(20, 20, [250, 250, 250]));
    expect(typeof palette.dark).toBe("boolean");
    expect(palette.luminance).toBeGreaterThan(0.5);
  });

  it("builds gradient css for each mode", () => {
    const palette = paletteFromSeed("dune");
    expect(gradientCss(palette, "solid")).toMatch(/^#/);
    expect(gradientCss(palette, "mesh")).toContain("radial-gradient");
    expect(gradientCss(palette, "cover-gradient", 0.5)).toContain("linear-gradient");
  });
});

describe("paletteFromSeed", () => {
  it("is deterministic and always usable", () => {
    const a = paletteFromSeed("Frank Herbert - Dune");
    const b = paletteFromSeed("Frank Herbert - Dune");
    expect(a).toEqual(b);
    expect(a.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(paletteFromSeed("Other").primary).not.toBe(a.primary);
  });
});

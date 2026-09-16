/**
 * Extract the adaptive palette from a book's cover. Runs on a 32x32 canvas so
 * it costs well under a millisecond, then hands the result to the theme layer.
 */

import { useEffect, useState } from "react";
import { extractPalette, paletteFromSeed, type Palette } from "@amp/core";
import { useSettingsStore } from "../store/useSettingsStore";
import { resolveTheme } from "../store/theme";

const cache = new Map<string, Palette>();

/**
 * Fallback palettes are seeded per book, and the seed has to know which way the
 * interface leans: mixed towards black a seeded colour reads as grey mud on a
 * white page, which is exactly the look this app is trying to avoid.
 */
function useSeededPalette(): (seed: string) => Palette {
  const theme = useSettingsStore((s) => s.settings.theme);
  const prefersDark =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  const dark = resolveTheme({ theme } as Parameters<typeof resolveTheme>[0], prefersDark);
  return (seed: string) => {
    const key = `${dark ? "dark" : "light"}:${seed}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const palette = paletteFromSeed(seed, dark);
    cache.set(key, palette);
    return palette;
  };
}

export function paletteForSeed(seed: string, dark = false): Palette {
  const key = cacheKey(dark, seed);
  const cached = cache.get(key);
  if (cached) return cached;
  const palette = paletteFromSeed(seed, dark);
  cache.set(key, palette);
  return palette;
}

/** The active book drives the window theme; cards only preview their own. */
function setPaletteInStore(palette: Palette, set: (p: Palette | null) => void) {
  set(palette);
}

/*
 * Which way the interface leans decides how the cover's colours are lifted: the
 * same artwork has to give a deeper primary on a white page and a lighter one on
 * a dark page, or the accent disappears into the background. The cache key
 * carries the answer, since both variants are worth keeping.
 */
function useThemeIsDark(): boolean {
  const theme = useSettingsStore((s) => s.settings.theme);
  const prefersDark =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false;
  return resolveTheme({ theme } as Parameters<typeof resolveTheme>[0], prefersDark);
}

function cacheKey(dark: boolean, key: string): string {
  return `${dark ? "dark" : "light"}:${key}`;
}

/**
 * Read a cover and hand back the palette built from its own colours.
 *
 * The extraction runs on a 32x32 canvas, so it costs well under a millisecond,
 * and it is told which way the interface leans: the same artwork has to give a
 * deeper colour on a white page and a lighter one on a dark page.
 */
function readCover(key: string, dark: boolean): Promise<Palette> {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(image, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size);
        resolve(extractPalette({ data: data.data, width: size, height: size }, { stride: 2, dark }));
      } catch {
        resolve(paletteFromSeed(key, dark));
      }
    };
    image.onerror = () => resolve(paletteFromSeed(key, dark));
    image.src = key;
  });
}

export function useCoverPalette(key: string | undefined, fallbackSeed: string): Palette | null {
  const storePalette = useSettingsStore((s) => s.setPalette);
  const dark = useThemeIsDark();
  const seeded = useSeededPalette();
  const [palette, setPalette] = useState<Palette | null>(() => cache.get(cacheKey(dark, fallbackSeed)) ?? null);

  useEffect(() => {
    let cancelled = false;
    const settle = (next: Palette) => {
      if (cancelled) return;
      setPalette(next);
      setPaletteInStore(next, storePalette);
    };
    if (!key) {
      settle(seeded(fallbackSeed));
      return () => {
        cancelled = true;
      };
    }
    const cached = cache.get(cacheKey(dark, key));
    if (cached) {
      settle(cached);
      return () => {
        cancelled = true;
      };
    }
    void readCover(key, dark).then((next) => {
      cache.set(cacheKey(dark, key), next);
      settle(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key, fallbackSeed, dark, seeded, storePalette]);

  return palette;
}

/** The active book drives the window theme; cards only preview their own. */
export function useActiveBookPalette(key: string | undefined, fallbackSeed: string): void {
  const setPalette = useSettingsStore((s) => s.setPalette);
  const dark = useThemeIsDark();
  const seeded = useSeededPalette();
  useEffect(() => {
    let cancelled = false;
    const settle = (next: Palette) => {
      if (!cancelled) setPalette(next);
    };
    if (!key) {
      settle(seeded(fallbackSeed));
      return () => {
        cancelled = true;
      };
    }
    const cached = cache.get(cacheKey(dark, key));
    if (cached) {
      settle(cached);
      return () => {
        cancelled = true;
      };
    }
    void readCover(key, dark).then((next) => {
      cache.set(cacheKey(dark, key), next);
      settle(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key, fallbackSeed, dark, seeded, setPalette]);
}

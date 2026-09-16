/**
 * Applies settings + the cover palette to CSS custom properties. Everything in
 * the UI is built from these variables, which is what makes "adaptive colour"
 * and "square corners" instant across every surface.
 */

import { gradientCss, hexToRgb, relativeLuminance, type Palette, type Settings } from "@amp/core";

export const FALLBACK_PALETTE: Palette = {
  primary: "#6c8cff",
  secondary: "#7f6bff",
  accent: "#ff9ecb",
  text: "#f4f6fb",
  muted: "rgba(244,246,251,0.62)",
  gradient: ["#101528", "#0d1020", "#0a0c16", "#08090f"],
  luminance: 0.18,
  dark: true,
};

export function resolveTheme(settings: Settings, prefersDark: boolean): boolean {
  switch (settings.theme) {
    case "dark":
      return true;
    case "light":
      return false;
    case "system":
      return prefersDark;
    case "adaptive":
      // "Adaptive" keeps the light interface and takes the colour from the
      // cover, which is the look the app is designed around.
      return false;
    default:
      return false;
  }
}

/** Fixed tint strength: the gradient is meant to be felt, not read. */
const AMBIENT_OPACITY = { light: "0.45", dark: "0.5" } as const;

export function applyTheme(settings: Settings, palette: Palette | null, prefersDark: boolean): void {
  const root = document.documentElement;
  const dark = resolveTheme(settings, prefersDark);
  const active = settings.adaptiveColors && palette ? palette : null;
  const accent = active?.primary ?? settings.accent;

  const tint = active?.primary ?? accent;
  const inkOfTint = active ? (active.dark ? "#ffffff" : "#1d1d1f") : dark ? "#ffffff" : "#1d1d1f";
  root.style.setProperty("--amp-tint", tint);
  root.style.setProperty("--amp-tint-ink", inkOfTint);
  root.style.setProperty("--amp-bg-opacity", settings.background.mode === "off" ? "0" : AMBIENT_OPACITY[dark ? "dark" : "light"]);
  root.style.setProperty("--amp-accent", accent);
  // Text/icons sitting on the accent: dark ink on light accents, white on dark.
  const accentLuma = relativeLuminance(hexToRgb(accent));
  root.style.setProperty("--amp-accent-ink", accentLuma > 0.62 ? "#10131a" : "#ffffff");
  root.style.setProperty("--amp-accent-2", active?.secondary ?? accent);
  root.style.setProperty("--amp-accent-3", active?.accent ?? accent);
  root.style.setProperty("--amp-palette-primary", active?.primary ?? accent);
  root.style.setProperty("--amp-palette-secondary", active?.secondary ?? accent);
  root.style.setProperty("--amp-palette-surface", active?.gradient[1] ?? FALLBACK_PALETTE.gradient[1]);
  root.style.setProperty(
    "--amp-bg-gradient",
    active ? gradientCss(active, settings.background.mode, settings.background.intensity) : gradientCss(FALLBACK_PALETTE, settings.background.mode, settings.background.intensity),
  );
  root.style.setProperty("--amp-bg-animate", settings.background.animated ? "amp-drift 42s ease-in-out infinite" : "none");
  root.style.setProperty("--amp-radius", `${settings.corners.radius}rem`);
  // "Smooth" asks for continuous (Apple-style) corners; the radius alone is the
  // fallback on engines that do not understand corner-shape yet.
  root.style.setProperty(
    "--amp-corner-shape",
    settings.corners.style === "smooth" ? "superellipse(1.7)" : "round",
  );
  root.style.setProperty("--amp-radius-item", `${Math.min(14, settings.corners.radius * 4 + 8)}px`);
  root.style.setProperty("--amp-radius-player", `${settings.corners.playerRadius}rem`);
  root.style.setProperty("--amp-cover-radius", settings.cover.shape === "circle" ? "50%" : settings.cover.shape === "rounded" ? "0.75rem" : "var(--amp-radius)");
  root.style.setProperty("--amp-cover-glow", `${settings.cover.glow}`);
  root.style.setProperty("--amp-cover-shadow", `${settings.cover.shadow}`);
  root.style.setProperty("--amp-panel-blur", `${settings.player.blur}px`);
  /* Kept as a variable so overlays can sit clear of the pinned player bar. */
  root.style.setProperty("--amp-bar-height", "76px");
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.visualizer = settings.visualizer.mode;
  root.style.colorScheme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", active?.gradient[0] ?? "#0a0b10");
}

/** Rough hex/rgb parse used by the glow ring and waveform colours. */
export function paletteAccentPair(palette: Palette | null, settings: Settings): [string, string] {
  if (settings.adaptiveColors && palette) return [palette.primary, palette.accent];
  return [settings.accent, settings.accent];
}

/**
 * Every design token the stylesheet uses has to exist.
 *
 * This is the check that was missing when the context menu went pale: the panel
 * asked for `--amp-surface` and `--amp-text-1`, neither of which Amp defines, so
 * the menu rendered as a translucent white sheet with near-white text - visible
 * enough to pass a screenshot, unreadable to a listener in dark mode. A missing
 * custom property is silent in CSS: the declaration is simply dropped.
 *
 * A token counts as defined when it is declared in a stylesheet or written at
 * runtime by the theme (which is how the cover-derived colours arrive). Anything
 * still unresolved is an error unless the use carries its own fallback, which is
 * the deliberate pattern for tokens a host may or may not provide.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const styles = [
  "apps/renderer/src/styles/globals.css",
  "apps/renderer/src/styles/reshaped.css",
];

const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

const css = styles.map(read).join("\n");
const theme = read("apps/renderer/src/store/theme.ts");

/** Tokens written by the theme at runtime, plus the ones the bridge may set. */
const runtime = new Set(
  [...theme.matchAll(/setProperty\(\s*"(--amp-[a-z0-9-]+)"/g)].map((match) => match[1]),
);

const declared = new Set([...css.matchAll(/(--amp-[a-z0-9-]+)\s*:/g)].map((match) => match[1]));

/** `var(--amp-x, 4px)` is a use that can live without the token. */
function usesWithFallbacks(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/var\((--amp-[a-z0-9-]+)\s*,/g)) names.add(match[1]);
  return names;
}

const withFallback = usesWithFallbacks(css);

const uses = new Map<string, number>();
for (const match of css.matchAll(/var\((--amp-[a-z0-9-]+)/g)) {
  uses.set(match[1], (uses.get(match[1]) ?? 0) + 1);
}

describe("design tokens", () => {
  it("defines every token the stylesheets ask for", () => {
    const unresolved = [...uses.entries()]
      .filter(([name]) => !declared.has(name) && !runtime.has(name) && !withFallback.has(name))
      .map(([name, count]) => `${name} (${count} uses)`)
      .sort();
    expect(unresolved).toEqual([]);
  });

  it("writes the cover-derived tokens from the theme", () => {
    // The palette, the accent and the corner radius are not in any stylesheet:
    // they only exist because applyTheme sets them. If this list ever empties,
    // the adaptive colouring has been disconnected from the UI.
    for (const name of ["--amp-tint", "--amp-accent", "--amp-bg-gradient", "--amp-radius"]) {
      expect(runtime.has(name)).toBe(true);
    }
  });

  it("keeps a fallback where a host may not provide the token", () => {
    // The tray, the remote server and the web build do not run applyTheme, so
    // the tokens they miss have to carry their own default.
    for (const name of ["--amp-tint-ink", "--amp-radius-item", "--amp-grid-size"]) {
      expect(withFallback.has(name)).toBe(true);
    }
  });
});

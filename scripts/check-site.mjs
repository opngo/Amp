#!/usr/bin/env node
/**
 * Check the landing page without building it.
 *
 * The site is static on purpose, so there is nothing to compile - but "nothing
 * to compile" is not the same as "nothing to check". This script is what stands
 * in for a build step in CI: it verifies the three files are present, that
 * every relative href and src in index.html resolves to a real file, that the
 * element ids site.js reaches for exist in the markup, and that no script or
 * stylesheet is loaded from another origin.
 *
 *   node scripts/check-site.mjs
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "apps/website");
const problems = [];

const read = async (relative) => {
  try {
    return await fs.readFile(path.join(directory, relative), "utf8");
  } catch {
    problems.push(`missing file: apps/website/${relative}`);
    return null;
  }
};

const html = await read("index.html");
const css = await read("assets/site.css");
const ascii = await read("assets/ascii.js");
const site = await read("assets/site.js");

if (html) {
  // Every relative reference has to exist in the folder that gets deployed.
  const references = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  for (const reference of references) {
    if (/^(https?:|mailto:|#)/.test(reference)) continue;
    const target = path.join(directory, reference.replace(/^\.\//, ""));
    try {
      await fs.access(target);
    } catch {
      problems.push(`index.html points at a missing file: ${reference}`);
    }
  }

  // Static means self-contained: no CDN, no remote fonts, no analytics.
  const remote = references.filter((reference) => /^https?:/.test(reference));
  for (const reference of remote) {
    const host = new URL(reference).host;
    if (!/^github\.com$/.test(host)) problems.push(`external resource on the page: ${reference}`);
  }

  // No inline event handlers: the behaviour lives in site.js.
  if (/ on(click|load|error|mouseover)=/.test(html)) {
    problems.push("index.html has an inline event handler");
  }
}

if (site && html) {
  // Every id the script looks up has to be in the markup, or the page mounts
  // half of itself and the rest silently does nothing.
  const ids = new Set([...site.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]));
  for (const id of ids) {
    if (!html.includes(`id="${id}"`)) problems.push(`site.js wants #${id}, index.html has no such id`);
  }
}

if (ascii && !/window\.AmpAscii/.test(ascii)) {
  problems.push("assets/ascii.js does not publish window.AmpAscii");
}

if (css && !/prefers-reduced-motion/.test(css)) {
  problems.push("assets/site.css has no reduced-motion rules");
}

if (html && !/<html lang="[a-z-]+">/.test(html)) problems.push("index.html has no language");

const sizes = await Promise.all(
  ["index.html", "assets/site.css", "assets/ascii.js", "assets/site.js"].map(async (file) => {
    try {
      const stat = await fs.stat(path.join(directory, file));
      return `${file} ${(stat.size / 1024).toFixed(1)} kB`;
    } catch {
      return null;
    }
  }),
);

if (problems.length) {
  console.error("Landing page check failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log("Landing page is static and complete - nothing to build.");
  for (const size of sizes.filter(Boolean)) console.log(`  ${size}`);
}

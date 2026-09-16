#!/usr/bin/env node
/**
 * Serve the landing page.
 *
 * The site in apps/website is static - HTML, CSS and two plain scripts - so
 * this is a static server and nothing else: no bundler, no watcher, no
 * dependency. It exists because opening index.html from the file system cannot
 * fetch anything cross-origin, and because a phone on the same network should
 * be able to look at the page too.
 *
 *   node scripts/serve-site.mjs
 *   node scripts/serve-site.mjs --port 8080 --root apps/website
 */

import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};

const port = Number(flag("port", process.env.PORT ?? "4322"));
const directory = path.resolve(root, flag("root", "apps/website"));

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".txt", "text/plain; charset=utf-8"],
]);

/** Everything stays inside the folder being served: no path can climb out. */
function resolveWithin(base, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0]);
  const target = path.resolve(base, `.${decoded}`);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

const server = createServer(async (request, response) => {
  const url = request.url ?? "/";
  let target = resolveWithin(directory, url === "/" ? "/index.html" : url);
  if (!target) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    let stat = await fs.stat(target);
    if (stat.isDirectory()) {
      target = path.join(target, "index.html");
      stat = await fs.stat(target);
    }
    const body = await fs.readFile(target);
    response.writeHead(200, {
      "content-type": TYPES.get(path.extname(target).toLowerCase()) ?? "application/octet-stream",
      "content-length": body.byteLength,
      // The page is edited constantly while it is being written, and it is tiny:
      // asking the browser to revalidate keeps the preview honest.
      "cache-control": "no-cache",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "0.0.0.0", () => {
  const files = ["index.html", "assets/site.css", "assets/ascii.js", "assets/site.js"];
  const missing = files.filter((file) => {
    try {
      readFileSync(path.join(directory, file));
      return false;
    } catch {
      return true;
    }
  });
  console.log(`Amp landing page  http://localhost:${port}`);
  console.log(`  serving  ${directory}`);
  if (missing.length) console.log(`  missing  ${missing.join(", ")}`);
});

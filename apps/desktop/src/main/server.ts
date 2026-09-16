/**
 * Optional remote server.
 *
 * Amp can serve its own web build over the local network (or a Tailscale
 * tailnet) so a phone or tablet can stream the same library. It is off by
 * default; when it is on, a random token is required for every request, the
 * audio route supports HTTP range requests so seeking works, and the same
 * endpoints are implemented by python/server.py for headless installs.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ServerStatus } from "@amp/core";
import { logLine, paths } from "./store";
import { importPaths } from "./library";
import { MEDIA_CORS_HEADERS, planMediaResponse } from "./mediaResponse";
import { searchAudiobookBay } from "./abb";

export interface ServerOptions {
  port: number;
  rendererDir: string;
  loadLibrary: () => Promise<unknown>;
  saveLibrary: (state: unknown) => Promise<void>;
  loadSettings: () => Promise<unknown>;
  token?: string;
  host?: string;
}

interface RunningServer {
  server: Server;
  port: number;
  host: string;
  token: string;
  clients: number;
}

let running: RunningServer | null = null;

/** Tailscale IP when the machine is on a tailnet, otherwise null. */
export async function tailscaleIp(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("tailscale", ["ip", "-4"], { timeout: 4000 }, (error, stdout) => {
      if (error) return resolve(null);
      const ip = stdout.trim().split("\n")[0];
      resolve(ip && /^100\./.test(ip) ? ip : null);
    });
  });
}

export async function localAddresses(): Promise<string[]> {
  const addresses: string[] = [];
  for (const [, group] of Object.entries(networkInterfaces())) {
    for (const entry of group ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const map: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".m4b": "audio/mp4",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
  };
  return map[ext] ?? "application/octet-stream";
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...MEDIA_CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 8 * 1024 * 1024) reject(new Error("Body too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

/**
 * Range-capable streaming: this is what makes seeking work, on the tailnet and
 * in a browser. The range maths is shared with the desktop media scheme
 * (`mediaResponse.ts`) rather than repeated here, because the old copy read a
 * suffix range (`bytes=-500`) as "the first 501 bytes" and answered every
 * response without CORS headers.
 */
function sendFile(request: IncomingMessage, response: ServerResponse, file: string, size: number): void {
  const plan = planMediaResponse({ filePath: file, size, range: request.headers.range ?? null });
  if (plan.status === 416) {
    response.writeHead(416, plan.headers);
    response.end();
    return;
  }
  response.writeHead(plan.status, plan.headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  const stream =
    plan.status === 206
      ? createReadStream(file, { start: plan.start, end: plan.end })
      : createReadStream(file);
  stream.pipe(response);
}

async function streamAudio(request: IncomingMessage, response: ServerResponse, file: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(file);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code ?? "unreadable";
    json(response, 404, { error: `File not found (${reason})` });
    return;
  }
  sendFile(request, response, file, stat.size);
}

/** The server's current state, for the settings page and the tray. */
export function serverStatus(): ServerStatus {
  if (!running) return { running: false };
  return {
    running: true,
    url: `http://${running.host}:${running.port}/?token=${encodeURIComponent(running.token)}`,
    clients: running.clients,
  };
}

export async function startServer(options: ServerOptions): Promise<ServerStatus> {
  if (running) return serverStatus();
  const token = options.token ?? randomUUID();
  const bindHost = options.host ?? "0.0.0.0";

  const server = createServer((request, response) => {
    void handle(request, response, options, token);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, bindHost, () => resolve());
  });

  const tailscale = await tailscaleIp();
  const host = tailscale ?? (await localAddresses())[0] ?? "127.0.0.1";
  running = { server, port: options.port, host, token, clients: 0 };
  server.on("connection", () => {
    if (running) running.clients += 1;
  });
  await logLine(`server: listening on ${bindHost}:${options.port} (${serverStatus().url})`);
  return serverStatus();
}

export async function stopServer(): Promise<ServerStatus> {
  if (!running) return { running: false };
  await new Promise<void>((resolve) => running?.server.close(() => resolve()));
  running = null;
  await logLine("server: stopped");
  return { running: false };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ServerOptions,
  token: string,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const provided =
    url.searchParams.get("token") ?? (request.headers.authorization ?? "").replace("Bearer ", "");
  if (provided !== token) {
    json(response, 401, { error: "Invalid or missing token" });
    return;
  }

  const route = url.pathname;
  try {
    if (route === "/api/health") {
      json(response, 200, { ok: true, app: "amp", version: "1.0.0" });
      return;
    }
    if (route === "/api/library") {
      if (request.method === "GET") {
        json(response, 200, await options.loadLibrary());
        return;
      }
      if (request.method === "PUT" || request.method === "POST") {
        await options.saveLibrary(JSON.parse(await readBody(request)));
        json(response, 200, { ok: true });
        return;
      }
    }
    if (route === "/api/settings") {
      if (request.method === "GET") {
        json(response, 200, await options.loadSettings());
        return;
      }
      json(response, 405, { error: "Method not allowed" });
      return;
    }
    if (route === "/api/cover") {
      const bookId = url.searchParams.get("bookId") ?? "";
      // One endpoint, both kinds of artwork: `which=banner` looks in the
      // banner cache first, then at the file the book points at.
      const isBanner = (url.searchParams.get("which") ?? "cover") === "banner";
      const directory = isBanner ? paths.banners() : paths.covers();
      for (const ext of ["jpg", "jpeg", "png", "webp"]) {
        const candidate = path.join(directory, `${bookId}.${ext}`);
        try {
          const stat = await fs.stat(candidate);
          sendFile(request, response, candidate, stat.size);
          return;
        } catch {
          /* try next extension */
        }
      }
      // Nothing cached: serve whatever the book itself points at, so a banner
      // chosen elsewhere (or a cover that was cleared) still shows.
      const library = (await options.loadLibrary()) as {
        books?: { id: string; coverPath?: string; bannerPath?: string }[];
      };
      const book = library.books?.find((item) => item.id === bookId);
      const pointed = isBanner ? book?.bannerPath : book?.coverPath;
      if (pointed && path.isAbsolute(pointed)) {
        try {
          const stat = await fs.stat(pointed);
          sendFile(request, response, pointed, stat.size);
          return;
        } catch {
          /* fall through to the 404 */
        }
      }
      json(response, 404, { error: isBanner ? "No banner" : "No cover" });
      return;
    }
    if (route === "/api/audio") {
      const file = url.searchParams.get("path") ?? "";
      if (!path.isAbsolute(file)) {
        json(response, 400, { error: "Absolute path required" });
        return;
      }
      await streamAudio(request, response, file);
      return;
    }
    if (route === "/api/import" && request.method === "POST") {
      const body = JSON.parse(await readBody(request)) as { paths?: string[]; groupFolders?: boolean };
      const result = await importPaths(body.paths ?? [], { groupFolders: body.groupFolders ?? true });
      json(response, 200, result);
      return;
    }
    if (route === "/api/search") {
      const query = url.searchParams.get("q") ?? "";
      json(response, 200, { results: await searchAudiobookBay(query, { limit: 40 }) });
      return;
    }

    // Everything else is the React app itself.
    const relative = route === "/" ? "index.html" : route.replace(/^\/+/, "");
    const file = path.join(options.rendererDir, relative);
    if (!file.startsWith(options.rendererDir)) {
      json(response, 403, { error: "Forbidden" });
      return;
    }
    try {
      await fs.access(file);
      response.writeHead(200, { "Content-Type": contentType(file) });
      createReadStream(file).pipe(response);
    } catch {
      const index = path.join(options.rendererDir, "index.html");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      createReadStream(index).pipe(response);
    }
  } catch (error) {
    await logLine(`server: ${route} failed - ${error instanceof Error ? error.message : "unknown"}`);
    json(response, 500, { error: error instanceof Error ? error.message : "Server error" });
  }
}

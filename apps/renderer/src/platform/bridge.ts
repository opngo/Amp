/**
 * The single seam between the React app and whatever is hosting it.
 *
 *   Electron       window.amp, installed by the preload script (real files,
 *                  real qBittorrent, real Whisper).
 *   Browser        an HTTP bridge against an Amp server - the optional remote
 *                  server, or another machine on your tailnet.
 *   Nothing there  an honest empty host: the app shows how to connect instead
 *                  of inventing a library.
 */

import type { AmpBridge } from "@amp/core";
import { createHttpBridge, createUnconnectedBridge, readConnection } from "./httpBridge";

export type { AmpBridge, CoverCandidate, ImportResult, ProbeResult, ServerStatus } from "@amp/core";
export {
  clearConnection,
  coverUrlFor,
  readConnection,
  saveConnection,
  type ServerConnection,
} from "./httpBridge";

declare global {
  interface Window {
    amp?: AmpBridge;
  }
}

let cached: AmpBridge | null = null;

export function bridgeIfReady(): AmpBridge | null {
  if (cached) return cached;
  if (typeof window !== "undefined" && window.amp) return window.amp;
  return null;
}

/**
 * True when the page was served by an Amp server (as opposed to a static host
 * or the Vite dev server): the API answers on the same origin, so there is
 * nothing to configure - which is what makes "open the URL on your phone" work
 * with no setup at all.
 */
async function sameOriginServer(): Promise<{ url: string; token: string } | null> {
  if (typeof window === "undefined" || !/^https?:$/.test(window.location.protocol)) return null;
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  try {
    const response = await fetch(`/api/health${token ? `?token=${encodeURIComponent(token)}` : ""}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { app?: string };
    if (payload?.app !== "amp") return null;
    return { url: window.location.origin, token };
  } catch {
    return null;
  }
}

export async function getBridge(): Promise<AmpBridge> {
  if (cached) return cached;
  if (typeof window !== "undefined" && window.amp) {
    cached = window.amp;
    return cached;
  }
  const saved = readConnection();
  const connection = saved ?? (await sameOriginServer());
  cached = connection ? createHttpBridge({ connection }) : createUnconnectedBridge();
  return cached;
}

/** Synchronous accessor for code that runs after boot. */
export function bridge(): AmpBridge {
  const ready = bridgeIfReady();
  if (ready) return ready;
  throw new Error("Amp bridge is not ready yet - call getBridge() during boot");
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && Boolean(window.amp);
}

/**
 * True when a real host answered: the Electron preload, or an Amp server. A
 * page opened without either keeps the honest empty bridge, and the interface
 * explains how to connect instead of pretending the library is empty.
 */
export function isConnected(): boolean {
  if (!cached) return false;
  return cached.capabilities.nativeImport || cached.capabilities.importByPath;
}

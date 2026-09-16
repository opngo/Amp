/** Time formatting / parsing helpers. Everything in this file is pure. */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 3725 -> "1:02:05", 65 -> "1:05", 9 -> "0:09" */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 3725 -> "1h 2m", 65 -> "1m", 9 -> "9s" */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}

/** 3725 -> "1h 02m 05s" (for tooltips) */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (h || m) parts.push(`${String(m).padStart(2, "0")}m`);
  parts.push(`${String(s).padStart(2, "0")}s`);
  return parts.join(" ");
}

/** "1:02:05" | "62:05" | "1500" -> seconds */
export function parseTime(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":").map((p) => Number(p));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

/** Human bytes: 1536 -> "1.5 KB" */
export function formatBytes(bytes: number | undefined, digits = 1): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exp;
  return `${value.toFixed(exp === 0 ? 0 : digits)} ${units[exp]}`;
}

/** "12/09/2026" */
export function formatDate(ts: number | undefined, locale = "en-CA"): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

/** "just now", "4h ago", "3d ago", dates after a week. */
export function timeAgo(ts: number | undefined, now = Date.now()): string {
  if (!ts) return "never";
  const diff = Math.max(0, now - ts) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  return formatDate(ts);
}

/** Speech-rate aware remaining time: 12000s at 1.5x -> 8000s */
export function adjustForSpeed(seconds: number, speed: number): number {
  if (!speed || speed <= 0) return seconds;
  return seconds / speed;
}

/** Estimated finish clock, e.g. "finished at 21:14". */
export function finishAt(seconds: number, now = Date.now()): string {
  const date = new Date(now + Math.max(0, seconds) * 1000);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export const SPEED_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4] as const;

export function nextSpeed(current: number, direction: 1 | -1 = 1): number {
  const steps = SPEED_STEPS as readonly number[];
  const idx = steps.findIndex((s) => Math.abs(s - current) < 0.001);
  if (idx === -1) {
    const sorted = [...steps, current].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, sorted.indexOf(current) + (direction === 1 ? 1 : -1))] ?? 1;
  }
  const next = idx + direction;
  return steps[clamp(next, 0, steps.length - 1)];
}

export const SLEEP_PRESETS = [5, 10, 15, 20, 30, 45, 60, 90] as const;

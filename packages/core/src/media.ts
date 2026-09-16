/**
 * Turning a file on disk into something a web page can load.
 *
 * The desktop app keeps absolute paths to audio files and cover images. A page
 * cannot read those directly, so the main process serves them over the
 * ``amp-media://`` scheme. Getting this wrong is invisible on macOS and Linux
 * and breaks the whole app on Windows, because a drive letter looks exactly
 * like a URL scheme: ``C:\books\one.m4b`` matches ``^[a-z]+:``.
 *
 * So the check is a list of schemes Amp actually uses, not "anything with a
 * colon in it".
 */

/** URL schemes that are already loadable by a page. */
const LOADABLE_SCHEME = /^(https?|data|blob|file|amp-media|about|chrome-extension):/i;

/** True when the value can be handed to a src/href untouched. */
export function isLoadableUrl(value: string): boolean {
  return LOADABLE_SCHEME.test(value.trim());
}

/** True for an absolute path on any platform: POSIX, Windows drive or UNC. */
export function isAbsolutePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-z]:[\\/]/i.test(trimmed)) return true; // C:\books or C:/books
  if (/^\\\\[^\\]/.test(trimmed)) return true; // \\server\share
  return trimmed.startsWith("/");
}

/**
 * The URL a page should load for a path or an already-formed URL.
 *
 * ``scheme`` is the custom protocol the host serves files with; the web build
 * passes something else, or nothing when it resolves covers over HTTP.
 */
export function mediaUrl(value: string, scheme = "amp-media", host = "local"): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (isLoadableUrl(trimmed)) return trimmed;
  if (!isAbsolutePath(trimmed)) return trimmed;
  // Windows separators are kept: the host side reads them with node's fs,
  // which understands both. Only the encoding matters here.
  return `${scheme}://${host}/${encodeURIComponent(trimmed)}`;
}

/** The path back out of an ``amp-media://`` URL. */
export function mediaUrlToPath(url: string): string | null {
  if (!/^amp-media:/i.test(url)) return null;
  const withoutScheme = url.replace(/^amp-media:\/\//i, "");
  const slash = withoutScheme.indexOf("/");
  const raw = slash === -1 ? "" : withoutScheme.slice(slash + 1);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

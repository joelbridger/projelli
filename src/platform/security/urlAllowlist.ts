// Shared URL-scheme allow-list — the single source of truth for deciding whether
// a file/model-derived URL is safe to place in a rendered href / src / iframe.
//
// SECURITY. This REPLICATES, byte-for-byte in its security-relevant logic, the
// `sanitizeUrl` allow-list landed by the markdown-preview (S2) lane in
// src/features/documents/editor/MarkdownPreview.tsx (branch
// sec/markdown-preview-injection-c34). It is kept deliberately identical so the
// markdown, .docx, and iframe render paths CANNOT diverge — an attacker must not
// find a scheme that one path refuses and another admits. In particular:
//   * it is a positive ALLOW-LIST, never a block-list (a block-list silently
//     admits every scheme it forgot: blob:, filesystem:, and whatever is found
//     next);
//   * the value is NORMALIZED before the scheme is read (control chars + spaces
//     a browser ignores while parsing a scheme are stripped, then lower-cased),
//     so `java\tscript:`, ` javascript:` and friends cannot slip past;
//   * `data:image/svg+xml` is EXCLUDED from the image exception because SVG can
//     carry <script>.
//
// Post-merge follow-up (tracked in the render-sink lane report): MarkdownPreview
// should import from here so there is a single copy. Until the two lanes merge,
// the render-sink lane could not import across the worktree boundary, so this is
// an intentional, reviewed replica.

// Navigable schemes permitted in an href. Anything else — javascript:, vbscript:,
// data:, file:, blob:, filesystem:, … — is refused. Relative URLs (no scheme) are
// allowed (they resolve within the app and cannot introduce script).
export const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

// Control characters (+ space) a browser IGNORES while parsing a URL scheme.
// Matching them is the point (anti-obfuscation), so the no-control-regex lint
// rule is deliberately disabled. CONTROL_AND_SPACE (incl. 0x20) is used for
// scheme DETECTION — it collapses split schemes like `java\tscript:` into
// `javascript:`. CONTROL_CHARS is the hygiene strip applied to a URL we keep.
// eslint-disable-next-line no-control-regex
export const CONTROL_AND_SPACE = /[\u0000-\u0020\u007F-\u009F]+/g;
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

// A NON-scriptable raster data: image URI. `data:image/svg+xml` is intentionally
// NOT matched — SVG can carry <script>/onload.
const RASTER_IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp|avif|bmp);/;

// docx-preview embeds EVERY image (any format, incl. a legitimate Word SVG) as a
// `data:application/octet-stream;base64,…` URI — JSZip blobs carry no MIME and
// the library does not sniff. Callers rendering `.docx` opt into this binary MIME
// (via `allowBinaryData`) so real Word images survive; it is still refused for
// the markdown path. An `<img src>` cannot execute script (not even SVG), so
// admitting octet-stream on an image sink introduces no execution path, while
// `data:image/svg+xml` / `data:text/html` remain refused for good measure.
const BINARY_IMAGE_DATA = /^data:application\/octet-stream;/;

/** Where the URL is going. Determines which allow-list applies. */
export type UrlSinkKind =
  | 'nav' // an <a href> / <area href> — navigable
  | 'image' // an <img src> / <image> — raster data: also allowed
  | 'frame'; // an <iframe src> — http/https/about:blank (+ blob only if opted in)

/**
 * Return the de-obfuscated, lower-cased scheme of `rawUrl`, or `undefined` when
 * the URL carries no scheme (relative / anchor / query — always safe).
 */
export function schemeOf(rawUrl: string): string | undefined {
  const normalized = rawUrl.replace(CONTROL_AND_SPACE, '').toLowerCase();
  return /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1];
}

/**
 * Is `rawUrl` allowed for the given sink kind? Positive allow-list; the default
 * is refusal.
 *
 *  - 'nav'   → http / https / mailto / tel, or a relative/anchor URL.
 *  - 'image' → the 'nav' set PLUS a raster (non-SVG) `data:image/...` URI; with
 *              `opts.allowBinaryData` also `data:application/octet-stream` +
 *              `blob:` (docx-preview's embedded-image form).
 *  - 'frame' → http / https / about:blank, or a relative URL; `blob:` only when
 *              `opts.allowBlob` is set (the PDF viewer, whose blob MIME is
 *              separately pinned to application/pdf).
 */
export function isAllowedUrl(
  rawUrl: string,
  kind: UrlSinkKind,
  opts: { allowBlob?: boolean; allowBinaryData?: boolean } = {},
): boolean {
  const normalized = rawUrl.replace(CONTROL_AND_SPACE, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1];

  // No scheme at all → relative / anchor / query URL → safe for every sink.
  if (scheme === undefined) return true;

  if (kind === 'frame') {
    if (scheme === 'http' || scheme === 'https') return true;
    if (normalized === 'about:blank') return true;
    if (opts.allowBlob && scheme === 'blob') return true;
    return false;
  }

  if (kind === 'image') {
    // Narrow image exceptions: a NON-scriptable raster data: URI, and — for the
    // docx render path — the library's octet-stream/blob embed form. SVG/HTML
    // data URIs stay refused.
    if (scheme === 'data' && RASTER_IMAGE_DATA.test(normalized)) return true;
    if (opts.allowBinaryData && scheme === 'data' && BINARY_IMAGE_DATA.test(normalized)) return true;
    if (opts.allowBinaryData && scheme === 'blob') return true;
    // Fall through to the nav allow-list for http/https/etc. on an image src.
  }

  return SAFE_URL_SCHEMES.has(scheme);
}

/**
 * S2-parity helper. Validate a URL for an href/src attribute and return a value
 * safe to place in that attribute: the original (control chars stripped for
 * hygiene) when permitted, or '' when refused (an inert empty attribute). This
 * mirrors MarkdownPreview's `sanitizeUrl` exactly; provided so a string-building
 * caller can share the identical decision. (The DOM-walking docx/iframe guards
 * use `isAllowedUrl` directly instead.)
 */
export function sanitizeUrlValue(
  rawUrl: string,
  opts: { allowImageData?: boolean } = {},
): string {
  const clean = rawUrl.replace(CONTROL_CHARS, '');
  const normalized = rawUrl.replace(CONTROL_AND_SPACE, '').toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(normalized)?.[1];
  if (scheme === undefined) return clean;
  if (SAFE_URL_SCHEMES.has(scheme)) return clean;
  if (opts.allowImageData && scheme === 'data' && RASTER_IMAGE_DATA.test(normalized)) {
    return clean;
  }
  return '';
}

/**
 * Constrain a value destined for an iframe `src` to a safe navigable URL.
 * Returns the original URL when allowed, else `about:blank` (a safe, inert
 * frame). `allowBlob` permits `blob:` (used by the PDF viewer, whose blob MIME
 * is independently pinned to application/pdf).
 */
export function toSafeFrameSrc(
  rawUrl: string | null | undefined,
  opts: { allowBlob?: boolean } = {},
): string {
  if (rawUrl == null || rawUrl === '') return 'about:blank';
  return isAllowedUrl(rawUrl, 'frame', opts) ? rawUrl : 'about:blank';
}

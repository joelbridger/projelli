/**
 * Q12 + Q13 (Wave 1.4) — smart paste handlers for the Markdown editor.
 *
 * This module packages two paste behaviors into a single CodeMirror
 * `EditorView.domEventHandlers` extension:
 *
 *   1. **Smart URL paste** (Q12) — if the clipboard text is a lone URL,
 *      we insert `[Fetching title...](url)` immediately, kick off
 *      `fetchUrlTitle(url)`, and swap the placeholder for `[title](url)`
 *      when the title arrives. An empty title (timeout / error) resolves
 *      to the raw URL with no brackets. Pasting a URL over a selection
 *      is treated as "linkify the selection": `[selected-text](url)`.
 *
 *   2. **Image paste auto-save** (Q13) — if the clipboard carries an
 *      `image/*` item, we SHA-256 the bytes, write the file to
 *      `<workspace>/media/YYYY-MM/image-<hash12>.<ext>`, and insert
 *      `![](media/YYYY-MM/image-<hash12>.<ext>)` at the cursor. Duplicate
 *      paste of the same bytes reuses the existing file.
 *
 * Everything below is dependency-injected so tests (and the live editor)
 * wire their own `fetchUrlTitle`, `writeImage`, toast helper, etc. The
 * pure helpers (`isSingleUrl`, `hashImageBytes`, `mimeToExtension`,
 * `buildImageMediaPath`) are exported separately so they can be unit
 * tested without touching CodeMirror.
 */

import { EditorView } from '@codemirror/view';

// ---------------------------------------------------------------------
// Pure helpers — exported for direct unit tests.
// ---------------------------------------------------------------------

/** Max image size we'll auto-save. 20 MiB matches the spec. */
export const IMAGE_PASTE_MAX_BYTES = 20 * 1024 * 1024;

/** Matches a whitespace-trimmed, single-token URL. Intentionally strict
 *  — anything with internal whitespace is not a "single URL paste". */
const SINGLE_URL_REGEX = /^https?:\/\/[^\s]+$/i;

/** True when `text` (after trimming) is a single http(s) URL and has no
 *  internal whitespace. */
export function isSingleUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SINGLE_URL_REGEX.test(trimmed);
}

/** Map a clipboard / File MIME type to a lowercase file extension
 *  (without the leading dot). Returns `null` for types we don't handle. */
export function mimeToExtension(mime: string): string | null {
  const m = mime.toLowerCase();
  if (m === 'image/png') return 'png';
  if (m === 'image/jpeg' || m === 'image/jpg') return 'jpg';
  if (m === 'image/gif') return 'gif';
  if (m === 'image/webp') return 'webp';
  return null;
}

/**
 * Format a `Date` as `YYYY-MM` for the per-month media bucket folder.
 * Defaults to `new Date()` so callers can inject a fixed clock in tests.
 */
export function formatYearMonth(d: Date = new Date()): string {
  const year = d.getFullYear().toString().padStart(4, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

/** Compute the first 12 hex characters of SHA-256(bytes). Uses the
 *  Web Crypto API (available in Tauri's WebView and in jsdom's polyfill).
 *  12 hex chars = 48 bits of hash space, plenty for per-workspace image
 *  deduping. */
export async function hashImageBytes(bytes: ArrayBuffer): Promise<string> {
  // Wrap in a Uint8Array so `crypto.subtle.digest` accepts the input
  // across runtimes (Node, Tauri WebView, jsdom). The spec allows
  // either an ArrayBuffer or an ArrayBufferView, but jsdom's check is
  // stricter about which realm the ArrayBuffer came from.
  const input = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', input);
  const view = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 6; i += 1) {
    hex += (view[i] ?? 0).toString(16).padStart(2, '0');
  }
  return hex;
}

export interface BuildImagePathArgs {
  /** 12-hex-char content hash. */
  hash: string;
  /** File extension without the leading dot (e.g. `png`). */
  extension: string;
  /** `YYYY-MM` bucket folder. */
  yearMonth: string;
}

/** Workspace-relative path used both on disk and in the inserted Markdown. */
export function buildImageMediaPath({
  hash,
  extension,
  yearMonth,
}: BuildImagePathArgs): string {
  return `media/${yearMonth}/image-${hash}.${extension}`;
}

/**
 * Cheap "am I inside a code block" detector. We don't walk the real
 * markdown syntax tree here because:
 *
 *   1. The editor's markdown parser is already loaded, but walking the
 *      tree for every paste is overkill when a line-count scan gets us
 *      99 % of the way there.
 *   2. The spec explicitly allows a heuristic ("Conservatively check …
 *      or just do a simple 'am I inside a code block' heuristic").
 *
 * Fenced block rule: count ` ``` ` lines from doc start through the
 * cursor line — if odd, the cursor is inside a fenced block.
 * Inline-backtick rule: on the cursor's own line, count backticks before
 * the cursor — if odd, the cursor is inside an inline code span.
 *
 * @param doc      the full editor document
 * @param cursor   absolute offset of the cursor inside `doc`
 */
export function isInsideCodeBlock(doc: string, cursor: number): boolean {
  // Clamp the cursor so out-of-range inputs don't throw.
  const safe = Math.max(0, Math.min(cursor, doc.length));
  const before = doc.slice(0, safe);

  // Fenced code blocks.
  const lines = before.split('\n');
  let fenceCount = 0;
  for (const line of lines) {
    // A fence line starts with 0-3 spaces then 3+ backticks. We ignore
    // tildes for simplicity.
    if (/^ {0,3}```/.test(line)) fenceCount += 1;
  }
  if (fenceCount % 2 === 1) return true;

  // Inline code spans — look only at the current line before the cursor.
  const lastNewline = before.lastIndexOf('\n');
  const currentLinePrefix =
    lastNewline === -1 ? before : before.slice(lastNewline + 1);
  let backtickCount = 0;
  for (const ch of currentLinePrefix) {
    if (ch === '`') backtickCount += 1;
  }
  return backtickCount % 2 === 1;
}

// ---------------------------------------------------------------------
// Types shared by the extension factory.
// ---------------------------------------------------------------------

/**
 * Signature of the URL-title fetcher. Must resolve to a string — empty
 * string on any error so the editor can fall back to the raw URL.
 */
export type FetchUrlTitle = (url: string) => Promise<string>;

/**
 * Signature of the image-writer. Implementations (the live editor's
 * adapter around `WorkspaceService`) are responsible for:
 *   - checking if the target path already exists (dedupe by hash);
 *   - creating the `media/YYYY-MM/` folder if missing;
 *   - writing the bytes with `writeFileBinary`.
 * The function MUST be idempotent for the same hash.
 */
export type WriteImage = (args: {
  path: string;
  bytes: ArrayBuffer;
}) => Promise<void>;

/** Minimal toast surface we need from the parent. */
export type ShowToast = (message: string) => void;

/** Optional clock injection so tests can pin `YYYY-MM`. */
export type NowProvider = () => Date;

export interface SmartPasteHandlerOptions {
  fetchUrlTitle: FetchUrlTitle;
  writeImage?: WriteImage | undefined;
  /** Returns true when a workspace is open. Image paste is disabled when false. */
  hasWorkspace?: (() => boolean) | undefined;
  showToast?: ShowToast | undefined;
  now?: NowProvider | undefined;
  /** Hook so tests can observe the final state after an async title fetch. */
  onUrlPasteResolved?: ((result: { url: string; title: string }) => void) | undefined;
  /** Hook for tests to observe the image-write outcome. */
  onImagePasteResolved?: ((result: { path: string; bytes: ArrayBuffer }) => void) | undefined;
}

// ---------------------------------------------------------------------
// Placeholder management for async URL-title replacement.
// ---------------------------------------------------------------------

/**
 * Scan the document for a `[Fetching title...](url)` placeholder at or
 * near `expectedFrom`. We can't rely on absolute positions because the
 * user may keep typing while the network request is in flight. This
 * helper is exported so the test suite can verify the swap logic
 * without async timing.
 */
export function findUrlPlaceholder(
  doc: string,
  expectedFrom: number,
  url: string,
): { from: number; to: number } | null {
  const placeholder = `[Fetching title...](${url})`;
  // Try the fast path first: exact position.
  if (doc.slice(expectedFrom, expectedFrom + placeholder.length) === placeholder) {
    return { from: expectedFrom, to: expectedFrom + placeholder.length };
  }
  // Fallback: indexOf from doc start. Pick the nearest match to the
  // expected position so repeated pastes of the same URL don't all
  // collapse to the first one.
  let searchStart = 0;
  let best: { from: number; to: number } | null = null;
  let bestDistance = Infinity;
  for (;;) {
    const hit = doc.indexOf(placeholder, searchStart);
    if (hit === -1) break;
    const distance = Math.abs(hit - expectedFrom);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { from: hit, to: hit + placeholder.length };
    }
    searchStart = hit + placeholder.length;
  }
  return best;
}

/** Build the final replacement text for a resolved URL paste. Empty
 *  title → raw URL (spec). */
export function resolveUrlPasteReplacement(url: string, title: string): string {
  const trimmed = title.trim();
  return trimmed ? `[${trimmed}](${url})` : url;
}

// ---------------------------------------------------------------------
// CodeMirror extension factory.
// ---------------------------------------------------------------------

/**
 * Build the CodeMirror `paste` handler extension. Returns an
 * `EditorView.domEventHandlers` so all three behaviors (URL paste, image
 * paste, and the fall-through to default paste) live in one place.
 */
export function createSmartPasteExtension(options: SmartPasteHandlerOptions) {
  const {
    fetchUrlTitle,
    writeImage,
    hasWorkspace,
    showToast,
    now,
    onUrlPasteResolved,
    onImagePasteResolved,
  } = options;

  return EditorView.domEventHandlers({
    paste: (event: ClipboardEvent, view: EditorView) => {
      const cd = event.clipboardData;
      if (!cd) return false;

      // ---- Image paste (Q13) — handled first so `image/png` + text
      //      clipboard payloads prioritize the image branch. -----------
      const imageItem = findImageItem(cd);
      if (imageItem) {
        event.preventDefault();
        void handleImagePaste({
          item: imageItem,
          view,
          writeImage,
          hasWorkspace,
          showToast,
          now,
          onImagePasteResolved,
        });
        return true;
      }

      // ---- URL paste (Q12). ----------------------------------------
      const rawText = cd.getData('text/plain');
      if (rawText && isSingleUrl(rawText)) {
        const { from, to } = view.state.selection.main;
        if (isInsideCodeBlock(view.state.doc.toString(), from)) {
          // Inside a code block — fall through to default paste so the
          // URL is preserved verbatim.
          return false;
        }
        event.preventDefault();
        const url = rawText.trim();
        handleUrlPaste({
          view,
          from,
          to,
          url,
          fetchUrlTitle,
          onUrlPasteResolved,
        });
        return true;
      }

      // Nothing smart to do — let CodeMirror paste normally.
      return false;
    },
  });
}

// ---------------------------------------------------------------------
// URL paste implementation.
// ---------------------------------------------------------------------

interface HandleUrlPasteArgs {
  view: EditorView;
  from: number;
  to: number;
  url: string;
  fetchUrlTitle: FetchUrlTitle;
  onUrlPasteResolved?: ((result: { url: string; title: string }) => void) | undefined;
}

function handleUrlPaste({
  view,
  from,
  to,
  url,
  fetchUrlTitle,
  onUrlPasteResolved,
}: HandleUrlPasteArgs): void {
  const hasSelection = to > from;

  if (hasSelection) {
    // Linkify the selection synchronously — no placeholder round-trip.
    const selected = view.state.doc.sliceString(from, to);
    const replacement = `[${selected}](${url})`;
    view.dispatch({
      changes: { from, to, insert: replacement },
      selection: { anchor: from + replacement.length },
    });
    onUrlPasteResolved?.({ url, title: selected });
    return;
  }

  // No selection — insert the placeholder and kick off the async fetch.
  const placeholder = `[Fetching title...](${url})`;
  view.dispatch({
    changes: { from, to, insert: placeholder },
    selection: { anchor: from + placeholder.length },
  });

  void (async () => {
    let title = '';
    try {
      title = await fetchUrlTitle(url);
    } catch {
      title = '';
    }
    // The doc may have moved. Relocate the placeholder.
    const doc = view.state.doc.toString();
    const found = findUrlPlaceholder(doc, from, url);
    if (!found) {
      // User edited it away — nothing to do.
      onUrlPasteResolved?.({ url, title });
      return;
    }
    const replacement = resolveUrlPasteReplacement(url, title);
    view.dispatch({
      changes: { from: found.from, to: found.to, insert: replacement },
    });
    onUrlPasteResolved?.({ url, title });
  })();
}

// ---------------------------------------------------------------------
// Image paste implementation.
// ---------------------------------------------------------------------

/** Pull the first `image/*` item out of a `DataTransfer`, if any. */
function findImageItem(data: DataTransfer): DataTransferItem | null {
  for (let i = 0; i < data.items.length; i += 1) {
    const item = data.items[i];
    if (!item) continue;
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      return item;
    }
  }
  return null;
}

interface HandleImagePasteArgs {
  item: DataTransferItem;
  view: EditorView;
  writeImage?: WriteImage | undefined;
  hasWorkspace?: (() => boolean) | undefined;
  showToast?: ShowToast | undefined;
  now?: NowProvider | undefined;
  onImagePasteResolved?: ((result: { path: string; bytes: ArrayBuffer }) => void) | undefined;
}

async function handleImagePaste({
  item,
  view,
  writeImage,
  hasWorkspace,
  showToast,
  now,
  onImagePasteResolved,
}: HandleImagePasteArgs): Promise<void> {
  const file = item.getAsFile();
  if (!file) return;
  await processImageFile({
    file,
    view,
    writeImage,
    hasWorkspace,
    showToast,
    now,
    onImagePasteResolved,
  });
}

/**
 * Shared entry point used by both paste and drag-drop. Exported so the
 * future drop handler (and tests) can call it directly.
 */
export async function processImageFile({
  file,
  view,
  writeImage,
  hasWorkspace,
  showToast,
  now,
  onImagePasteResolved,
}: {
  file: File;
  view: EditorView;
  writeImage?: WriteImage | undefined;
  hasWorkspace?: (() => boolean) | undefined;
  showToast?: ShowToast | undefined;
  now?: NowProvider | undefined;
  onImagePasteResolved?: ((result: { path: string; bytes: ArrayBuffer }) => void) | undefined;
}): Promise<void> {
  if (hasWorkspace && !hasWorkspace()) {
    showToast?.('No workspace — paste an image only when a workspace is open.');
    return;
  }
  if (!writeImage) {
    // No writer wired (browser / test-mode); nothing we can do.
    return;
  }
  if (file.size > IMAGE_PASTE_MAX_BYTES) {
    showToast?.('Image too large (20MB max).');
    return;
  }
  const ext = mimeToExtension(file.type);
  if (!ext) {
    // Unknown image type — bail gracefully.
    return;
  }
  const bytes = await file.arrayBuffer();
  const hash = await hashImageBytes(bytes);
  const yearMonth = formatYearMonth(now?.());
  const path = buildImageMediaPath({ hash, extension: ext, yearMonth });
  try {
    await writeImage({ path, bytes });
  } catch (err) {
    console.error('[smartPaste] writeImage failed:', err);
    showToast?.('Failed to save image.');
    return;
  }

  const markdown = `![](${path})`;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: markdown },
    selection: { anchor: from + markdown.length },
  });
  onImagePasteResolved?.({ path, bytes });
}

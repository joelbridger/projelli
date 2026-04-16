/**
 * Q12 (Wave 1.4) — smart URL paste for the Markdown editor.
 *
 * When the user pastes a single http(s) URL into the editor we:
 *   1. insert `[Fetching title...](url)` at the cursor so they see
 *      immediate feedback;
 *   2. fire `fetchUrlTitle(url)` in the background (the default lives
 *      in `@/utils/tauri-commands` and goes through the Phase 2 Rust
 *      `fetch_url_title` command with its 5 s timeout, 10 MiB body cap,
 *      5-redirect limit, and empty-string-on-error contract);
 *   3. swap the placeholder for `[title](url)` on success, or for the
 *      raw URL on empty / error.
 *
 * If the paste lands over a non-empty selection, we treat it as
 * "linkify the selection" and insert `[selected-text](url)` without a
 * placeholder round-trip.
 *
 * If the paste lands inside a code block (fenced or inline) we skip the
 * smart path and let CodeMirror paste verbatim — URLs inside code
 * blocks should remain URLs, not links.
 *
 * Q13 (image paste) is not part of this module yet; it lands in a
 * follow-up commit.
 */

import { EditorView } from '@codemirror/view';

// ---------------------------------------------------------------------
// Pure helpers — exported for direct unit tests.
// ---------------------------------------------------------------------

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

export interface SmartPasteHandlerOptions {
  fetchUrlTitle: FetchUrlTitle;
  /** Hook so tests can observe the final state after an async title fetch. */
  onUrlPasteResolved?: ((result: { url: string; title: string }) => void) | undefined;
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
 * `EditorView.domEventHandlers` so URL paste, (future) image paste,
 * and the fall-through to default paste all live in one place.
 */
export function createSmartPasteExtension(options: SmartPasteHandlerOptions) {
  const { fetchUrlTitle, onUrlPasteResolved } = options;

  return EditorView.domEventHandlers({
    paste: (event: ClipboardEvent, view: EditorView) => {
      const cd = event.clipboardData;
      if (!cd) return false;

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
          ...(onUrlPasteResolved ? { onUrlPasteResolved } : {}),
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

// THE HTML/URL SANITIZER CHOKEPOINT.
//
// R-14 was filed as "pdf-export.ts:142-147 is a THIRD sanitizer the tracked
// unification does not cover". Settling it before grading inverted the finding:
// that third sanitizer is the STRONGEST of the four that exist. It is the only
// one that filters URL schemes and the only one that strips inline event
// handlers. The gap is in path #1, `MarkdownPreview.tsx`'s `markdownToHtml`,
// which the unification already tracked — it escapes `& < >` and then
// interpolates the RAW link capture into an attribute, so
// `[x](" onmouseover="alert(1))` breaks out of the `href` quote.
//
// This module is where the four become one:
//   safeUrlAttribute()   — the scheme allowlist, for string-built markup.
//   escapeHtmlText()     — the text escape, including the quote.
//   sanitizeHtmlIntoDocument() — the DOM pass lifted verbatim in behaviour
//                          from pdf-export.ts, now shared.
//
// The string helpers exist because two of the four renderers build markup by
// regex and have no DOM available at that point. They are not a substitute for
// the DOM pass; where both can run, both run.

/**
 * URL schemes permitted in an `href` / `src` produced from untrusted markdown.
 * Relative and fragment URLs are allowed; anything that could execute is not.
 * Kept identical to the allowlist pdf-export.ts already shipped, because that
 * one is the one that has been in front of a print document without incident.
 */
const SAFE_URL_PATTERN = /^(?:https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;

/** Data URLs are permitted only for images, and only for image media types. */
const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i;

/** Placeholder substituted for a URL that fails the allowlist. */
export const BLOCKED_URL = 'about:blank#blocked';

/**
 * Escape text for insertion into HTML. Unlike the two escapes this replaces,
 * it also escapes `"` and `'` — which is the whole bug: an escape that omits
 * the quote is safe in element position and unsafe in attribute position, and
 * nothing in the type system tells the two apart.
 */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Encode a URL for use inside a double-quoted `href`/`src` attribute.
 *
 * Returns `BLOCKED_URL` when the scheme is not on the allowlist. It never
 * returns the input unchanged: even an allowed URL is quote-escaped, so a
 * caller that forgets to escape cannot produce an attribute breakout.
 *
 * @param kind `'image'` additionally permits `data:image/*` URLs.
 */
export function safeUrlAttribute(url: string, kind: 'link' | 'image' = 'link'): string {
  const trimmed = url.trim();
  const allowed =
    SAFE_URL_PATTERN.test(trimmed) || (kind === 'image' && SAFE_IMAGE_DATA_URL.test(trimmed));
  if (!allowed) return BLOCKED_URL;
  // Escape the characters that could terminate the attribute or open a new
  // one. `<`/`>` are escaped too so a URL cannot close the tag.
  return trimmed
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** True when the URL would be permitted. Exposed for tests and for callers
 *  that want to drop the element entirely rather than neutralise its URL. */
export function isSafeUrl(url: string, kind: 'link' | 'image' = 'link'): boolean {
  // R-49 — IDEMPOTENCE. The header above says "where both can run, both run",
  // but running both DELETED the marker: `about:blank#blocked` is not on the
  // allowlist, so `sanitizeInertDocument` stripped the very href
  // `safeUrlAttribute` had just written. The string half and the DOM half were
  // therefore never composable, which is only visible if you actually run them
  // together — MarkdownPreview is the first caller that does.
  //
  // The placeholder is the one URL that is safe BECAUSE we wrote it: it
  // navigates nowhere and executes nothing. Treating it as safe here makes the
  // DOM pass a no-op over the string pass's output instead of an eraser.
  if (url.trim() === BLOCKED_URL) return true;
  return safeUrlAttribute(url, kind) !== BLOCKED_URL;
}

// ---------------------------------------------------------------------------
// The DOM pass — lifted from pdf-export.ts, which had the only complete one
// ---------------------------------------------------------------------------

const URL_ATTRS: ReadonlyArray<readonly [string, string, 'link' | 'image']> = [
  ['a', 'href', 'link'],
  ['area', 'href', 'link'],
  ['img', 'src', 'image'],
  ['source', 'src', 'image'],
  ['iframe', 'src', 'link'],
  ['embed', 'src', 'link'],
  ['object', 'data', 'link'],
  ['form', 'action', 'link'],
];

const REMOVED_TAGS = 'script, style, iframe, object, embed, link, meta, base, form';

/**
 * Sanitise an already-parsed inert document in place: drop executable and
 * navigational elements, neutralise unsafe URLs, strip every `on*` handler.
 *
 * Exported so callers that already hold an inert `Document` (the print window
 * path) do not have to re-parse.
 */
export function sanitizeInertDocument(inert: Document): void {
  for (const el of Array.from(inert.querySelectorAll(REMOVED_TAGS))) {
    el.remove();
  }
  for (const [tag, attr, kind] of URL_ATTRS) {
    for (const el of Array.from(inert.querySelectorAll(tag))) {
      const value = el.getAttribute(attr);
      if (value !== null && !isSafeUrl(value, kind)) {
        el.removeAttribute(attr);
      }
    }
  }
  const walker = inert.createTreeWalker(inert.body, 1 /* SHOW_ELEMENT */);
  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as Element;
    const toRemove: string[] = [];
    for (const { name } of Array.from(el.attributes)) {
      // `on*` handlers, and `srcdoc`/`formaction` which are URL-ish sinks the
      // attribute pass above does not cover.
      if (/^on/i.test(name) || /^(?:srcdoc|formaction|xlink:href)$/i.test(name)) {
        toRemove.push(name);
      }
    }
    for (const name of toRemove) el.removeAttribute(name);
    node = walker.nextNode();
  }
}

/**
 * Parse untrusted HTML into an INERT document (scripts never run there),
 * sanitise it, and import the result into `targetDoc`'s body.
 *
 * This is the exact behaviour `pdf-export.ts` shipped; it now lives here so
 * the next renderer gets it by importing rather than by re-deriving it.
 */
export function sanitizeHtmlIntoDocument(targetDoc: Document, renderedHtml: string): void {
  const inert = new DOMParser().parseFromString(renderedHtml, 'text/html');
  sanitizeInertDocument(inert);
  for (const child of Array.from(inert.body.childNodes)) {
    targetDoc.body.appendChild(targetDoc.importNode(child, true));
  }
}

/**
 * String-in / string-out sanitiser for the `dangerouslySetInnerHTML` callers.
 * Requires a DOM (`DOMParser`); when none is available it FAILS CLOSED by
 * returning the HTML-escaped source rather than the unsanitised markup.
 */
export function sanitizeHtmlString(renderedHtml: string): string {
  if (typeof DOMParser === 'undefined') {
    return escapeHtmlText(renderedHtml);
  }
  const inert = new DOMParser().parseFromString(renderedHtml, 'text/html');
  sanitizeInertDocument(inert);
  return inert.body.innerHTML;
}

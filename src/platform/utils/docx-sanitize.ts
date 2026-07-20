// Post-render DOM sanitizer for the `.docx` preview (render-sink S7).
//
// THE DEFECT (runtime-proven, c34): docx-preview's `renderHyperlink`
// (node_modules/docx-preview/dist/docx-preview.mjs:3473-3485) copies a Word
// document's EXTERNAL relationship target verbatim onto `<a href>` — no scheme
// filter, no allow-list. A `.docx` (meeting notes, an imported or peer-synced
// Word file) carrying a `javascript:` hyperlink therefore renders as a live,
// app-origin `<a href="javascript:…">`; the DocxViewer's Shadow DOM is *style*
// isolation, not a script sandbox, so clicking runs the payload with full Tauri
// access.
//
// SECOND, WORSE VECTOR (found while fixing, c34): docx-preview 0.3.7 defaults
// `renderAltChunks` to TRUE (docx-preview.mjs:3973). An `altChunk` part embeds a
// whole HTML file, which docx-preview drops into an `<iframe srcdoc=…>` that runs
// its <script> WITHOUT a click, in the embedding origin. The caller
// (renderDocxPreview) now pins `renderAltChunks: false`; this sanitizer ALSO
// removes any `<iframe>`/`<script>`/`<object>`/`<embed>` from the produced
// subtree as defense-in-depth, so the class is closed twice over.
//
// The fix is a post-render pass over the produced subtree using the SHARED
// URL allow-list (src/platform/security/urlAllowlist.ts, identical to the
// markdown-preview S2 lane's `sanitizeUrl`): every href/src is scheme-checked
// against a positive allow-list (http/https/mailto/tel + raster — NON-SVG —
// data:image for src), every on* handler is stripped, and script/iframe/object/
// embed elements are removed. Legitimate http(s)/mailto links and embedded
// raster images survive untouched.

import { isAllowedUrl } from '@/platform/security/urlAllowlist';

export interface DocxSanitizeReport {
  /** href/src values neutralized because their scheme was not allow-listed. */
  neutralizedUrls: Array<{ tag: string; attr: string; value: string }>;
  /** on* event-handler attributes stripped. */
  strippedHandlers: Array<{ tag: string; attr: string }>;
  /** script/iframe/object/embed elements removed wholesale. */
  removedElements: string[];
}

// Elements that must never survive in rendered document output. docx-preview
// with `renderAltChunks:false` should never emit an <iframe>; a <script> should
// never appear at all. Removing them regardless makes the subtree inert even if
// a future library change (or option regression) re-introduces one.
const FORBIDDEN_ELEMENTS = 'script, iframe, object, embed';

// URL-bearing attributes and the sink kind that governs each one.
const URL_ATTRS: Array<{ attr: string; kind: 'nav' | 'image' }> = [
  { attr: 'href', kind: 'nav' }, // <a href>, <area href>
  { attr: 'src', kind: 'image' }, // <img src>, <source src>
  { attr: 'poster', kind: 'image' }, // <video poster>
  { attr: 'xlink:href', kind: 'image' }, // SVG <image>/<a> legacy attribute
];

/**
 * Neutralize dangerous href/src schemes, on* handlers, and script/frame
 * elements in a freshly-rendered `.docx` subtree, in place. Returns a report of
 * everything it changed (used by the security suite to assert the sink is inert
 * and to prove the guard is doing work).
 *
 * Call this AFTER `renderAsync` has resolved — at that point docx-preview has
 * awaited all of its deferred tasks (images, fonts), so the subtree is complete
 * (docx-preview.mjs:2913 `await Promise.allSettled(this.tasks)`).
 */
export function sanitizeRenderedDocxDom(root: ParentNode): DocxSanitizeReport {
  const report: DocxSanitizeReport = {
    neutralizedUrls: [],
    strippedHandlers: [],
    removedElements: [],
  };

  // 1. Remove forbidden elements outright.
  for (const el of Array.from(root.querySelectorAll(FORBIDDEN_ELEMENTS))) {
    report.removedElements.push(el.tagName.toLowerCase());
    el.remove();
  }

  // 2. Walk every remaining element: strip on* handlers, scheme-check URLs.
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();

    // 2a. Strip inline event handlers (onclick/onerror/onload/…).
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) {
        report.strippedHandlers.push({ tag, attr: attr.name });
        el.removeAttribute(attr.name);
      }
    }

    // 2b. Neutralize any href/src whose scheme is not allow-listed. Removing the
    //     attribute leaves an inert element (a non-navigable <a>, a blank <img>)
    //     rather than a broken render. Image sinks allow docx-preview's binary
    //     embed form (data:application/octet-stream / blob:) — an <img> cannot
    //     execute, so this preserves real Word images without any script path.
    for (const { attr, kind } of URL_ATTRS) {
      const value = el.getAttribute(attr);
      if (value == null || value === '') continue;
      const allowed =
        kind === 'image'
          ? isAllowedUrl(value, 'image', { allowBinaryData: true })
          : isAllowedUrl(value, 'nav');
      if (!allowed) {
        report.neutralizedUrls.push({ tag, attr, value });
        el.removeAttribute(attr);
      }
    }
  }

  return report;
}

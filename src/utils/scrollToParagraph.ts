/**
 * F-504 — citation click-through scroll plumbing.
 *
 * App.tsx dispatches `keepance:scroll-to-paragraph` right after opening the
 * cited file, but the editor for a freshly-opened tab mounts AFTER that
 * dispatch (same-tick state update), so a bare event listener misses it.
 * The slot keeps the most recent request so the editor can consume it on
 * mount; the event stays for already-mounted editors (re-click while open).
 */
export const SCROLL_TO_PARAGRAPH_EVENT = 'keepance:scroll-to-paragraph';

export interface ScrollToParagraphDetail {
  path: string;
  /** The CHUNK index from retrieval (chunker.rs sequential index), NOT a
   *  literal paragraph number — used only for the approximate fallback. */
  paragraphIndex: number;
  /** The cited chunk's text — located by exact search when present. */
  snippet?: string;
}

let pending: ScrollToParagraphDetail | null = null;

export function requestScrollToParagraph(detail: ScrollToParagraphDetail): void {
  pending = detail;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SCROLL_TO_PARAGRAPH_EVENT, { detail }));
  }
}

/** Consume (and clear) the pending request for `path`, if any. */
export function consumePendingScroll(path: string): ScrollToParagraphDetail | null {
  if (pending && pending.path === path) {
    const out = pending;
    pending = null;
    return out;
  }
  return null;
}

/** Mirror of the Rust chunker's per-chunk byte budget (chunker.rs:15-23):
 *  TARGET_TOKENS 384 * BYTES_PER_TOKEN 4. Used only for the no-snippet
 *  fallback, so approximate is fine. */
const CHUNK_TARGET_BYTES = 1536;

/** Approximate the character offset where chunk `paragraphIndex` starts:
 *  walk double-newline blocks accumulating UTF-8 bytes, counting a chunk
 *  per budget fill (overlap ignored — a slight early bias centers fine). */
export function approximateChunkOffset(doc: string, paragraphIndex: number): number {
  if (paragraphIndex <= 0) return 0;
  const enc = new TextEncoder();
  let chunk = 0;
  let bytes = 0;
  const re = /\n\s*\n/g;
  let blockStart = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    bytes += enc.encode(doc.slice(blockStart, m.index)).length;
    blockStart = re.lastIndex;
    while (bytes >= CHUNK_TARGET_BYTES) {
      bytes -= CHUNK_TARGET_BYTES;
      chunk += 1;
      if (chunk >= paragraphIndex) return blockStart;
    }
  }
  return Math.min(doc.length, paragraphIndex * CHUNK_TARGET_BYTES);
}

/**
 * Resolve a scroll request to a character position in `doc`. Primary:
 * exact search for the cited chunk's first searchable line (trimmed,
 * ≥ 8 chars — skips list markers / blank lines). Fallback: the
 * approximate chunk-offset walk. Always clamped into the document.
 */
export function resolveScrollPosition(
  doc: string,
  detail: Pick<ScrollToParagraphDetail, 'paragraphIndex' | 'snippet'>,
): number {
  let pos = -1;
  if (detail.snippet) {
    const firstLine = detail.snippet
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length >= 8);
    if (firstLine) pos = doc.indexOf(firstLine);
  }
  if (pos < 0) pos = approximateChunkOffset(doc, detail.paragraphIndex);
  return Math.max(0, Math.min(pos, doc.length));
}

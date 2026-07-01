// Display-only DOM helpers for the Word document editor (WS-A / A3).
//
// PURE functions over the JSON DOM (`DocumentJson`). They never mutate the DOM
// and never produce anything sent back to the engine — they only derive what
// the React editor needs to render: parsed common formatting, grouped
// revisions, text snippets, and comment-anchor bookkeeping.
//
// IMPORTANT FIDELITY RULE: `propertiesXml` is OPAQUE OOXML. We parse a small,
// well-known subset (`w:b`, `w:i`, `w:u`, `w:strike`, `w:sz`, `w:color`,
// `w:highlight`, `w:pStyle`, `w:jc`) FOR DISPLAY ONLY. Anything we don't
// recognize is ignored for rendering and left untouched in the data so it
// survives `docx_save`. Parsing uses a forgiving regex pass rather than a full
// XML parser: the strings are small, namespace prefixes vary (`w:` is the
// common one but we accept any prefix), and we must never throw on malformed
// input — we just render plain text in that case.

import type {
  DocumentJson,
  DocxBlock,
  DocxComment,
  DocxInline,
  DocxParagraph,
  DocxRun,
  GroupedRevision,
  ParsedParagraphFormat,
  ParsedRunFormat,
} from '@/platform/types/docx';
import { BRAND } from '@/config/brand';

// ---------------------------------------------------------------------------
// propertiesXml parsing (run-level)
// ---------------------------------------------------------------------------

/**
 * Does a self-closing/boolean OOXML toggle element resolve to "on"?
 *
 * OOXML toggles (`w:b`, `w:i`, `w:u`, `w:strike`) are "on" when present with no
 * `w:val`, or with `w:val` of `1`/`true`/`on`. They are "off" when `w:val` is
 * `0`/`false`/`off`/`none`. `tagName` is the local name (without prefix).
 */
function isToggleOn(xml: string, tagName: string): boolean | undefined {
  // Match `<w:b/>`, `<w:b />`, `<w:b w:val="0"/>`, `<w:b></w:b>` with any prefix.
  const re = new RegExp(
    `<(?:\\w+:)?${tagName}(\\s[^>]*?)?\\s*/?>`,
    'i',
  );
  const m = re.exec(xml);
  if (!m) return undefined;
  const attrs = m[1] ?? '';
  const valMatch = /\bval\s*=\s*"([^"]*)"/i.exec(attrs);
  if (!valMatch) return true; // present, no val => on
  const val = (valMatch[1] ?? '').toLowerCase();
  if (val === '0' || val === 'false' || val === 'off' || val === 'none') {
    return false;
  }
  return true;
}

/** Read a `w:val` attribute off the first matching element. */
function readVal(xml: string, tagName: string): string | undefined {
  const re = new RegExp(
    `<(?:\\w+:)?${tagName}(\\s[^>]*?)?\\s*/?>`,
    'i',
  );
  const m = re.exec(xml);
  if (!m) return undefined;
  const attrs = m[1] ?? '';
  const valMatch = /\bval\s*=\s*"([^"]*)"/i.exec(attrs);
  return valMatch?.[1];
}

/**
 * Parse the common, display-worthy run properties out of a `<w:rPr>` string.
 * Returns an empty object when `propertiesXml` is absent or has nothing we map.
 * Never throws.
 */
export function parseRunFormat(propertiesXml: string | undefined): ParsedRunFormat {
  const out: ParsedRunFormat = {};
  if (!propertiesXml) return out;
  try {
    const bold = isToggleOn(propertiesXml, 'b');
    if (bold !== undefined) out.bold = bold;
    const italic = isToggleOn(propertiesXml, 'i');
    if (italic !== undefined) out.italic = italic;

    // Underline: `w:u w:val="single|double|..."`. "none" => off.
    const uVal = readVal(propertiesXml, 'u');
    if (uVal !== undefined) {
      out.underline = uVal.toLowerCase() !== 'none';
    }

    const strike = isToggleOn(propertiesXml, 'strike');
    if (strike !== undefined) out.strike = strike;

    // Size: `w:sz w:val="24"` is in half-points => 12pt.
    const szVal = readVal(propertiesXml, 'sz');
    if (szVal !== undefined) {
      const half = Number.parseInt(szVal, 10);
      if (Number.isFinite(half) && half > 0) out.fontSizePt = half / 2;
    }

    // Color: `w:color w:val="1A2B3C"` (hex without #) or "auto".
    const colorVal = readVal(propertiesXml, 'color');
    if (colorVal !== undefined && colorVal.toLowerCase() !== 'auto') {
      out.color = /^[0-9a-fA-F]{6}$/.test(colorVal) ? `#${colorVal}` : colorVal;
    }

    // Highlight: `w:highlight w:val="yellow"` — a named color.
    const hl = readVal(propertiesXml, 'highlight');
    if (hl !== undefined && hl.toLowerCase() !== 'none') {
      out.highlight = hl;
    }
  } catch {
    // Malformed properties => render plain text. Never throw.
    return {};
  }
  return out;
}

/**
 * Map a parsed run format to inline React style + className hints.
 * Returns a `style` object and an `underline`/`strike` flag pair the renderer
 * combines with revision decorations (insertions are always underlined, etc.).
 */
export function runFormatToStyle(fmt: ParsedRunFormat): {
  style: React.CSSProperties;
  underline: boolean;
  strike: boolean;
} {
  const style: React.CSSProperties = {};
  if (fmt.bold) style.fontWeight = 700;
  if (fmt.italic) style.fontStyle = 'italic';
  if (fmt.fontSizePt) style.fontSize = `${String(fmt.fontSizePt)}pt`;
  if (fmt.color) style.color = fmt.color;
  if (fmt.highlight) {
    style.backgroundColor = highlightColor(fmt.highlight);
  }
  return {
    style,
    underline: Boolean(fmt.underline),
    strike: Boolean(fmt.strike),
  };
}

/** Map an OOXML highlight color name to a CSS color. Unknown => the name. */
function highlightColor(name: string): string {
  const map: Record<string, string> = {
    yellow: '#fff385',
    green: '#9bff9b',
    cyan: '#9bffff',
    magenta: '#ff9bff',
    blue: '#9b9bff',
    red: '#ff9b9b',
    darkblue: '#000080',
    darkcyan: '#008080',
    darkgreen: '#008000',
    darkmagenta: '#800080',
    darkred: '#800000',
    darkyellow: '#808000',
    darkgray: '#808080',
    lightgray: '#c0c0c0',
    black: '#000000',
    white: '#ffffff',
  };
  return map[name.toLowerCase()] ?? name;
}

// ---------------------------------------------------------------------------
// propertiesXml parsing (paragraph-level)
// ---------------------------------------------------------------------------

/**
 * Parse common paragraph properties out of a `<w:pPr>` string: heading level
 * (from `w:pStyle` `Heading1`..`Heading6`) and alignment (from `w:jc`).
 * Never throws.
 */
export function parseParagraphFormat(
  propertiesXml: string | undefined,
): ParsedParagraphFormat {
  const out: ParsedParagraphFormat = {};
  if (!propertiesXml) return out;
  try {
    const styleVal = readVal(propertiesXml, 'pStyle');
    if (styleVal) {
      // Word's built-in heading styles are "Heading1".."Heading6" (also seen
      // as "Heading 1" or lowercase in some producers). Normalize loosely.
      const m = /heading\s*([1-6])/i.exec(styleVal);
      if (m) {
        out.headingLevel = Number.parseInt(m[1] ?? '0', 10) as 1 | 2 | 3 | 4 | 5 | 6;
      }
    }

    const jc = readVal(propertiesXml, 'jc');
    if (jc) {
      const v = jc.toLowerCase();
      if (v === 'center') out.alignment = 'center';
      else if (v === 'right' || v === 'end') out.alignment = 'right';
      else if (v === 'both' || v === 'distribute' || v === 'justify') {
        out.alignment = 'justify';
      } else if (v === 'left' || v === 'start') out.alignment = 'left';
    }
  } catch {
    return {};
  }
  return out;
}

// ---------------------------------------------------------------------------
// Revision grouping + text extraction
// ---------------------------------------------------------------------------

/** Concatenate the text of a run list. */
export function runsText(runs: DocxRun[]): string {
  return runs.map((r) => r.text).join('');
}

/**
 * Walk the document body and collect every tracked change, grouped by revision
 * id (Word keys accept/reject on the id, so two `w:ins` with the same id are one
 * logical change). Runs from same-id revisions are concatenated for the snippet.
 * Returned in document order (first appearance of each id).
 */
export function groupRevisions(doc: DocumentJson): GroupedRevision[] {
  // `ordered` preserves first-appearance order; `byId` lets later same-id runs
  // append to the same entry. We push the entry object into `ordered` once, so
  // there is no second lookup (and no non-null assertion needed).
  const ordered: GroupedRevision[] = [];
  const byId = new Map<string, GroupedRevision>();

  doc.body.forEach((block, blockIndex) => {
    if (block.kind !== 'paragraph') return;
    for (const inline of block.inlines) {
      if (inline.kind !== 'insertion' && inline.kind !== 'deletion') continue;
      const { id, author, date } = inline.meta;
      const text = runsText(inline.runs);
      const existing = byId.get(id);
      if (existing) {
        existing.text += text;
      } else {
        const entry: GroupedRevision = {
          id,
          kind: inline.kind,
          author,
          date,
          text,
          blockIndex,
        };
        byId.set(id, entry);
        ordered.push(entry);
      }
    }
  });

  return ordered;
}

/**
 * Cheap, namespace-PREFIX-AGNOSTIC presence check for an `ins`/`del` element
 * (which also matches `delText`/`delInstrText`, since they share the `del`
 * prefix) inside a raw (unmodeled) block's XML. Used only to decide whether
 * the Accept All / Reject All buttons should be enabled — see
 * `countRevisions` below.
 *
 * Matches the LOCAL element name regardless of what namespace prefix a
 * producer bound to the WordprocessingML namespace (`w:ins` is by far the
 * most common in real `.docx` files, but OOXML doesn't require that literal
 * prefix — a spec-valid document could use `<word:ins>`, `<pkg:del>`, or even
 * no prefix at all). The engine (`local_of` in `parse.rs`/`resolve.rs`) has
 * always matched by local name this way; this brings the frontend gate in
 * line with it (coordinator/Codex review) — the literal `<w:ins`/`<w:del`
 * substring check missed any other prefix, silently disabling the buttons
 * for a valid document the engine could otherwise resolve.
 *
 * `ins` requires a following delimiter (whitespace, `/`, or `>`) so it
 * doesn't false-match the unrelated `w:instrText` (field instruction text —
 * a real OOXML element, not a tracked change). `del` intentionally has no
 * trailing boundary so it still catches `delText`/`delInstrText` (there is
 * no OOXML element starting with "del" that isn't deletion-related).
 *
 * A substring/regex scan, not a parse: `DocxRawBlock`'s xml is deliberately
 * never parsed on the frontend (preserve-by-default — see its doc comment),
 * and this only needs to answer "might there be something to resolve," not
 * itemize it. A false positive would just make Accept All a harmless no-op
 * for that block (the engine's own exact scan is what actually resolves —
 * or doesn't — real content).
 */
const RAW_TRACKED_CHANGE_MARKUP_RE = /<(?:[\w.-]+:)?ins[\s/>]|<(?:[\w.-]+:)?del/;

function rawBlockHasTrackedChangeMarkup(xml: string): boolean {
  return RAW_TRACKED_CHANGE_MARKUP_RE.test(xml);
}

/**
 * Count of distinct tracked changes (grouped by id) in paragraphs, PLUS 1 if
 * any raw (unmodeled) block — e.g. a table — appears to carry tracked-change
 * markup (CLUSTER-C3 P2, Codex review). Without this, a document whose ONLY
 * tracked changes live inside a table showed "0 changes" and disabled the
 * Accept All / Reject All buttons even though the engine's `resolve_all` now
 * genuinely resolves tracked changes inside raw blocks too (`resolve.rs`) —
 * making that engine-side fix unreachable from the UI for an all-table
 * document. The `+1` (not an exact raw-revision count) is deliberate: the
 * review pane's per-revision list only itemizes paragraph revisions (raw XML
 * is never parsed here), so this only needs to unblock the buttons, not
 * claim a precise total.
 */
export function countRevisions(doc: DocumentJson): number {
  const paragraphCount = groupRevisions(doc).length;
  const hasRawRevisions = doc.body.some(
    (block) => block.kind === 'raw' && rawBlockHasTrackedChangeMarkup(block.xml),
  );
  return paragraphCount + (hasRawRevisions ? 1 : 0);
}

/** All comments as an array, sorted by date ascending then id for stability. */
export function commentList(doc: DocumentJson): DocxComment[] {
  return Object.values(doc.comments ?? {}).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Set of comment ids that have an anchor (commentRangeStart) in the body. */
export function anchoredCommentIds(doc: DocumentJson): Set<string> {
  const ids = new Set<string>();
  for (const block of doc.body) {
    if (block.kind !== 'paragraph') continue;
    for (const inline of block.inlines) {
      if (inline.kind === 'commentRangeStart') ids.add(inline.id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Plain-text + author summary helpers
// ---------------------------------------------------------------------------

/** Flatten an inline to its visible text (revisions included; markers => ''). */
export function inlineText(inline: DocxInline): string {
  switch (inline.kind) {
    case 'run':
      return inline.text;
    case 'insertion':
    case 'deletion':
      return runsText(inline.runs);
    default:
      return '';
  }
}

/** Flatten a paragraph to its visible text. */
export function paragraphText(p: DocxParagraph): string {
  return p.inlines.map(inlineText).join('');
}

/** Whole-document plain text (paragraphs joined by newlines; raw blocks => ''). */
export function documentPlainText(doc: DocumentJson): string {
  return doc.body
    .map((b: DocxBlock) => (b.kind === 'paragraph' ? paragraphText(b) : ''))
    .join('\n');
}

/**
 * A short, human snippet for a revision row in the review pane: trims, collapses
 * whitespace, and caps length with an ellipsis.
 */
export function snippet(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Format an ISO date for a tooltip / review row. Falls back to the raw string
 * if it doesn't parse (the engine passes `w:date` through verbatim, which is
 * usually ISO-8601 but we don't assume).
 */
export function formatRevisionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// A small palette of distinguishable, accessible-on-white hues. Hashing the
// author name to a stable index keeps the same author on the same color. Navy
// (the app accent) leads. Tuple-typed so the fallback `[0]` is always a string.
const AUTHOR_PALETTE = [
  BRAND.colors.navy, // navy (app accent) — literal hex; this palette feeds OOXML/Word colours, not CSS
  '#9333ea', // purple
  '#0d9488', // teal
  '#c2410c', // burnt orange
  '#be185d', // pink
  '#1d4ed8', // blue
  '#4d7c0f', // olive
  '#a16207', // amber-brown
] as const;

/** Stable per-author color for revision attribution (Word-like author colors). */
export function authorColor(author: string): string {
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = (hash * 31 + author.charCodeAt(i)) >>> 0;
  }
  return AUTHOR_PALETTE[hash % AUTHOR_PALETTE.length] ?? AUTHOR_PALETTE[0];
}

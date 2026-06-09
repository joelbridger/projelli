// DocumentJson DOM contract (WS-A / A3)
//
// TypeScript mirror of the canonical JSON DOM produced by the in-house OOXML
// engine (`keepance_docx::Document`, see
// `src-tauri/crates/keepance-docx/src/model.rs`). The engine serializes serde
// with `rename_all = "camelCase"` and an internal `kind` tag on the inline /
// block enums, so these types match the wire shape exactly.
//
// The editor (A3) renders this; the AI redliner (A4) authors against it. Treat
// `propertiesXml` / `bodyXml` / raw `xml` as OPAQUE — never drop them, they must
// survive a round-trip back through `docx_save`. We parse a handful of common
// run/paragraph properties FOR DISPLAY ONLY (see `utils/docx-dom.ts`).

/** Current DOM JSON format version the engine emits (`DOM_FORMAT_VERSION`). */
export const DOCX_DOM_FORMAT_VERSION = 1;

/**
 * A single text run with its raw text and (preserved) run properties.
 *
 * `text` is verbatim (whitespace-significant runs round-trip exactly).
 * `propertiesXml` is the run's `<w:rPr>...</w:rPr>` exactly as it appeared —
 * re-emitted untouched; we only parse it for display.
 */
export interface DocxRun {
  text: string;
  /** Whether the source run carried `xml:space="preserve"`. */
  preserveSpace?: boolean;
  /** The run's `<w:rPr>` verbatim, or absent if the run had no properties. */
  propertiesXml?: string;
}

/**
 * Author + date metadata shared by every revision element. `id` is the OOXML
 * `w:id` that ties a revision together (and that Word keys accept/reject on).
 */
export interface DocxRevisionMeta {
  id: string;
  author: string;
  /** ISO-8601 timestamp string exactly as it appears in `w:date`. */
  date: string;
}

/** A plain, un-revised run of text. */
export interface DocxInlineRun extends DocxRun {
  kind: 'run';
}

/** A tracked insertion: `<w:ins>...<w:r><w:t>..</w:t></w:r>...</w:ins>`. */
export interface DocxInlineInsertion {
  kind: 'insertion';
  meta: DocxRevisionMeta;
  runs: DocxRun[];
}

/** A tracked deletion: `<w:del>...<w:r><w:delText>..</w:delText></w:r>...</w:del>`. */
export interface DocxInlineDeletion {
  kind: 'deletion';
  meta: DocxRevisionMeta;
  runs: DocxRun[];
}

/** `<w:commentRangeStart w:id=".."/>` — where a comment anchor begins. */
export interface DocxInlineCommentRangeStart {
  kind: 'commentRangeStart';
  id: string;
}

/** `<w:commentRangeEnd w:id=".."/>` — where a comment anchor ends. */
export interface DocxInlineCommentRangeEnd {
  kind: 'commentRangeEnd';
  id: string;
}

/** The run carrying `<w:commentReference w:id=".."/>`. */
export interface DocxInlineCommentReference {
  kind: 'commentReference';
  id: string;
}

/**
 * PRESERVE-BY-DEFAULT: any inline-level element the engine does not model,
 * captured as its exact serialized XML and re-emitted byte-for-byte. Covers
 * hyperlinks, fields, drawings, smartTags, bookmarks, etc.
 */
export interface DocxInlineRaw {
  kind: 'raw';
  xml: string;
}

/** One inline item inside a paragraph (tag-discriminated by `kind`). */
export type DocxInline =
  | DocxInlineRun
  | DocxInlineInsertion
  | DocxInlineDeletion
  | DocxInlineCommentRangeStart
  | DocxInlineCommentRangeEnd
  | DocxInlineCommentReference
  | DocxInlineRaw;

/** A paragraph: optional preserved `<w:pPr>` plus ordered inline content. */
export interface DocxParagraph {
  kind: 'paragraph';
  /** The paragraph's `<w:pPr>` verbatim, or absent. */
  propertiesXml?: string;
  inlines: DocxInline[];
}

/**
 * PRESERVE-BY-DEFAULT: a non-paragraph block (e.g. `<w:tbl>`, `<w:sdt>`,
 * `<w:sectPr>`) kept as exact serialized XML. The editor renders a read-only
 * placeholder for these — it must NOT parse the XML.
 */
export interface DocxRawBlock {
  kind: 'raw';
  xml: string;
}

/** One block-level item in the document body. */
export type DocxBlock = DocxParagraph | DocxRawBlock;

/** One comment from `word/comments.xml`. */
export interface DocxComment {
  id: string;
  author: string;
  date: string;
  /** `w:initials` — optional in OOXML; preserved when present. */
  initials?: string;
  /** Flattened plain text of the comment body (for display). */
  text: string;
  /** The comment's inner content (`<w:p>...</w:p>`) verbatim, or absent. */
  bodyXml?: string;
}

/**
 * The whole document model. `comments` is keyed by comment id. This is the
 * exact object handed to / returned from the `docx_*` Tauri commands.
 */
export interface DocumentJson {
  /** DOM JSON format version. */
  formatVersion: number;
  body: DocxBlock[];
  comments: Record<string, DocxComment>;
}

/** Accept or reject — the action strings the resolve commands accept. */
export type DocxResolveAction = 'accept' | 'reject';

// ---------------------------------------------------------------------------
// Display-only helper shapes (produced by utils/docx-dom.ts, never sent back to
// the engine). These describe parsed common formatting and grouped revisions
// the UI renders.
// ---------------------------------------------------------------------------

/** Parsed common run formatting (display only). All fields optional. */
export interface ParsedRunFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Font size in points (converted from `w:sz` half-points). */
  fontSizePt?: number;
  /** Hex color like `#1A2B3C`, or a named color, from `w:color`. */
  color?: string;
  /** Highlight color name from `w:highlight` (e.g. "yellow"). */
  highlight?: string;
}

/** Parsed common paragraph formatting (display only). */
export interface ParsedParagraphFormat {
  /** Heading level 1-6 from `w:pStyle` Heading1..Heading6, else undefined. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  /** Text alignment from `w:jc`. */
  alignment?: 'left' | 'center' | 'right' | 'justify';
}

/**
 * A tracked change grouped by its revision id, with everything the Review pane
 * needs: kind, author/date, a text snippet, and the paragraph index it lives in
 * (for future scroll-to-revision).
 */
export interface GroupedRevision {
  id: string;
  kind: 'insertion' | 'deletion';
  author: string;
  date: string;
  /** Concatenated text of all runs in the revision (for the snippet). */
  text: string;
  /** Index into `body` of the first block this revision appears in. */
  blockIndex: number;
}

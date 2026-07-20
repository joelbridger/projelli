// DOCX IO Utilities
// Helpers for parsing `.docx` files for read-only preview, AI extraction, and
// round-trip serialization from TipTap HTML.
//
// Libraries involved:
//  - `docx-preview` (Apache-2.0) renders DOCX directly into a DOM container,
//    matching Word layout closely. Used by the viewer.
//  - `mammoth` (BSD-2-Clause) extracts clean HTML and plain text. Used for
//    AI ambient-context extraction and as the source of truth for initial
//    TipTap content in the editor.
//  - `docx` (MIT) builds `.docx` packages from scratch for the save path.

import mammoth from 'mammoth';
import { renderAsync } from 'docx-preview';
import JSZip from 'jszip';
import { assertArchiveWithinBudget, readGuardedZip } from '@/platform/archive/safeZip';
import { safeUrlAttribute } from '@/platform/render/htmlSanitize';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';

import type { ContradictionAnalysisResult, ContradictionFinding } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';
import { readTauriFile } from '@/platform/fs/tauriFsPlugin';

import { dataUrlToArrayBuffer } from './spreadsheet-io';

/** Either a data URL (typical when read via FSBackend) or raw bytes. */
type DocxSource = string | ArrayBuffer;

/**
 * Options for DOCX export. All fields are optional; omitting them produces
 * the same output as the un-branded default.
 */
export interface DocxExportOptions {
  /** Firm or organization name to display at the top of the exported document. */
  firmName?: string;
}

/** Extracted text representations suitable for AI prompts. */
export interface DocxTextExtraction {
  /** Clean semantic HTML (mammoth's "messages" warnings dropped). */
  html: string;
  /** Plain text, paragraph breaks preserved. */
  plainText: string;
}

/**
 * Normalize the input into an `ArrayBuffer` that the renderer can consume.
 *
 * R-17 — a `.docx` IS a zip, and BOTH readers below unzip it inside a
 * third-party library (mammoth, docx-preview) where we cannot meter the
 * decompression. The archive pre-flight runs here, on the single funnel every
 * `.docx` reader passes through, so a new reader added downstream inherits it
 * instead of having to remember it.
 */
export async function parseDocxForPreview(source: DocxSource): Promise<ArrayBuffer> {
  const buffer = typeof source === 'string' ? dataUrlToArrayBuffer(source) : source;
  await assertArchiveWithinBudget(buffer, 'document .docx');
  return buffer;
}

/**
 * Extract clean HTML + plain text from a `.docx` file using mammoth.
 * Used by future AI integration (Phase 2). Exposed now so the API is stable.
 */
export async function extractDocxText(source: DocxSource): Promise<DocxTextExtraction> {
  const buffer = await parseDocxForPreview(source);

  // mammoth's browser type accepts `{ arrayBuffer }`. Cast through unknown
  // because the bundled `.d.ts` is shared with the Node build.
  const input = { arrayBuffer: buffer } as unknown as Parameters<typeof mammoth.convertToHtml>[0];

  const [htmlResult, textResult] = await Promise.all([
    mammoth.convertToHtml(input),
    mammoth.extractRawText(input),
  ]);

  return {
    html: htmlResult.value,
    plainText: textResult.value,
  };
}

/**
 * Render a `.docx` file into the given container using docx-preview.
 * The container is wiped before render. Defaults match Word more closely than
 * docx-preview's stock options (page breaks shown, experimental layout on).
 */
export async function renderDocxPreview(
  bytes: ArrayBuffer,
  container: HTMLElement
): Promise<void> {
  // R-17 — docx-preview unzips internally. Callers may hand us bytes that did
  // not come through parseDocxForPreview, so the pre-flight runs here too.
  // Repeating a cheap header check is the correct trade against a caller that
  // silently skips it.
  await assertArchiveWithinBudget(bytes, 'document .docx (preview)');

  // docx-preview accepts a Blob OR an ArrayBuffer. Wrap to be explicit and
  // because some bundlers strip ArrayBuffer recognition off of typed arrays.
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });

  await renderAsync(blob, container, undefined, {
    inWrapper: true,
    ignoreLastRenderedPageBreak: false,
    experimental: true,
    breakPages: true,
    useBase64URL: true, // embed images inline so nothing leaks to the network
  });
}

// ---------------------------------------------------------------------------
// Serialize: TipTap HTML → .docx bytes
// ---------------------------------------------------------------------------
//
// TipTap-to-docx mapping coverage:
//   - Paragraphs (<p>) → Paragraph with TextRun children
//   - Headings (<h1>-<h6>) → Paragraph with heading level set
//   - Bold (<strong>, <b>) → TextRun({ bold: true })
//   - Italic (<em>, <i>) → TextRun({ italics: true })
//   - Underline (<u>) → TextRun({ underline: {} })
//   - Strikethrough (<s>, <strike>) → TextRun({ strike: true })
//   - Inline code (<code>) → TextRun({ font: 'Courier New' })
//   - Ordered list (<ol>/<li>) → Paragraph with numbering reference
//   - Unordered list (<ul>/<li>) → Paragraph with bullet: { level }
//   - Hyperlinks (<a href>) → ExternalHyperlink with TextRun children
//   - Horizontal rules (<hr>) → empty paragraph (visually collapses)
//   - Line breaks (<br>) → TextRun with break: 1
//
// NOT mapped (documented limitation shown to user via banner):
//   - Tables (tab-stopped paragraphs would lose rows/columns on re-parse)
//   - Images (would need OOXML drawing + media binary round-trip)
//   - Headers / footers / page breaks
//   - Font families, sizes, colors (other than what StarterKit offers)
//   - Comments, footnotes, and endnotes
//   - Track changes / revision history
//
// The assumption is that founders round-tripping Investor Update docs care
// about text, headings, lists, and emphasis — not mail-merge features.

/**
 * Build the firm-name letterhead paragraphs that appear at the top of a
 * branded export. Returns an empty array when firmName is blank.
 */
function buildBrandingHeader(firmName: string): Paragraph[] {
  if (!firmName.trim()) return [];

  const dateString = new Date().toLocaleDateString();

  return [
    // Firm name — bold, larger
    new Paragraph({
      children: [
        new TextRun({
          text: firmName.trim(),
          bold: true,
          size: 32, // half-points → 16pt
        }),
      ],
    }),
    // Prepared-by line
    new Paragraph({
      children: [
        new TextRun({
          text: `${BRAND.messaging.exportWatermark} — ${dateString}`,
          size: 20, // 10pt
          color: '555555',
        }),
      ],
      border: {
        bottom: {
          color: 'CCCCCC',
          space: 4,
          style: BorderStyle.SINGLE,
          size: 6,
        },
      },
      spacing: { after: 240 }, // ~0.17 inches below divider
    }),
    // Blank line to give breathing room before document body
    new Paragraph({}),
  ];
}

/**
 * Serialize TipTap-produced HTML into a `.docx` byte stream.
 * `fileName` is currently unused but kept in the signature so future metadata
 * (e.g. document title) can be wired without changing callers.
 *
 * Pass `options.firmName` to prepend a branded letterhead header.
 */
export async function serializeDocx(
  tiptapHtml: string,
  _fileName: string,
  options: DocxExportOptions = {}
): Promise<Uint8Array> {
  const brandingHeader = buildBrandingHeader(options.firmName ?? '');
  const sectionChildren = htmlToDocxChildren(tiptapHtml);

  const bodyChildren = sectionChildren.length > 0 ? sectionChildren : [new Paragraph({})];

  const sectionOptions: ISectionOptions = {
    properties: {},
    children: [...brandingHeader, ...bodyChildren],
  };

  const doc = new Document({
    creator: BRAND.name,
    description: `Document edited in ${BRAND.name}`,
    numbering: {
      config: [
        {
          reference: 'lantern-ordered',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
              },
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: '%2.',
              alignment: AlignmentType.START,
              style: {
                paragraph: { indent: { left: 1440, hanging: 360 } },
              },
            },
            {
              level: 2,
              format: LevelFormat.LOWER_ROMAN,
              text: '%3.',
              alignment: AlignmentType.START,
              style: {
                paragraph: { indent: { left: 2160, hanging: 360 } },
              },
            },
          ],
        },
      ],
    },
    sections: [sectionOptions],
  });

  // Browser-first: Packer.toBlob() uses the DOM Blob API and works in
  // all browsers. Packer.toBuffer() uses Node's Buffer via JSZip's
  // `nodebuffer` output type, which throws "nodebuffer is not supported
  // by this platform" in browsers. Fall back to toBuffer only when Blob
  // is unavailable (Node/jsdom test environments).
  if (typeof Blob !== 'undefined') {
    const blob = await Packer.toBlob(doc);
    return new Uint8Array(await blob.arrayBuffer());
  }
  const nodeBuffer: Buffer = await Packer.toBuffer(doc);
  return new Uint8Array(nodeBuffer);
}

// ---------------------------------------------------------------------------
// HTML → docx internals
// ---------------------------------------------------------------------------

interface TextFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
}

/**
 * Parse TipTap HTML (or markdown-converted HTML) into a flat list of docx
 * top-level children (Paragraphs and Tables). Uses DOMParser in the browser —
 * Lantern's editors are client-only, so this is safe.
 */
function htmlToDocxChildren(html: string): (Paragraph | Table)[] {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html'
  );
  const body = doc.body;
  const out: (Paragraph | Table)[] = [];

  for (const node of Array.from(body.childNodes)) {
    out.push(...blockToChildren(node, {}));
  }

  return out;
}

/**
 * Build a Table from an HTML <table> element. Header cells come from <thead>
 * <th> elements; body rows come from <tbody> <tr> elements. Falls back
 * gracefully if thead/tbody are absent (uses first row as header, rest as body).
 */
function htmlTableToDocxTable(el: HTMLElement): Table {
  // Collect all <tr> elements in document order, regardless of thead/tbody.
  const allRows = Array.from(el.querySelectorAll('tr'));

  if (allRows.length === 0) {
    // Empty table: return a 1×1 table with an empty cell.
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [new Paragraph({ children: [new TextRun('')] })],
            }),
          ],
        }),
      ],
    });
  }

  const buildCell = (tdEl: Element, isHeader: boolean): TableCell => {
    const text = tdEl.textContent ?? '';
    const runOpts = isHeader
      ? { text, bold: true, size: 20 as const }
      : { text };
    const runs: ParagraphChild[] = text ? [new TextRun(runOpts)] : [new TextRun('')];
    if (isHeader) {
      return new TableCell({
        shading: { type: ShadingType.CLEAR, fill: 'EEF1F5', color: 'auto' },
        children: [new Paragraph({ children: runs })],
      });
    }
    return new TableCell({
      children: [new Paragraph({ children: runs })],
    });
  };

  const rows: TableRow[] = allRows.map((trEl, rowIndex) => {
    const isHeaderRow = rowIndex === 0 && trEl.closest('thead') !== null;
    const cellEls = Array.from(trEl.querySelectorAll('th, td'));
    const cells = cellEls.map((td) => buildCell(td, isHeaderRow || td.tagName.toLowerCase() === 'th'));
    return new TableRow({
      tableHeader: isHeaderRow,
      children: cells.length > 0 ? cells : [new TableCell({ children: [new Paragraph({})] })],
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function blockToChildren(node: Node, inheritedFmt: TextFormatting): (Paragraph | Table)[] {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    if (el.tagName.toLowerCase() === 'table') {
      return [htmlTableToDocxTable(el)];
    }
  }
  return blockToParagraphs(node, inheritedFmt);
}

function blockToParagraphs(node: Node, inheritedFmt: TextFormatting): Paragraph[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (!text.trim()) return [];
    return [
      new Paragraph({
        children: [new TextRun({ text, ...textRunProps(inheritedFmt) })],
      }),
    ];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  switch (tag) {
    case 'h1':
      return [paragraphForBlock(el, { ...inheritedFmt }, HeadingLevel.HEADING_1)];
    case 'h2':
      return [paragraphForBlock(el, { ...inheritedFmt }, HeadingLevel.HEADING_2)];
    case 'h3':
      return [paragraphForBlock(el, { ...inheritedFmt }, HeadingLevel.HEADING_3)];
    case 'h4':
      return [paragraphForBlock(el, { ...inheritedFmt }, HeadingLevel.HEADING_4)];
    case 'h5':
      return [paragraphForBlock(el, { ...inheritedFmt }, HeadingLevel.HEADING_5)];
    case 'h6':
      return [paragraphForBlock(el, { ...inheritedFmt }, HeadingLevel.HEADING_6)];
    case 'p':
      return [paragraphForBlock(el, { ...inheritedFmt })];
    case 'blockquote':
      // Word has no first-class blockquote; render as indented italic paragraph.
      return paragraphsFromChildren(el, { ...inheritedFmt, italic: true }).map((p) => p);
    case 'ul':
      return listToParagraphs(el, inheritedFmt, 'bullet', 0);
    case 'ol':
      return listToParagraphs(el, inheritedFmt, 'ordered', 0);
    case 'pre': {
      // Code block: treat entire text content as a single paragraph in a
      // monospaced font. Internal structure is flattened.
      const text = el.textContent ?? '';
      return [
        new Paragraph({
          children: [
            new TextRun({
              text,
              font: 'Courier New',
              ...textRunProps(inheritedFmt),
            }),
          ],
        }),
      ];
    }
    case 'hr':
      return [new Paragraph({})];
    case 'br':
      return [new Paragraph({ children: [new TextRun({ break: 1 })] })];
    default:
      // Inline containers at the top level (unusual but possible from paste):
      // flatten into a paragraph.
      return [paragraphForBlock(el, { ...inheritedFmt })];
  }
}

function paragraphForBlock(
  el: HTMLElement,
  fmt: TextFormatting,
  heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]
): Paragraph {
  const children = inlineChildren(el, fmt);
  const paraOpts: {
    children: ParagraphChild[];
    heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
  } = { children };
  if (heading) {
    paraOpts.heading = heading;
  }
  return new Paragraph(paraOpts);
}

function paragraphsFromChildren(el: HTMLElement, fmt: TextFormatting): Paragraph[] {
  const out: Paragraph[] = [];
  for (const child of Array.from(el.childNodes)) {
    out.push(...blockToParagraphs(child, fmt));
  }
  if (out.length === 0) {
    out.push(new Paragraph({ children: inlineChildren(el, fmt) }));
  }
  return out;
}

function listToParagraphs(
  el: HTMLElement,
  fmt: TextFormatting,
  kind: 'bullet' | 'ordered',
  level: number
): Paragraph[] {
  const out: Paragraph[] = [];

  for (const li of Array.from(el.children)) {
    if (li.tagName.toLowerCase() !== 'li') continue;

    // A list item's direct inline content becomes the bullet paragraph;
    // nested <ul>/<ol> become deeper levels.
    const nested: HTMLElement[] = [];
    const inlineNodes: Node[] = [];
    for (const child of Array.from(li.childNodes)) {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        (child as HTMLElement).tagName &&
        ((child as HTMLElement).tagName.toLowerCase() === 'ul' ||
          (child as HTMLElement).tagName.toLowerCase() === 'ol')
      ) {
        nested.push(child as HTMLElement);
      } else {
        inlineNodes.push(child);
      }
    }

    const runs: ParagraphChild[] = [];
    for (const n of inlineNodes) {
      runs.push(...nodeToInlineChildren(n, fmt));
    }

    const paragraphChildren = runs.length > 0 ? runs : [new TextRun('')];
    const paragraph =
      kind === 'bullet'
        ? new Paragraph({
            children: paragraphChildren,
            bullet: { level },
          })
        : new Paragraph({
            children: paragraphChildren,
            numbering: { reference: 'lantern-ordered', level },
          });
    out.push(paragraph);

    for (const child of nested) {
      const childKind = child.tagName.toLowerCase() === 'ol' ? 'ordered' : 'bullet';
      out.push(...listToParagraphs(child, fmt, childKind, level + 1));
    }
  }

  return out;
}

function inlineChildren(el: HTMLElement, fmt: TextFormatting): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const child of Array.from(el.childNodes)) {
    out.push(...nodeToInlineChildren(child, fmt));
  }
  if (out.length === 0) {
    out.push(new TextRun(''));
  }
  return out;
}

function nodeToInlineChildren(node: Node, fmt: TextFormatting): ParagraphChild[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    if (text.length === 0) return [];
    return [new TextRun({ text, ...textRunProps(fmt) })];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return [];
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === 'br') {
    return [new TextRun({ break: 1 })];
  }

  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    const childFmt = { ...fmt };
    // Don't double-apply link formatting as a mark — ExternalHyperlink
    // handles the styling (blue + underline) via Word's Hyperlink style.
    const linkRuns: TextRun[] = [];
    for (const child of Array.from(el.childNodes)) {
      const children = nodeToInlineChildren(child, childFmt);
      for (const c of children) {
        if (c instanceof TextRun) linkRuns.push(c);
      }
    }
    if (href) {
      return [
        new ExternalHyperlink({
          link: href,
          children: linkRuns.length > 0 ? linkRuns : [new TextRun({ text: href })],
        }),
      ];
    }
    return linkRuns;
  }

  const nextFmt = { ...fmt };
  if (tag === 'strong' || tag === 'b') nextFmt.bold = true;
  else if (tag === 'em' || tag === 'i') nextFmt.italic = true;
  else if (tag === 'u') nextFmt.underline = true;
  else if (tag === 's' || tag === 'strike' || tag === 'del') nextFmt.strike = true;
  else if (tag === 'code') nextFmt.code = true;

  const out: ParagraphChild[] = [];
  for (const child of Array.from(el.childNodes)) {
    out.push(...nodeToInlineChildren(child, nextFmt));
  }
  return out;
}

interface TextRunProps {
  bold?: boolean;
  italics?: boolean;
  underline?: Record<string, never>;
  strike?: boolean;
  font?: string;
}

function textRunProps(fmt: TextFormatting): TextRunProps {
  const props: TextRunProps = {};
  if (fmt.bold) props.bold = true;
  if (fmt.italic) props.italics = true;
  if (fmt.underline) props.underline = {};
  if (fmt.strike) props.strike = true;
  if (fmt.code) props.font = 'Courier New';
  return props;
}

/**
 * Create a blank `.docx` with a single empty paragraph.  Used by the
 * "New Word document" entry in the file-tree create menu.
 *
 * Implementation note: we build a minimal OOXML package by hand (via JSZip)
 * rather than going through the `docx` JS library.  The `docx` library's
 * Packer emits a body-level <w:sectPr> (section-properties element) inside
 * <w:body>.  The in-house Rust engine captures every non-<w:p> block in the
 * body as a BlockContent::Raw, which the DocxEditor renders as a read-only
 * "[preserved content]" placeholder.  For a brand-new blank document the user
 * must see an editable surface immediately, so the body must contain only a
 * single <w:p/> and nothing else.  When the Rust engine saves the document for
 * the first time it appends its own minimal <w:sectPr/> — but by that point the
 * user has already placed their cursor and started typing.
 */
export async function createBlankDocx(): Promise<Uint8Array> {
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

  // Minimal word/document.xml: one empty paragraph (non-self-closing so the
  // Rust parser sees Event::Start, not Event::Empty), no body-level sectPr.
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W_NS}">` +
    `<w:body><w:p><w:r><w:t></w:t></w:r></w:p></w:body>` +
    `</w:document>`;

  // Minimal package plumbing.
  const contentTypesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const rootRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${REL_NS}">` +
    `<Relationship Id="rId1" Type="${DOC_REL}" Target="word/document.xml"/>` +
    `</Relationships>`;

  const wordRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="${REL_NS}"/>`;

  // DETERMINISTIC: pass a fixed date to every zip.file() call so JSZip does not
  // embed the current wall-clock time in the local-file-header timestamps.
  // Without this the output bytes differ on every call, making the fixture test
  // non-deterministic and the sha256 stability check impossible.
  const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml, { date: FIXED_DATE });
  zip.file('_rels/.rels', rootRelsXml, { date: FIXED_DATE });
  zip.file('word/document.xml', documentXml, { date: FIXED_DATE });
  zip.file('word/_rels/document.xml.rels', wordRelsXml, { date: FIXED_DATE });

  // Use STORE (no compression) so the output bytes are identical across all
  // JavaScript environments (Node, jsdom, browser). DEFLATE output can differ
  // between pako (jsdom/browser) and Node's native zlib even for the same
  // input, making the byte-stable fixture test impossible to satisfy.
  // A minimal blank docx is tiny; the size difference is negligible.
  const blob = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  return blob;
}

// ---------------------------------------------------------------------------
// Markdown to .docx conversion (used by workflow export)
// ---------------------------------------------------------------------------
//
// Tiny zero-dependency markdown parser. Not a full CommonMark implementation
// just the subset of features the founder workflow templates actually
// produce: `#` headings (levels 1-6), paragraphs separated by blank lines,
// unordered (`-` / `*`) and ordered (`1.`) lists, inline `**bold**`,
// `*italic*`, `` `code` ``, and `[text](url)` links. Horizontal rules
// (`---`) and line breaks are recognized.
//
// We convert markdown to HTML, then hand off to the existing HTML to docx
// pipeline (`serializeDocx`) so the feature shares the same limitations
// banner messaging and testing coverage.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render a single line's inline markdown (bold / italic / code / link) into
 * HTML. Order matters: code spans must be handled first so that
 * `` `foo_bar_baz` `` doesn't get italic tags inside.
 */
function renderInline(line: string): string {
  const codeSpans: string[] = [];
  let working = line.replace(/`([^`]+)`/g, (_m, code: string) => {
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  working = escapeHtml(working);

  // Links: [text](url).
  //
  // R-14 — this was the FOURTH markdown→HTML renderer with its own link
  // handling, and nobody had it on the list. It escaped the quote (which
  // MarkdownPreview did not) and never checked the scheme (which pdf-export
  // did). Four hand-rolled sanitizers, four different subsets of the same
  // three rules. All four now call the one module.
  working = working.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, text: string, href: string) => `<a href="${safeUrlAttribute(href, 'link')}">${text}</a>`
  );

  working = working.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  working = working.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  working = working.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  working = working.replace(/(^|\W)_([^_\n]+)_(\W|$)/g, '$1<em>$2</em>$3');

  working = working.replace(/\u0000CODE(\d+)\u0000/g, (_m, idx: string) => {
    const i = Number.parseInt(idx, 10);
    return codeSpans[i] ?? '';
  });

  return working;
}

/**
 * Return true if the line looks like a GFM pipe-table row or separator.
 * Accepts both `| a | b |` (outer pipes) and `a | b` (no outer pipes).
 */
function isPipeTableLine(line: string): boolean {
  const t = line.trim();
  // Separator row: cells are only dashes, colons, and spaces.
  if (/^[|\s:*-][|\s:*-]+$/.test(t) && t.includes('|') && /[-]/.test(t)) return true;
  // Data row: contains at least one pipe character.
  return t.includes('|');
}

/**
 * Split a pipe-table row into cell strings. Handles both outer-pipe and
 * no-outer-pipe styles. Strips leading/trailing whitespace from each cell.
 */
function splitTableRow(line: string): string[] {
  const t = line.trim();
  // Strip optional leading and trailing pipes then split on `|`.
  const stripped = t.startsWith('|') ? t.slice(1) : t;
  const finalStripped = stripped.endsWith('|') ? stripped.slice(0, -1) : stripped;
  return finalStripped.split('|').map((c) => c.trim());
}

/**
 * Given a block of adjacent pipe-table lines (header row, separator row, body
 * rows), produce a `<table>` HTML string with `<thead>` and `<tbody>`.
 * Ragged rows are padded with empty cells or truncated to the column count
 * established by the header row.
 */
function tableLinesToHtml(tableLines: string[]): string {
  if (tableLines.length < 2) return '';

  const headerCells = splitTableRow(tableLines[0]!);
  const colCount = headerCells.length;

  // Find the separator row (all dashes/colons/pipes). Skip it for body rows.
  let separatorIndex = -1;
  for (let i = 1; i < tableLines.length; i++) {
    const t = tableLines[i]!.trim();
    // A separator row contains only |, -, :, and whitespace.
    if (/^[|\s:-]+$/.test(t) && t.includes('-')) {
      separatorIndex = i;
      break;
    }
  }

  const bodyLines =
    separatorIndex >= 0
      ? tableLines.slice(separatorIndex + 1)
      : tableLines.slice(1);

  /** Pad/truncate a cell array to exactly colCount entries. */
  const normalizeRow = (cells: string[]): string[] => {
    const out = cells.slice(0, colCount);
    while (out.length < colCount) out.push('');
    return out;
  };

  const thHtml = normalizeRow(headerCells)
    .map((c) => `<th>${renderInline(c)}</th>`)
    .join('');

  const tbodyHtml = bodyLines
    .map((line) => {
      const cells = normalizeRow(splitTableRow(line));
      const tdHtml = cells.map((c) => `<td>${renderInline(c)}</td>`).join('');
      return `<tr>${tdHtml}</tr>`;
    })
    .join('');

  return `<table><thead><tr>${thHtml}</tr></thead><tbody>${tbodyHtml}</tbody></table>`;
}

/**
 * Convert a markdown string into HTML suitable for feeding to `serializeDocx`.
 *
 * Block-level constructs handled:
 *  - `#` through `######` to `<h1>` through `<h6>`
 *  - blank-line-separated paragraph blocks to `<p>`
 *  - `- `, `* `, `+ ` prefixed lines to `<ul><li>`
 *  - `N. ` prefixed lines to `<ol><li>`
 *  - `---`, `***`, `___` on their own line to `<hr>`
 *  - GFM pipe tables (`| col | col |` / `|---|---|`) to `<table>`
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  type ListState = { kind: 'ul' | 'ol' } | null;
  let list: ListState = null;
  let paraBuffer: string[] = [];
  let tableBuffer: string[] = [];

  const closeList = () => {
    if (list) {
      out.push(list.kind === 'ul' ? '</ul>' : '</ol>');
      list = null;
    }
  };

  const flushParagraph = () => {
    if (paraBuffer.length > 0) {
      const content = paraBuffer.map((l) => renderInline(l)).join(' ');
      out.push(`<p>${content}</p>`);
      paraBuffer = [];
    }
  };

  const flushTable = () => {
    if (tableBuffer.length > 0) {
      const html = tableLinesToHtml(tableBuffer);
      if (html) out.push(html);
      tableBuffer = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // ── GFM pipe-table accumulation ────────────────────────────────────────
    if (isPipeTableLine(line)) {
      flushParagraph();
      closeList();
      tableBuffer.push(line);
      continue;
    }

    // Non-table line: flush any accumulated table rows first.
    if (tableBuffer.length > 0) {
      flushTable();
    }

    if (line.trim() === '') {
      flushParagraph();
      closeList();
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      closeList();
      out.push('<hr />');
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = headingMatch[1]!.length;
      const text = renderInline(headingMatch[2]!.trim());
      out.push(`<h${level}>${text}</h${level}>`);
      continue;
    }

    const ulMatch = /^(\s*)[-*+]\s+(.+)$/.exec(line);
    if (ulMatch) {
      flushParagraph();
      const text = renderInline(ulMatch[2]!);
      if (!list || list.kind !== 'ul') {
        closeList();
        out.push('<ul>');
        list = { kind: 'ul' };
      }
      out.push(`<li>${text}</li>`);
      continue;
    }

    const olMatch = /^(\s*)\d+\.\s+(.+)$/.exec(line);
    if (olMatch) {
      flushParagraph();
      const text = renderInline(olMatch[2]!);
      if (!list || list.kind !== 'ol') {
        closeList();
        out.push('<ol>');
        list = { kind: 'ol' };
      }
      out.push(`<li>${text}</li>`);
      continue;
    }

    closeList();
    paraBuffer.push(line);
  }

  flushParagraph();
  flushTable();
  closeList();

  return out.join('\n');
}

/**
 * One-step convenience: markdown string in, `.docx` bytes out. Used by the
 * "Save as Word" export from the markdown editor / workflow results.
 *
 * Pass `options.firmName` to prepend a branded letterhead header.
 */
export async function markdownToDocxBytes(
  markdown: string,
  fileName: string,
  options: DocxExportOptions = {}
): Promise<Uint8Array> {
  const html = markdownToHtml(markdown);
  return serializeDocx(html, fileName, options);
}

/** The WordprocessingML main namespace, bound as `w:` at the document root. */
const WORD_MAIN_NS =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// Pure-JS table detection/normalization utilities live in docx-table-utils.ts
// (no mammoth/docx-preview/JSZip/docx dependency) so callers that only need
// table detection — docx-commands.ts, reached from the always-on editor —
// don't drag the heavy DOCX engine into their bundle chunk. Re-exported here
// so existing `docx-io` imports keep working unchanged.
export {
  containsMarkdownTable,
  isStandaloneMarkdownTable,
  containsPipeTableLikeBlock,
  normalizeStandalonePipeTable,
  type RedlineBlock,
} from './docx-table-utils';
import type { RedlineBlock } from './docx-table-utils';

/**
 * Convert an arbitrary Markdown fragment into an ORDERED list of {@link
 * RedlineBlock}s, reusing the proven `markdownToDocxBytes` converter. This is how
 * the AI redliner turns a Markdown pipe table (optionally with surrounding text)
 * into a REAL Word table instead of leaking literal pipe text into a paragraph.
 *
 * Implementation: render the fragment to a throwaway `.docx`, unzip
 * `word/document.xml`, and walk the DIRECT children of `<w:body>` in order. A
 * `<w:tbl>` becomes a `table` block (raw XML, embedded under the engine's
 * `<w:document xmlns:w="…">` wrapper — any redundant root `xmlns:w` the serializer
 * adds is stripped). A `<w:p>` becomes a `paragraph` block carrying its plain
 * text. The trailing `<w:sectPr>` and paragraphs NESTED inside table cells are
 * naturally excluded (we only look at `<w:body>`'s direct children). Empty
 * paragraphs are dropped so blank lines don't create stray blocks.
 *
 * @throws if the fragment can't be rendered/parsed — callers MUST treat a throw
 *   as "reject this edit" and insert nothing (never fall back to literal text).
 */
export async function markdownToRedlineBlocks(markdown: string): Promise<RedlineBlock[]> {
  const bytes = await markdownToDocxBytes(markdown, 'redline-block.docx');
  // The bytes were produced two lines up by our own packer, so this is not an
  // untrusted archive. It still goes through the guarded reader: a reader that
  // is exempt "because the input is ours" is one refactor away from being fed
  // someone else's bytes, and the guard costs nothing here.
  const zip = await readGuardedZip(bytes, 'generated redline .docx');
  const documentXml = await zip.text('word/document.xml');
  if (documentXml === null) throw new Error('generated .docx is missing word/document.xml');

  const dom = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (dom.getElementsByTagName('parsererror').length > 0) {
    throw new Error('failed to parse generated word/document.xml');
  }
  const body = dom.getElementsByTagName('w:body').item(0);
  if (!body) throw new Error('generated .docx has no <w:body>');

  const serializer = new XMLSerializer();
  const out: RedlineBlock[] = [];
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== 1 /* ELEMENT_NODE */) continue;
    const el = child as Element;
    if (el.nodeName === 'w:tbl') {
      out.push({ kind: 'table', xml: stripRedundantWordNs(serializer.serializeToString(el)) });
    } else if (el.nodeName === 'w:p') {
      const text = (el.textContent ?? '').trim();
      if (text.length > 0) out.push({ kind: 'paragraph', text });
    }
  }
  return out;
}

/**
 * Remove a redundant root-level `xmlns:w="…"` declaration that `XMLSerializer`
 * adds when serializing a `w:`-prefixed element in isolation. The engine's
 * document wrapper already binds `w:`, so a duplicate (identical-URI) decl is
 * valid but noisy — strip just the first occurrence (the block's root tag).
 */
function stripRedundantWordNs(xml: string): string {
  return xml.replace(` xmlns:w="${WORD_MAIN_NS}"`, '');
}

// ---------------------------------------------------------------------------
// WS-D — Structured litigation deliverable: contradictions table → .docx
// ---------------------------------------------------------------------------
//
// The Deposition Contradiction Finder (and, by the same pattern, the other
// litigation templates) produces STRUCTURED findings rather than free-form
// markdown. We render those into a real Word document — a verification banner,
// a short summary, then a findings table — so the lawyer reviews a familiar
// deliverable in the Word editor. The framing is deliberate: a tireless
// first-year associate that FLAGS findings for the lawyer to verify, with a
// citation on every finding. Unverified findings are visually flagged.

const FLAG_VERIFIED = '✓ Verified vs. source';
const FLAG_UNVERIFIED = '⚠ UNVERIFIED. Check original';

/** A small bold run for table header cells. */
function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.CLEAR, fill: 'EEF1F5', color: 'auto' },
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold: true, size: 20 })],
      }),
    ],
  });
}

/** Render one finding's "statement" side (quote + locator + per-source flag). */
function statementCellParagraphs(
  label: string,
  quote: string,
  locator: string,
  verdict: string | undefined,
): Paragraph[] {
  const verdictOk = verdict === 'verified';
  return [
    new Paragraph({
      children: [new TextRun({ text: label, bold: true, size: 18, color: '555555' })],
    }),
    new Paragraph({
      children: [new TextRun({ text: `“${quote}”`, italics: true, size: 20 })],
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Source: ${locator}`, size: 18, color: '555555' }),
      ],
      spacing: { before: 40 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: verdictOk ? FLAG_VERIFIED : `${FLAG_UNVERIFIED} (${verdict ?? 'unverified'})`,
          size: 16,
          bold: !verdictOk,
          color: verdictOk ? '2E7D32' : 'B23B00',
        }),
      ],
      spacing: { before: 40 },
    }),
  ];
}

/** Build a single finding's table row. */
function findingRow(finding: ContradictionFinding, index: number): TableRow {
  const followUps = finding.followUpQuestions ?? [];
  const detailParagraphs: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: 'Why they conflict', bold: true, size: 18, color: '555555' })],
    }),
    new Paragraph({ children: [new TextRun({ text: finding.conflictRationale, size: 20 })] }),
  ];
  if (followUps.length > 0) {
    detailParagraphs.push(
      new Paragraph({
        children: [new TextRun({ text: 'Suggested follow-up questions', bold: true, size: 18, color: '555555' })],
        spacing: { before: 80 },
      }),
    );
    for (const q of followUps) {
      detailParagraphs.push(new Paragraph({ text: q, bullet: { level: 0 } }));
    }
  }

  return new TableRow({
    children: [
      new TableCell({
        width: { size: 6, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: String(index + 1), bold: true })] })],
      }),
      new TableCell({
        width: { size: 18, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: finding.topic, size: 20 })] })],
      }),
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: statementCellParagraphs(
          'Statement A',
          finding.statementA.quote,
          finding.statementA.locator,
          finding.statementA.verdict,
        ),
      }),
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: statementCellParagraphs(
          'Statement B (conflicting)',
          finding.statementB.quote,
          finding.statementB.locator,
          finding.statementB.verdict,
        ),
      }),
      new TableCell({
        width: { size: 16, type: WidthType.PERCENTAGE },
        children: detailParagraphs,
      }),
    ],
  });
}

/**
 * Render a structured contradictions analysis into `.docx` bytes.
 *
 * Layout: a non-dismissable verification banner, a title + matter header, a
 * one-line summary of how many findings verified, then a findings table. The
 * banner and the per-finding flags make the "verify before relying" framing
 * explicit in the output itself (not just the UI).
 *
 * Pass `options.firmName` to prepend the same branded letterhead the rest of
 * the export path uses.
 */
export async function serializeContradictionsDocx(
  result: ContradictionAnalysisResult,
  meta: {
    title: string;
    matterName?: string;
    witnessName?: string;
    depositionDate?: string;
    verificationBanner: string;
    /** VG-3b — honest disclosure of what grounded the analysis (rendered
     *  right under the verification banner when retrieval was unavailable
     *  or returned nothing). */
    retrievalNote?: string;
  },
  options: DocxExportOptions = {},
): Promise<Uint8Array> {
  const brandingHeader = buildBrandingHeader(options.firmName ?? '');
  const preparedDate = new Date().toLocaleDateString();

  const headerLines: Paragraph[] = [
    // Verification banner — bold, boxed, always present.
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: 'FFF4E5', color: 'auto' },
      border: {
        top: { color: 'B23B00', space: 6, style: BorderStyle.SINGLE, size: 6 },
        bottom: { color: 'B23B00', space: 6, style: BorderStyle.SINGLE, size: 6 },
        left: { color: 'B23B00', space: 6, style: BorderStyle.SINGLE, size: 6 },
        right: { color: 'B23B00', space: 6, style: BorderStyle.SINGLE, size: 6 },
      },
      spacing: { after: 200 },
      children: [
        new TextRun({ text: 'DRAFT. VERIFY BEFORE RELYING. ', bold: true, size: 20, color: 'B23B00' }),
        new TextRun({ text: meta.verificationBanner, size: 20, color: '7A2A00' }),
      ],
    }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: meta.title })] }),
  ];

  // VG-3b — the retrieval disclosure sits directly under the verification
  // banner so the reader knows what grounded the analysis before anything else.
  if (meta.retrievalNote) {
    headerLines.splice(1, 0,
      new Paragraph({
        spacing: { after: 160 },
        children: [new TextRun({ text: meta.retrievalNote, bold: true, size: 22, color: 'B23B00' })],
      }),
    );
  }

  if (meta.matterName) {
    headerLines.push(
      new Paragraph({ children: [new TextRun({ text: `Client file: ${meta.matterName}`, bold: true, size: 22 })] }),
    );
  }
  if (meta.witnessName) {
    headerLines.push(
      new Paragraph({ children: [new TextRun({ text: `Witness: ${meta.witnessName}`, size: 22 })] }),
    );
  }
  if (meta.depositionDate) {
    headerLines.push(
      new Paragraph({ children: [new TextRun({ text: `Deposition date: ${meta.depositionDate}`, size: 22 })] }),
    );
  }
  headerLines.push(
    new Paragraph({
      children: [new TextRun({ text: `Prepared for attorney review: ${preparedDate}`, size: 22 })],
      spacing: { after: 160 },
    }),
  );

  // Summary line.
  headerLines.push(
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Summary' })] }),
  );
  headerLines.push(
    new Paragraph({
      children: [
        new TextRun({
          text:
            `Flagged ${String(result.totalCount)} candidate ` +
            `${result.totalCount === 1 ? 'contradiction' : 'contradictions'} for your review. ` +
            `${String(result.verifiedCount)} verified against the client record; ` +
            `${String(result.unverifiedCount)} could not be auto-verified and ${result.unverifiedCount === 1 ? 'is' : 'are'} flagged below. ` +
            `Every finding is a starting point. Confirm each quote and citation against the original source before relying on it.`,
          size: 22,
        }),
      ],
      spacing: { after: 160 },
    }),
  );

  const bodyChildren: (Paragraph | Table)[] = [...headerLines];

  if (result.findings.length === 0) {
    bodyChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: 'No candidate contradictions were identified in the retrieved record. This is not a finding of consistency. Re-run with more targeted claims or a wider document set if you expected conflicts.',
            size: 22,
          }),
        ],
      }),
    );
  } else {
    bodyChildren.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Flagged contradictions' })] }),
    );
    const headerRow = new TableRow({
      tableHeader: true,
      children: [
        headerCell('#'),
        headerCell('Topic'),
        headerCell('Statement A'),
        headerCell('Statement B (conflicting)'),
        headerCell('Why / follow-up'),
      ],
    });
    const rows = result.findings.map((f, i) => findingRow(f, i));
    bodyChildren.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [headerRow, ...rows],
      }),
    );
  }

  // Closing reminder.
  bodyChildren.push(
    new Paragraph({
      spacing: { before: 240 },
      children: [
        new TextRun({
          text: 'This analysis was prepared by an AI assistant to organize the record. Verify all page/line references and quotations against the original transcript and documents. Do not use this document in any filing without independent verification.',
          italics: true,
          size: 18,
          color: '555555',
        }),
      ],
    }),
  );

  const sectionOptions: ISectionOptions = {
    properties: {},
    children: [...brandingHeader, ...bodyChildren],
  };

  const doc = new Document({
    creator: BRAND.name,
    description: `Litigation contradiction analysis prepared in ${BRAND.name} (draft. verify before relying)`,
    sections: [sectionOptions],
  });

  if (typeof Blob !== 'undefined') {
    const blob = await Packer.toBlob(doc);
    return new Uint8Array(await blob.arrayBuffer());
  }
  const nodeBuffer: Buffer = await Packer.toBuffer(doc);
  return new Uint8Array(nodeBuffer);
}

/**
 * Bundle docx bytes back into a data URL for the editor tab's `content`.
 */
export function docxBytesToDataUrl(bytes: Uint8Array): string {
  const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

// ---------------------------------------------------------------------------
// VG-4c — firm letterhead
// ---------------------------------------------------------------------------

/** Encode bytes to base64 in chunks (avoids the call-stack limit `btoa` hits
 *  when spread over a large byte array). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/** Decode a base64 string back to bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * VG-4c — the single choke point that puts a workflow deliverable (or any
 * generated `.docx`) onto the firm letterhead, if one is configured.
 *
 * Behavior, in order, and ALWAYS opt-in / fail-open:
 *   - Not in the desktop app (no native engine) -> return `bytes` unchanged.
 *   - No `letterheadTemplatePath` set -> return `bytes` unchanged (the feature
 *     is off until the user picks a template).
 *   - Template unreadable, or the merge command errors -> `console.warn` and
 *     return `bytes` unchanged. A deliverable must never fail because of the
 *     letterhead.
 *
 * Only when a template is set, readable, and the merge succeeds does this
 * return the letterheaded bytes. New blank documents do NOT go through here —
 * they are a straight byte copy of the template (see `handleCreateDocxAtRoot`),
 * which is trivially correct.
 */
export async function applyLetterheadIfConfigured(bytes: Uint8Array): Promise<Uint8Array> {
  // Lazy imports so this module stays usable in the browser/test bundle.
  const { isTauri } = await import('@tauri-apps/api/core');
  if (!isTauri()) return bytes;

  const { useSettingsStore } = await import('@/platform/settings/settingsStore');
  const templatePath = useSettingsStore
    .getState()
    .getSetting<string>('letterheadTemplatePath');
  if (!templatePath || !templatePath.trim()) return bytes;

  try {
    // Resolve a workspace-relative template path to absolute (mirrors the
    // docx command wrappers), then read its bytes via the guarded Tauri fs wrapper.
    const { useWorkspaceStore } = await import('@/platform/fs/workspaceStore');
    const { resolveWorkspacePath } = await import('@/platform/fs/pathResolve');
    const rootPath = useWorkspaceStore.getState().rootPath;
    const absoluteTemplatePath = rootPath
      ? resolveWorkspacePath(rootPath, templatePath)
      : templatePath;

    const templateBytes = await readTauriFile(absoluteTemplatePath);

    const { docxApplyLetterhead } = await import('@/platform/utils/docx-commands');
    const mergedB64 = await docxApplyLetterhead(
      bytesToBase64(bytes),
      bytesToBase64(templateBytes),
    );
    return base64ToBytes(mergedB64);
  } catch (err) {
    console.warn(
      'Could not apply the letterhead template; writing the document without it.',
      err,
    );
    return bytes;
  }
}

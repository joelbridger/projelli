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
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  TextRun,
  type ISectionOptions,
  type ParagraphChild,
} from 'docx';

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

/** Normalize the input into an `ArrayBuffer` that the renderer can consume. */
export async function parseDocxForPreview(source: DocxSource): Promise<ArrayBuffer> {
  if (typeof source === 'string') {
    return dataUrlToArrayBuffer(source);
  }
  return source;
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
          text: `Document prepared with Keepance — ${dateString}`,
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
    creator: 'Keepance',
    description: 'Document edited in Keepance',
    numbering: {
      config: [
        {
          reference: 'keepance-ordered',
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
 * Parse TipTap HTML into a flat list of docx top-level children
 * (Paragraphs). Uses DOMParser in the browser — Keepance's editors are
 * client-only, so this is safe.
 */
function htmlToDocxChildren(html: string): Paragraph[] {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html'
  );
  const body = doc.body;
  const out: Paragraph[] = [];

  for (const node of Array.from(body.childNodes)) {
    out.push(...blockToParagraphs(node, {}));
  }

  return out;
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
            numbering: { reference: 'keepance-ordered', level },
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
 * Create a blank `.docx` with a single empty paragraph. Used by the
 * "New Word document" entry in the file-tree create menu.
 */
export async function createBlankDocx(): Promise<Uint8Array> {
  return serializeDocx('<p></p>', 'blank.docx');
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

  // Links: [text](url). URL kept raw inside href after quote escaping.
  working = working.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, text: string, href: string) => {
      const safeHref = href.replace(/"/g, '&quot;');
      return `<a href="${safeHref}">${text}</a>`;
    }
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
 * Convert a markdown string into HTML suitable for feeding to `serializeDocx`.
 *
 * Block-level constructs handled:
 *  - `#` through `######` to `<h1>` through `<h6>`
 *  - blank-line-separated paragraph blocks to `<p>`
 *  - `- `, `* `, `+ ` prefixed lines to `<ul><li>`
 *  - `N. ` prefixed lines to `<ol><li>`
 *  - `---`, `***`, `___` on their own line to `<hr>`
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  type ListState = { kind: 'ul' | 'ol' } | null;
  let list: ListState = null;
  let paraBuffer: string[] = [];

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

  for (const raw of lines) {
    const line = raw.trimEnd();

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

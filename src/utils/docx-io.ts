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
 * Serialize TipTap-produced HTML into a `.docx` byte stream.
 * `fileName` is currently unused but kept in the signature so future metadata
 * (e.g. document title) can be wired without changing callers.
 */
export async function serializeDocx(
  tiptapHtml: string,
  _fileName: string
): Promise<Uint8Array> {
  const sectionChildren = htmlToDocxChildren(tiptapHtml);

  const sectionOptions: ISectionOptions = {
    properties: {},
    children: sectionChildren.length > 0 ? sectionChildren : [new Paragraph({})],
  };

  const doc = new Document({
    creator: 'Projelli',
    description: 'Document edited in Projelli',
    numbering: {
      config: [
        {
          reference: 'projelli-ordered',
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

  const blob = await Packer.toBlob(doc);
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
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
 * (Paragraphs). Uses DOMParser in the browser — Projelli's editors are
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
            numbering: { reference: 'projelli-ordered', level },
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

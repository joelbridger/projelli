// PPTX IO Utilities
//
// Helpers for creating `.pptx` files and extracting text from existing ones.
//
// PowerPoint preview inside Lantern is handled via LibreOffice → PDF
// conversion (see `src-tauri/src/commands/fs.rs::convert_ppt_to_pdf` and
// `PresentationViewer`). This file only covers the JS-side concerns:
//
//   - Creating blank `.pptx` files from the file-tree "New File" menu.
//   - Exporting markdown → `.pptx` from the workflow export dropdown.
//   - Extracting slide text from `.pptx` bytes for AI ambient context.
//
// Libraries:
//   - `pptxgenjs` (MIT) builds `.pptx` packages. Used for blank + markdown
//     conversion.
//   - `jszip` (MIT / GPLv3 dual) unpacks `.pptx` (which is a ZIP of XML
//     parts) for text extraction. We pick MIT.

import PptxGenJS from 'pptxgenjs';
import { readGuardedZip } from '@/platform/archive/safeZip';

import { dataUrlToArrayBuffer } from './spreadsheet-io';
import { markdownToHtml } from './docx-io';
import { BRAND } from '@/config/brand';

/** Brand navy as a PptxGenJS colour (hex digits, no leading #). Config-driven. */
const PPTX_NAVY = BRAND.colors.navy.replace(/^#/, '').toUpperCase();

/** Either a data URL (typical when read via FSBackend) or raw bytes. */
type PptxSource = string | ArrayBuffer;

/**
 * Create a blank `.pptx` with a single title+subtitle slide. Used by the
 * "New PowerPoint" entry in the file-tree create menu.
 *
 * We use the built-in TITLE layout so the deck opens in PowerPoint with a
 * proper title placeholder (matching how a user would create a new deck from
 * the default template).
 */
export async function createBlankPptx(): Promise<Uint8Array> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  const slide = pres.addSlide();
  slide.addText('Untitled', {
    x: 0.5,
    y: 0.5,
    w: 8.0,
    h: 1.2,
    fontSize: 44,
    bold: true,
    align: 'center',
  });
  slide.addText('Click to add subtitle', {
    x: 0.5,
    y: 2.0,
    w: 8.0,
    h: 0.8,
    fontSize: 24,
    color: '666666',
    align: 'center',
  });

  // `outputType: 'uint8array'` returns a Uint8Array we can feed straight into
  // the workspace's writeFileBinary path. The library's types are very loose
  // here — cast explicitly after the await.
  const out = (await pres.write({ outputType: 'uint8array' })) as unknown;
  if (out instanceof Uint8Array) {
    return out;
  }
  if (out instanceof ArrayBuffer) {
    return new Uint8Array(out);
  }
  throw new Error('Unexpected PptxGenJS output — expected Uint8Array/ArrayBuffer.');
}

/**
 * Convert a markdown string into a `.pptx` byte stream.
 *
 * Each top-level `#` heading becomes a new slide with the heading as title.
 * Paragraphs, bulleted list items, and ordered list items that follow become
 * body content on the current slide. `---` horizontal rules also force a
 * slide break.
 *
 * Anything more complex (images, tables, code blocks) is intentionally
 * skipped — the point is to get workflow-generated markdown like an Investor
 * Update into a shareable slide deck in one click, not to faithfully render
 * every markdown construct PowerPoint can't represent cleanly.
 */
export async function markdownToPptxBytes(markdown: string): Promise<Uint8Array> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';

  const html = markdownToHtml(markdown);
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html'
  );

  interface SlideSpec {
    title: string;
    bullets: string[];
    paragraphs: string[];
  }

  const slides: SlideSpec[] = [];
  let current: SlideSpec | null = null;

  const ensureSlide = (title: string): SlideSpec => {
    const next: SlideSpec = { title, bullets: [], paragraphs: [] };
    slides.push(next);
    current = next;
    return next;
  };

  // Collect plain text from a node, preserving nothing but whitespace
  // collapsed. Good enough for slide content — PowerPoint's own text runs
  // don't carry rich formatting from our inline markdown anyway.
  const textOf = (node: Node): string =>
    (node.textContent ?? '').replace(/\s+/g, ' ').trim();

  for (const node of Array.from(doc.body.childNodes)) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'h1' || tag === 'h2') {
      ensureSlide(textOf(el));
      continue;
    }

    // Sub-headings inside a slide: treat as bolded paragraphs so they're
    // visibly distinct but don't split the slide.
    if (tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      if (!current) ensureSlide('');
      current!.paragraphs.push(textOf(el));
      continue;
    }

    if (tag === 'hr') {
      // Force a new slide even if the next block isn't a heading.
      ensureSlide('');
      continue;
    }

    if (tag === 'ul' || tag === 'ol') {
      if (!current) ensureSlide('');
      for (const li of Array.from(el.children)) {
        if (li.tagName.toLowerCase() !== 'li') continue;
        const txt = textOf(li);
        if (txt.length > 0) current!.bullets.push(txt);
      }
      continue;
    }

    if (tag === 'p') {
      if (!current) ensureSlide('');
      const txt = textOf(el);
      if (txt.length > 0) current!.paragraphs.push(txt);
      continue;
    }

    // Anything else: flatten text into the current slide body.
    if (!current) ensureSlide('');
    const txt = textOf(el);
    if (txt.length > 0) current!.paragraphs.push(txt);
  }

  // If the document had no headings at all, fall back to one slide with the
  // whole thing as body text. This mirrors what the `.docx` export does for
  // untitled content.
  if (slides.length === 0) {
    slides.push({ title: 'Untitled', bullets: [], paragraphs: [markdown.trim()] });
  }

  for (const spec of slides) {
    const slide = pres.addSlide();
    if (spec.title) {
      slide.addText(spec.title, {
        x: 0.5,
        y: 0.3,
        w: 12.0,
        h: 1.0,
        fontSize: 36,
        bold: true,
      });
    }

    // Body text: paragraphs first, then bullets.
    const bodyY = spec.title ? 1.4 : 0.5;
    if (spec.paragraphs.length > 0) {
      slide.addText(spec.paragraphs.join('\n'), {
        x: 0.5,
        y: bodyY,
        w: 12.0,
        h: 5.0,
        fontSize: 18,
        valign: 'top',
      });
    }
    if (spec.bullets.length > 0) {
      const bulletY = bodyY + (spec.paragraphs.length > 0 ? 1.5 : 0);
      slide.addText(
        spec.bullets.map((b) => ({ text: b, options: { bullet: true } })),
        {
          x: 0.5,
          y: bulletY,
          w: 12.0,
          h: 5.0,
          fontSize: 18,
          valign: 'top',
        }
      );
    }
  }

  const out = (await pres.write({ outputType: 'uint8array' })) as unknown;
  if (out instanceof Uint8Array) {
    return out;
  }
  if (out instanceof ArrayBuffer) {
    return new Uint8Array(out);
  }
  throw new Error('Unexpected PptxGenJS output — expected Uint8Array/ArrayBuffer.');
}

/**
 * Extract plain text from a `.pptx` file for AI ambient context.
 *
 * `.pptx` is a ZIP of XML parts. Each slide lives at
 * `ppt/slides/slide<N>.xml`. Text runs are inside `<a:t>...</a:t>` elements
 * (DrawingML). We pull them out with DOMParser, paired with `=== Slide N ===`
 * markers so the AI sees clear slide boundaries.
 *
 * Failure modes (malformed XML, missing slide parts, etc.) are caught per
 * slide and logged; a single bad slide doesn't take the whole extraction
 * down.
 */
export async function extractPptxText(source: PptxSource): Promise<string> {
  const buffer = typeof source === 'string' ? dataUrlToArrayBuffer(source) : source;
  // R-17 — a .pptx is an untrusted zip from the user's workspace. The guarded
  // reader meters ACTUAL decompressed bytes per entry and across the deck,
  // matching the native reader in src-tauri/src/commands/rag/office.rs.
  const zip = await readGuardedZip(buffer, 'presentation .pptx');

  // Collect slide names and sort so the output matches the deck's order.
  // ZIP file order isn't guaranteed to match slide order, and PowerPoint
  // uses `slide1.xml`, `slide2.xml`, ..., so a numeric sort on the stem is
  // sufficient and portable.
  const slideNames = zip
    .names()
    .filter((relativePath) => /^ppt\/slides\/slide\d+\.xml$/.test(relativePath));
  slideNames.sort((a, b) => {
    const na = Number.parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
    const nb = Number.parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
    return na - nb;
  });

  const chunks: string[] = [];
  let slideNumber = 0;

  for (const name of slideNames) {
    slideNumber += 1;
    try {
      const xml = await zip.text(name);
      if (xml === null) continue;
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      // DrawingML's `<a:t>` elements contain the runs of visible text. Use
      // a namespaced lookup so we don't match unrelated `<t>` elements that
      // other OOXML namespaces might define.
      const runs = doc.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/drawingml/2006/main',
        't'
      );
      const parts: string[] = [];
      for (let i = 0; i < runs.length; i++) {
        const txt = runs[i]?.textContent;
        if (txt && txt.length > 0) parts.push(txt);
      }
      if (parts.length > 0) {
        chunks.push(`=== Slide ${slideNumber} ===\n${parts.join('\n')}`);
      } else {
        chunks.push(`=== Slide ${slideNumber} ===`);
      }
    } catch (err) {
      console.warn(`[pptx-io] Failed to extract text from ${name}:`, err);
    }
  }

  return chunks.join('\n\n');
}

// ---------------------------------------------------------------------------
// UX-34: Pure-JS slide extraction for the fallback renderer
// ---------------------------------------------------------------------------

/** A slide's extracted text content, ready for rendering as HTML. */
export interface SlidePreview {
  /** 1-based slide number. */
  number: number;
  /** All text runs on the slide, joined by newlines. */
  texts: string[];
}

/**
 * Extract slide text from a `.pptx` data URL or ArrayBuffer.
 * Returns one `SlidePreview` per slide in deck order. Uses JSZip to
 * unpack the OOXML archive and DOMParser to walk the DrawingML
 * `<a:t>` elements — the same approach as `extractPptxText` but
 * returns structured data instead of a flat string.
 */
export async function extractSlides(source: PptxSource): Promise<SlidePreview[]> {
  const buffer = typeof source === 'string' ? dataUrlToArrayBuffer(source) : source;
  // R-17 — a .pptx is an untrusted zip from the user's workspace. The guarded
  // reader meters ACTUAL decompressed bytes per entry and across the deck,
  // matching the native reader in src-tauri/src/commands/rag/office.rs.
  const zip = await readGuardedZip(buffer, 'presentation .pptx');

  const slideNames = zip
    .names()
    .filter((relativePath) => /^ppt\/slides\/slide\d+\.xml$/.test(relativePath));
  slideNames.sort((a, b) => {
    const na = Number.parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
    const nb = Number.parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
    return na - nb;
  });

  const slides: SlidePreview[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const name = slideNames[i]!;
    try {
      const xml = await zip.text(name);
      if (xml === null) {
        slides.push({ number: i + 1, texts: [] });
        continue;
      }
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const runs = doc.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/drawingml/2006/main',
        't'
      );
      const texts: string[] = [];
      for (let j = 0; j < runs.length; j++) {
        const txt = runs[j]?.textContent;
        if (txt && txt.trim().length > 0) texts.push(txt.trim());
      }
      slides.push({ number: i + 1, texts });
    } catch (err) {
      console.warn(`[pptx-io] Failed to extract slide ${i + 1}:`, err);
      slides.push({ number: i + 1, texts: [] });
    }
  }
  return slides;
}

// ---------------------------------------------------------------------------
// T3-4: Structured slide JSON → themed PPTX export
// ---------------------------------------------------------------------------

/**
 * Describes a single slide's content for structured PPTX generation.
 * Produced by the NDA-Safe Slide Outliner (and any future slide workflows)
 * as a JSON code fence appended to the Markdown outline.
 */
export interface SlideJSON {
  title: string;
  layout: 'title-only' | 'bullets' | 'two-column' | 'table';
  bullets: string[];
  speakerNotes: string;
  tableData: { headers: string[]; rows: string[][] } | null;
}

export interface PptxExportOptions {
  firmName?: string;
}

/**
 * Build a themed `.pptx` from a structured array of `SlideJSON` objects.
 *
 * Features vs the plain `markdownToPptxBytes` path:
 *  - Navy (var(--kp-navy)) title bar on every content slide
 *  - Optional dark title slide with firm name
 *  - Table slides via `addTable()`
 *  - Two-column bullet layout
 *  - Speaker notes preserved via `addNotes()`
 *
 * Returns `Uint8Array` so the caller can feed it straight into `saveFile()`
 * or `pptxBytesToDataUrl()` without further conversion.
 */
export async function buildPptxFromSlideJSON(
  slides: SlideJSON[],
  options: PptxExportOptions = {}
): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial' };

  // Optional dark title/cover slide
  if (options.firmName) {
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: PPTX_NAVY };
    titleSlide.addText(options.firmName, {
      x: 0.5,
      y: 2.5,
      w: 9,
      h: 1,
      fontSize: 28,
      bold: true,
      color: 'FFFFFF',
      align: 'center',
    });
    titleSlide.addText(BRAND.messaging.exportWatermark, {
      x: 0.5,
      y: 3.5,
      w: 9,
      h: 0.5,
      fontSize: 14,
      color: '8A9BB0',
      align: 'center',
    });
  }

  // Content slides
  for (const slide of slides) {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };

    // Navy title bar at top
    s.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 10,
      h: 0.08,
      fill: { color: PPTX_NAVY },
      line: { color: PPTX_NAVY },
    });

    // Slide title
    s.addText(slide.title, {
      x: 0.4,
      y: 0.2,
      w: 9.2,
      h: 0.7,
      fontSize: 22,
      bold: true,
      color: PPTX_NAVY,
    });

    if (slide.layout === 'bullets' && slide.bullets.length > 0) {
      const bulletItems = slide.bullets.map((b) => ({
        text: b,
        options: {
          bullet: { type: 'bullet' as const },
          fontSize: 16,
          color: '3A3A38',
          paraSpaceAfter: 4,
        },
      }));
      s.addText(bulletItems, { x: 0.4, y: 1.1, w: 9.2, h: 4.5 });
    }

    if (slide.layout === 'table' && slide.tableData) {
      const headerRow = slide.tableData.headers.map((h) => ({
        text: h,
        options: {
          bold: true,
          color: 'FFFFFF',
          fill: { color: PPTX_NAVY },
        },
      }));
      const dataRows = slide.tableData.rows.map((row) =>
        row.map((cell) => ({ text: cell, options: { color: '3A3A38' } }))
      );
      s.addTable([headerRow, ...dataRows], {
        x: 0.4,
        y: 1.1,
        w: 9.2,
        border: { type: 'solid', color: 'E0E0D8', pt: 1 },
        rowH: 0.4,
      });
    }

    if (slide.layout === 'two-column' && slide.bullets.length > 0) {
      const half = Math.ceil(slide.bullets.length / 2);
      const col1 = slide.bullets.slice(0, half).map((b) => ({
        text: b,
        options: {
          bullet: { type: 'bullet' as const },
          fontSize: 16,
          color: '3A3A38',
          paraSpaceAfter: 4,
        },
      }));
      const col2 = slide.bullets.slice(half).map((b) => ({
        text: b,
        options: {
          bullet: { type: 'bullet' as const },
          fontSize: 16,
          color: '3A3A38',
          paraSpaceAfter: 4,
        },
      }));
      s.addText(col1, { x: 0.4, y: 1.1, w: 4.5, h: 4.5 });
      s.addText(col2, { x: 5.1, y: 1.1, w: 4.5, h: 4.5 });
    }

    if (slide.layout === 'title-only') {
      // Title already rendered above; nothing more to add
    }

    if (slide.speakerNotes) {
      s.addNotes(slide.speakerNotes);
    }
  }

  const out = (await pptx.write({ outputType: 'arraybuffer' })) as unknown;
  if (out instanceof Uint8Array) {
    return out;
  }
  if (out instanceof ArrayBuffer) {
    return new Uint8Array(out as ArrayBuffer);
  }
  throw new Error('Unexpected PptxGenJS output — expected Uint8Array/ArrayBuffer.');
}

/**
 * Bundle pptx bytes back into a data URL for the editor tab's `content`.
 * Mirrors `docxBytesToDataUrl` / `spreadsheetBytesToDataUrl`.
 */
export function pptxBytesToDataUrl(bytes: Uint8Array): string {
  const mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

// PPTX IO Utilities
//
// Helpers for creating `.pptx` files and extracting text from existing ones.
//
// PowerPoint preview inside Projelli is handled via LibreOffice → PDF
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
import JSZip from 'jszip';

import { dataUrlToArrayBuffer } from './spreadsheet-io';
import { markdownToHtml } from './docx-io';

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
  const zip = await JSZip.loadAsync(buffer);

  // Collect slide names and sort so the output matches the deck's order.
  // ZIP file order isn't guaranteed to match slide order, and PowerPoint
  // uses `slide1.xml`, `slide2.xml`, ..., so a numeric sort on the stem is
  // sufficient and portable.
  const slideNames: string[] = [];
  zip.forEach((relativePath) => {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(relativePath)) {
      slideNames.push(relativePath);
    }
  });
  slideNames.sort((a, b) => {
    const na = Number.parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
    const nb = Number.parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
    return na - nb;
  });

  const chunks: string[] = [];
  let slideNumber = 0;

  for (const name of slideNames) {
    slideNumber += 1;
    const file = zip.file(name);
    if (!file) continue;
    try {
      const xml = await file.async('string');
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
  const zip = await JSZip.loadAsync(buffer);

  const slideNames: string[] = [];
  zip.forEach((relativePath) => {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(relativePath)) {
      slideNames.push(relativePath);
    }
  });
  slideNames.sort((a, b) => {
    const na = Number.parseInt(a.match(/slide(\d+)/)?.[1] ?? '0', 10);
    const nb = Number.parseInt(b.match(/slide(\d+)/)?.[1] ?? '0', 10);
    return na - nb;
  });

  const slides: SlidePreview[] = [];
  for (let i = 0; i < slideNames.length; i++) {
    const name = slideNames[i]!;
    const file = zip.file(name);
    if (!file) {
      slides.push({ number: i + 1, texts: [] });
      continue;
    }
    try {
      const xml = await file.async('string');
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

// DOCX IO Utilities
// Helpers for parsing `.docx` files for read-only preview and (later) AI extraction.
//
// Two libraries cooperate here:
//  - `docx-preview` (Apache-2.0) renders DOCX directly into a DOM container,
//    matching Word layout closely. Used by the viewer.
//  - `mammoth` (BSD-2-Clause) extracts clean HTML and plain text. Used for
//    future AI ambient-context extraction. Stable to expose now.

import mammoth from 'mammoth';
import { renderAsync } from 'docx-preview';

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

/**
 * Stream A2 - PDF text extraction utility.
 *
 * Uses pdfjs-dist (lazy-loaded on first call). The PDF.js web worker is
 * expected at /pdf.worker.min.mjs (placed in public/ by the prebuild step).
 *
 * pdfjs-dist version in use: 5.6.205 (installed 2026-04-28).
 *
 * This module is the single extraction code path shared by all providers.
 * It is NOT imported at startup; it is dynamically imported inside
 * formatAttachmentForRequest so it never enters the main bundle.
 */

export interface PdfExtractionResult {
  /** Extracted text per page. Empty array if encrypted or zero-page document. */
  pages: string[];
  /** Total page count from the PDF document metadata. 0 if encrypted. */
  pageCount: number;
  /** True when the PDF requires a password (PasswordException thrown by PDF.js). */
  encrypted: boolean;
  /**
   * True when the total extracted text across all pages is under 100 characters.
   * This is the heuristic for a scanned/image-only PDF where OCR was not run.
   */
  scanned: boolean;
}

/** Threshold for scanned-PDF detection: total chars across all pages. */
const SCANNED_THRESHOLD = 100;

/** VG-2 — per-PAGE OCR threshold: a page whose extracted text trims to fewer
 *  than this many characters is treated as a scanned/image page. Deliberately
 *  separate from the whole-file `SCANNED_THRESHOLD` so a mixed native/scanned
 *  filing OCRs only its scanned pages while the native pages keep their
 *  extracted text. */
const PAGE_OCR_THRESHOLD = 25;

/**
 * PDF attachments, indexed workspace PDFs, intake PDFs, and ACATS PDFs all
 * reach this module from outside the advisor's control. Text extraction and
 * OCR rasterization do not need PDF.js's dynamic-code evaluation path.
 */
export const UNTRUSTED_PDFJS_OPTIONS = Object.freeze({
  isEvalSupported: false,
  enableXfa: false,
});

/**
 * VG-2 — does this page's extracted text indicate an image-only (scanned)
 * page that needs OCR? Pure; the OCR pipeline in MemoryService maps it over
 * `PdfExtractionResult.pages`.
 */
export function pageNeedsOcr(pageText: string): boolean {
  return pageText.trim().length < PAGE_OCR_THRESHOLD;
}

let workerConfigured = false;

/**
 * Detect if we are running in a real browser environment.
 * jsdom provides window and document but not the Web Worker constructor.
 * A real browser has both. In Vite's production build, import.meta.env is set.
 */
function isRealBrowser(): boolean {
  // In a real browser, Worker is available and window.location.protocol is http(s).
  // jsdom has window but no native Worker, and location.protocol is 'about:'.
  if (typeof window === 'undefined') return false;
  if (typeof window.Worker === 'undefined') return false;
  const proto = window.location?.protocol ?? '';
  return proto === 'http:' || proto === 'https:';
}

/**
 * Configure the PDF.js GlobalWorkerOptions once. Safe to call multiple times.
 * In browser (including the Tauri desktop webview, which reports http(s)
 * origin and a real Worker constructor): worker file is pdf.worker.min.mjs
 * placed in public/. In Node/jsdom (tests): workerSrc is configured by
 * tests/setup.ts to point to the legacy worker file on disk so the
 * fake-worker can import it in-thread.
 *
 * Exported so every PDF.js call site in the desktop app shares one correct
 * configuration, instead of each writing its own (a prior ad-hoc call site
 * in pdfFillReceipt.ts never called this and never set workerSrc at all -
 * PDF.js still requires it even with disableWorker: true).
 */
export async function ensureWorkerConfigured(): Promise<void> {
  if (workerConfigured) return;
  const pdfjsLib = await import('pdfjs-dist');
  if (isRealBrowser()) {
    // Browser: use the worker file placed in public/ by the prebuild script.
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  }
  // In Node/jsdom (tests): workerSrc is pre-configured by tests/setup.ts
  // to the legacy worker file's file:// URL. Do not override it here.
  workerConfigured = true;
}

/**
 * Extract text from a PDF supplied as raw bytes.
 *
 * Encrypted PDFs are caught by PDF.js's PasswordException and returned
 * as { encrypted: true, pages: [], pageCount: 0, scanned: false } without
 * throwing so callers can surface a clean error to the user.
 *
 * Scanned PDFs (total text under 100 chars) are flagged with scanned: true
 * so callers can offer a "send as native PDF anyway" escape hatch.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<PdfExtractionResult> {
  await ensureWorkerConfigured();
  const pdfjsLib = await import('pdfjs-dist');

  let pdf: Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: bytes,
      ...UNTRUSTED_PDFJS_OPTIONS,
    });
    pdf = await loadingTask.promise;
  } catch (err: unknown) {
    // PDF.js throws a PasswordException for encrypted/password-protected files.
    // The exception name is 'PasswordException' and the message contains 'password'.
    if (
      err instanceof Error &&
      (err.name === 'PasswordException' || err.message.toLowerCase().includes('password'))
    ) {
      return { pages: [], pageCount: 0, encrypted: true, scanned: false };
    }
    // Check for object with name property (PDF.js may not extend Error)
    if (
      typeof err === 'object' &&
      err !== null &&
      'name' in err &&
      (err as { name: string }).name === 'PasswordException'
    ) {
      return { pages: [], pageCount: 0, encrypted: true, scanned: false };
    }
    // Any other load error: rethrow so callers get a genuine error toast.
    throw err;
  }

  // pdfjs spawns a dedicated worker per getDocument and holds the transferred
  // buffer until destroy() — without the finally, every extraction leaked a
  // worker thread + a full copy of the file for the app's lifetime (the OCR
  // per-page loop amplified this across whole scans; Wave 2 review finding).
  try {
    const pageCount = pdf.numPages;
    const pages: string[] = [];

    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      pages.push(pageText);
    }

    const totalChars = pages.reduce((sum, p) => sum + p.length, 0);
    const scanned = totalChars < SCANNED_THRESHOLD;

    return { pages, pageCount, encrypted: false, scanned };
  } finally {
    await pdf.destroy();
  }
}

/**
 * VG-2 — render ONE page of a PDF to PNG bytes for the local OCR engine.
 *
 * `pageIndex` is 0-based. `scale = 2` renders at twice the PDF's nominal
 * point size (a US-letter page becomes ~1224 px wide — comfortably inside
 * the resolution band the OCR spike calibrated against).
 *
 * Memory discipline (F-501): renders ONE page per call and releases the
 * canvas before returning; the pipeline calls it sequentially, never for all
 * pages at once. Prefers `OffscreenCanvas` (no DOM churn) and falls back to a
 * detached `<canvas>` element for engines without it.
 *
 * Only callable in a real browser/webview (the OCR pipeline gates on
 * `isOcrEngineAvailable()` first); throws under jsdom/Node where no canvas
 * implementation exists.
 */
export async function renderPdfPageToPng(
  bytes: Uint8Array,
  pageIndex: number,
  scale = 2,
): Promise<Uint8Array> {
  await ensureWorkerConfigured();
  const pdfjsLib = await import('pdfjs-dist');
  // PDF.js TRANSFERS the data buffer to its worker (detaching it in this
  // thread), so hand it a private copy — the caller's bytes survive for the
  // next page's render call. Caught live in the Task 8 browser sanity run:
  // without the copy, page 2 of a multi-page OCR batch throws DataCloneError.
  const pdf = await pdfjsLib.getDocument({
    data: bytes.slice(),
    ...UNTRUSTED_PDFJS_OPTIONS,
  }).promise;
  try {
    const page = await pdf.getPage(pageIndex + 1); // PDF.js pages are 1-based
    const viewport = page.getViewport({ scale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));

    let blob: Blob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d canvas context unavailable for PDF page render');
      // pdfjs 5.x render API: when rendering via a context (OffscreenCanvas
      // has no HTMLCanvasElement), `canvas` must be explicitly null.
      await page.render({
        canvas: null,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;
      blob = await canvas.convertToBlob({ type: 'image/png' });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      await page.render({ canvas, viewport }).promise;
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) {
            resolve(b);
          } else {
            reject(new Error('canvas.toBlob returned null'));
          }
        }, 'image/png');
      });
      // Release the bitmap memory eagerly (the element is detached, but the
      // backing store lives until the canvas is resized or collected).
      canvas.width = 0;
      canvas.height = 0;
    }
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    // Free PDF.js worker-side page/document resources for this render.
    await pdf.destroy().catch(() => undefined);
  }
}

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
 * In browser: worker file is pdf.worker.min.mjs placed in public/.
 * In Node/jsdom (tests): workerSrc is configured by tests/setup.ts to point
 * to the legacy worker file on disk so the fake-worker can import it in-thread.
 */
async function ensureWorkerConfigured(): Promise<void> {
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
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
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
}

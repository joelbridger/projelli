/**
 * VG-2 — the OCR engine seam.
 *
 * `ocrPageImage` is the ONLY OCR surface the rest of the app may touch.
 * Callers (the Task 8 pipeline in MemoryService / pdf-extract) never know
 * which engine sits behind it, so a later engine swap (e.g. a native
 * sidecar, revival conditions in spikes/ocr-engine/DECISION.md) touches
 * this file alone.
 *
 * Engine choice (Wave 2 Task 6 spike, 2026-06-11): tesseract-wasm 0.11.0
 * running in a renderer web worker — accuracy and per-page speed measured
 * at parity with the native CLI, zero per-platform packaging. All assets
 * are vendored under public/ocr/ (worker JS, SIMD + fallback wasm, the
 * pinned tessdata_fast eng model) and ship inside the app bundle; nothing
 * is ever fetched from the network at runtime and no page image or
 * recognized text leaves the machine.
 *
 * Confidence convention: tesseract-wasm reports per-word confidence in
 * [0, 1]; we return the mean over non-blank words x100 so values sit on
 * the native Tesseract 0-100 scale the pipeline's OCR_LOW_CONFIDENCE = 60
 * threshold (Task 8) expects.
 *
 * Memory: the worker's wasm heap (~150-200 MB once a page has been
 * recognized) is only returned on destroy, so batch callers must call
 * `destroyOcrClient()` when their batch ends.
 */
import type { OCRClient } from 'tesseract-wasm';

/** Vendored by the copy-ocr-assets prebuild step (see public/ocr/README.md). */
const OCR_WORKER_URL = '/ocr/tesseract-worker.js';
const OCR_MODEL_URL = '/ocr/eng.traineddata';

export interface OcrPageResult {
  /** Recognized page text in reading order. */
  text: string;
  /** Mean word confidence on the 0-100 scale; 0 when no words were found. */
  confidence: number;
}

/** Lazy singleton: one worker + one loaded model serves the whole session. */
let clientPromise: Promise<OCRClient> | null = null;

/**
 * The shared client is single-image stateful (loadImage replaces the
 * previous page), so recognitions are serialized through this chain.
 * Failures don't break the chain.
 */
let opChain: Promise<unknown> = Promise.resolve();

function serialized<T>(op: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> => op();
  const next = opChain.then(run, run);
  opChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function initClient(): Promise<OCRClient> {
  // Dynamic import: tesseract-wasm never enters the main bundle and the
  // worker only spins up when a scanned page actually needs reading.
  const { OCRClient: Client } = await import('tesseract-wasm');
  const client = new Client({ workerURL: OCR_WORKER_URL });
  try {
    await client.loadModel(OCR_MODEL_URL);
  } catch (err) {
    // Never leak a half-initialized worker.
    void client.destroy().catch(() => undefined);
    throw err;
  }
  return client;
}

function getClient(): Promise<OCRClient> {
  if (!clientPromise) {
    const promise = initClient();
    clientPromise = promise;
    // A failed init must not poison the seam: the next call retries.
    promise.catch(() => {
      if (clientPromise === promise) clientPromise = null;
    });
  }
  return clientPromise;
}

/**
 * True when this runtime can run the OCR engine at all (a real renderer
 * with web workers and image decoding; false under jsdom/Node). Task 8's
 * pipeline gates on this before offering OCR.
 */
export function isOcrEngineAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined';
}

/**
 * Recognize one page image (PNG bytes, as rendered by the PDF page
 * rasterizer) into text plus a mean word confidence.
 *
 * Runs entirely on this machine: the image goes to a local web worker,
 * never anywhere else.
 */
export function ocrPageImage(png: Uint8Array): Promise<OcrPageResult> {
  return serialized(async () => {
    const client = await getClient();

    const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
    try {
      await client.loadImage(bitmap);
    } finally {
      // OCRClient converts the bitmap to ImageData before handing it to the
      // worker, so the decode buffer can be released immediately.
      bitmap.close();
    }

    // getTextBoxes runs the recognition pass and carries per-word
    // confidences; getText reuses that pass (~1 ms after it).
    const words = await client.getTextBoxes('word');
    const scored = words.filter((w) => w.text.trim().length > 0);
    const confidence =
      scored.length === 0
        ? 0
        : (scored.reduce((sum, w) => sum + w.confidence, 0) / scored.length) * 100;

    const text = await client.getText();
    return { text, confidence };
  });
}

/**
 * Tear down the OCR worker and release its wasm heap. Call after a batch
 * of pages; waits for any in-flight recognition first. The next
 * `ocrPageImage` call transparently re-initializes.
 */
export function destroyOcrClient(): Promise<void> {
  return serialized(async () => {
    if (!clientPromise) return;
    const pending = clientPromise;
    clientPromise = null;
    let client: OCRClient;
    try {
      client = await pending;
    } catch {
      return; // init already failed; nothing to tear down
    }
    await client.destroy();
  });
}

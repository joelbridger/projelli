/**
 * VG-2 (Wave 2 Task 7) — REAL-recognition smoke test for the vendored OCR
 * engine assets in public/ocr/.
 *
 * This runs the actual committed wasm build + traineddata over a committed
 * fixture image, so it proves (a) the vendored binaries are not corrupt and
 * (b) recognition genuinely works in this runtime. It uses tesseract-wasm's
 * low-level createOCREngine API (in-process, no Worker) — the exact path the
 * VG-2 spike validated in Node (spikes/ocr-engine/DECISION.md, Evidence C).
 * The Worker-backed OCRClient path that `ocrPageImage` uses in the renderer
 * cannot run under jsdom (no Worker / createImageBitmap); it is mocked in
 * ocrEngine.test.ts and proven live by Task 8's pipeline + the Task 14
 * native run.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { createOCREngine, type OCREngine } from 'tesseract-wasm';

// Must match tests/fixtures/ocr/generate-smoke-fixture.py.
const WIDTH = 720;
const HEIGHT = 100;
const PLANTED_FRAGMENT = 'scanned pages locally';

describe('vendored tesseract-wasm engine (real recognition)', () => {
  let engine: OCREngine | null = null;

  beforeAll(async () => {
    const wasm = readFileSync(resolve(process.cwd(), 'public/ocr/tesseract-core.wasm'));
    engine = await createOCREngine({ wasmBinary: wasm });
    const model = readFileSync(resolve(process.cwd(), 'public/ocr/eng.traineddata'));
    // Re-wrap with this realm's Uint8Array: under the jsdom environment the
    // inlined lib.js type-checks against jsdom's intrinsics, which a Node
    // Buffer (Node-realm Uint8Array) fails.
    engine.loadModel(new Uint8Array(model));
  }, 60_000);

  afterAll(() => {
    // The wasm heap is only released on destroy (same rule the seam's
    // destroyOcrClient exists for).
    engine?.destroy();
    engine = null;
  });

  it('reads the committed fixture image and clears the low-confidence bar', () => {
    const gz = readFileSync(resolve(process.cwd(), 'tests/fixtures/ocr/smoke-720x100.rgba.gz'));
    const raw = gunzipSync(gz);
    expect(raw.byteLength).toBe(WIDTH * HEIGHT * 4);

    // Copy into a fresh buffer: the engine reads imageData.data.buffer whole,
    // so the view must own its buffer exactly (offset 0, exact length).
    const data = new Uint8ClampedArray(raw);
    engine!.loadImage({ data, width: WIDTH, height: HEIGHT } as ImageData);

    const text = engine!.getText().trim();
    expect(text.toLowerCase()).toContain(PLANTED_FRAGMENT);

    // Same confidence math as the seam: mean over non-blank words, x100
    // (0-100 scale, the OCR_LOW_CONFIDENCE = 60 convention).
    const words = engine!.getTextBoxes('word').filter((w) => w.text.trim().length > 0);
    expect(words.length).toBeGreaterThanOrEqual(4);
    const mean = (words.reduce((sum, w) => sum + w.confidence, 0) / words.length) * 100;
    expect(mean).toBeGreaterThan(60);
  }, 60_000);
});

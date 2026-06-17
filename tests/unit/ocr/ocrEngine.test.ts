/**
 * VG-2 (Wave 2 Task 7) — unit tests for the OCR seam, `ocrPageImage`.
 *
 * The tesseract-wasm client is MOCKED here: these tests pin the seam's
 * contract (lazy init-once, vendored asset URLs, confidence math on the
 * 0-100 scale, serial recognition, destroy/re-init, failed-init retry).
 * Real recognition through the vendored wasm build is covered by
 * tests/unit/ocr/ocrEngine.wasm.test.ts, and end-to-end through the
 * pipeline by Task 8's tests + the Task 14 native run.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type SeamModule = typeof import('@/platform/rag/ocr/ocrEngine');

interface RecordedCall {
  method: string;
  args: unknown[];
}

const h = vi.hoisted(() => ({
  constructorOptions: [] as unknown[],
  clientCount: 0,
  calls: [] as RecordedCall[],
  /** Word boxes returned by getTextBoxes('word'); confidence is in [0,1]. */
  words: [] as Array<{ text: string; confidence: number }>,
  text: '',
  loadModelImpl: null as (() => Promise<void>) | null,
  getTextImpl: null as (() => Promise<string>) | null,
}));

vi.mock('tesseract-wasm', () => {
  class FakeOCRClient {
    constructor(options: unknown) {
      h.constructorOptions.push(options);
      h.clientCount += 1;
    }
    async loadModel(model: unknown): Promise<void> {
      h.calls.push({ method: 'loadModel', args: [model] });
      if (h.loadModelImpl) await h.loadModelImpl();
    }
    async loadImage(image: unknown): Promise<void> {
      h.calls.push({ method: 'loadImage', args: [image] });
    }
    async getTextBoxes(unit: unknown): Promise<unknown[]> {
      h.calls.push({ method: 'getTextBoxes', args: [unit] });
      return h.words.map((w) => ({
        rect: { left: 0, top: 0, right: 1, bottom: 1 },
        flags: 0,
        text: w.text,
        confidence: w.confidence,
      }));
    }
    async getText(): Promise<string> {
      h.calls.push({ method: 'getText', args: [] });
      if (h.getTextImpl) return h.getTextImpl();
      return h.text;
    }
    async destroy(): Promise<void> {
      h.calls.push({ method: 'destroy', args: [] });
    }
  }
  return { OCRClient: FakeOCRClient };
});

const fakeBitmap = { width: 8, height: 8, close: vi.fn() };
const createImageBitmapMock = vi.fn(async (_source: Blob) => fakeBitmap);

function methods(): string[] {
  return h.calls.map((c) => c.method);
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function loadSeam(): Promise<SeamModule> {
  return import('@/platform/rag/ocr/ocrEngine');
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

beforeEach(() => {
  vi.resetModules();
  h.constructorOptions.length = 0;
  h.clientCount = 0;
  h.calls.length = 0;
  h.words = [
    { text: 'Motion', confidence: 0.96 },
    { text: 'DENIED', confidence: 0.84 },
  ];
  h.text = 'Motion DENIED';
  h.loadModelImpl = null;
  h.getTextImpl = null;
  fakeBitmap.close.mockClear();
  createImageBitmapMock.mockClear();
  vi.stubGlobal('createImageBitmap', createImageBitmapMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ocrPageImage seam (client mocked)', () => {
  it('is lazy: importing the module starts no worker client', async () => {
    await loadSeam();
    expect(h.clientCount).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it('initializes once against the vendored worker + model URLs', async () => {
    const seam = await loadSeam();
    await seam.ocrPageImage(PNG);
    await seam.ocrPageImage(PNG);

    expect(h.clientCount).toBe(1);
    expect(h.constructorOptions[0]).toEqual({ workerURL: '/ocr/tesseract-worker.js' });
    const loadModelCalls = h.calls.filter((c) => c.method === 'loadModel');
    expect(loadModelCalls).toHaveLength(1);
    expect(loadModelCalls[0]?.args[0]).toBe('/ocr/eng.traineddata');
  });

  it('shares a single client across concurrent first calls', async () => {
    const seam = await loadSeam();
    await Promise.all([seam.ocrPageImage(PNG), seam.ocrPageImage(PNG)]);
    expect(h.clientCount).toBe(1);
    expect(h.calls.filter((c) => c.method === 'loadModel')).toHaveLength(1);
  });

  it('returns getText output and mean word confidence x100, ignoring blank words', async () => {
    h.words = [
      { text: 'Motion', confidence: 0.96 },
      { text: 'to', confidence: 0.92 },
      { text: 'compel', confidence: 0.88 },
      { text: '', confidence: 0.01 },
      { text: '   ', confidence: 0.5 },
    ];
    h.text = 'Motion to compel';
    const seam = await loadSeam();
    const result = await seam.ocrPageImage(PNG);

    expect(result.text).toBe('Motion to compel');
    // (0.96 + 0.92 + 0.88) / 3 * 100 — blank-text words excluded, 0-100 scale
    // (matches the native TSV convention and OCR_LOW_CONFIDENCE = 60).
    expect(result.confidence).toBeCloseTo(92, 9);
  });

  it('returns confidence 0 for a page with no recognized words', async () => {
    h.words = [];
    h.text = '';
    const seam = await loadSeam();
    const result = await seam.ocrPageImage(PNG);
    expect(result).toEqual({ text: '', confidence: 0 });
  });

  it('decodes the PNG bytes via createImageBitmap and frees the bitmap after load', async () => {
    const seam = await loadSeam();
    await seam.ocrPageImage(PNG);

    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    const blob = createImageBitmapMock.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('image/png');
    expect(blob?.size).toBe(PNG.byteLength);

    const loadImageCall = h.calls.find((c) => c.method === 'loadImage');
    expect(loadImageCall?.args[0]).toBe(fakeBitmap);
    expect(fakeBitmap.close).toHaveBeenCalledTimes(1);

    // Recognition order: image in, word boxes (recognition pass), then the
    // text read that reuses that pass.
    expect(methods()).toEqual(['loadModel', 'loadImage', 'getTextBoxes', 'getText']);
  });

  it('recognizes pages serially even when called concurrently', async () => {
    let releaseFirstGetText: (() => void) | null = null;
    h.getTextImpl = () => {
      if (releaseFirstGetText) return Promise.resolve(h.text);
      return new Promise<string>((resolve) => {
        releaseFirstGetText = () => resolve(h.text);
      });
    };

    const seam = await loadSeam();
    const first = seam.ocrPageImage(PNG);
    const second = seam.ocrPageImage(PNG);
    await tick();

    // While the first page is still mid-recognition, the second page must
    // not have touched the shared client.
    expect(methods().filter((m) => m === 'loadImage')).toHaveLength(1);

    releaseFirstGetText!();
    await first;
    await second;
    expect(methods()).toEqual([
      'loadModel',
      'loadImage',
      'getTextBoxes',
      'getText',
      'loadImage',
      'getTextBoxes',
      'getText',
    ]);
  });

  it('destroyOcrClient tears down the worker and the next call re-initializes', async () => {
    const seam = await loadSeam();
    await seam.ocrPageImage(PNG);
    await seam.destroyOcrClient();

    expect(h.calls.filter((c) => c.method === 'destroy')).toHaveLength(1);

    await seam.ocrPageImage(PNG);
    expect(h.clientCount).toBe(2);
    expect(h.calls.filter((c) => c.method === 'loadModel')).toHaveLength(2);
  });

  it('destroyOcrClient before any init is a no-op', async () => {
    const seam = await loadSeam();
    await seam.destroyOcrClient();
    expect(h.clientCount).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it('a failed init does not poison the seam: the failed client is destroyed and the next call retries', async () => {
    let failures = 0;
    h.loadModelImpl = () => {
      failures += 1;
      return Promise.reject(new Error('model fetch failed'));
    };

    const seam = await loadSeam();
    await expect(seam.ocrPageImage(PNG)).rejects.toThrow('model fetch failed');
    expect(failures).toBe(1);
    // The half-initialized client must not leak its worker.
    expect(h.calls.filter((c) => c.method === 'destroy')).toHaveLength(1);

    h.loadModelImpl = null;
    const result = await seam.ocrPageImage(PNG);
    expect(result.text).toBe('Motion DENIED');
    expect(h.clientCount).toBe(2);
  });
});

describe('isOcrEngineAvailable', () => {
  it('is false where the renderer prerequisites are missing (jsdom has no Worker)', async () => {
    const seam = await loadSeam();
    expect(seam.isOcrEngineAvailable()).toBe(false);
  });

  it('is true when Worker and createImageBitmap exist', async () => {
    vi.stubGlobal('Worker', class {});
    const seam = await loadSeam();
    expect(seam.isOcrEngineAvailable()).toBe(true);
  });
});

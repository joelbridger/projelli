/**
 * VG-2 (Wave 2 Task 8) — the OCR pipeline in MemoryService.indexPdfFile.
 *
 * Scanned pages become searchable, honestly:
 *   - pages that need OCR (per-page threshold) are rendered + read by the
 *     local engine SEQUENTIALLY, native pages keep their extracted text;
 *   - ONE ragIndexPdfChunks call carries pageConfidences aligned with pages;
 *   - toggle off / engine unavailable -> the previous honest skip
 *     (`reason: 'scanned'`), never a silent half-index;
 *   - a per-page OCR failure never loses the native pages;
 *   - the worker heap is returned via destroyOcrClient after the batch.
 *
 * The OCR engine and the Tauri command are mocked (jsdom has no worker /
 * canvas); the REAL end-to-end on the committed fixtures rides the dev-run
 * browser sanity + the Task 14 native run. The committed scanned fixtures
 * are still exercised here through the REAL extractPdfText (pdfjs legacy
 * build) to prove they are image-only (`scanned: true`).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock the OCR engine seam (controllable availability + results) ---
vi.mock('@/platform/rag/ocr/ocrEngine', () => ({
  isOcrEngineAvailable: vi.fn(() => true),
  ocrPageImage: vi.fn(),
  destroyOcrClient: vi.fn(() => Promise.resolve()),
}));

// --- Mock the Tauri command layer (capture ragIndexPdfChunks calls) ---
vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...actual,
    ragIndexPdfChunks: vi.fn(() => Promise.resolve(3)),
  };
});

// --- Mock pdf-extract: extraction + page render controlled per test, but
// pageNeedsOcr stays REAL so the per-page threshold is exercised in-flow. ---
vi.mock('@/lib/pdf-extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf-extract')>();
  return {
    ...actual,
    extractPdfText: vi.fn(),
    renderPdfPageToPng: vi.fn(() => Promise.resolve(new Uint8Array([0x89, 0x50]))),
  };
});

import { extractPdfText, renderPdfPageToPng } from '@/lib/pdf-extract';
import {
  destroyOcrClient,
  isOcrEngineAvailable,
  ocrPageImage,
} from '@/platform/rag/ocr/ocrEngine';
import {
  MemoryService,
  resetMemoryEnabledReader,
  resetOcrScannedPdfsEnabledReader,
  resetPdfIndexingEnabledReader,
  setMemoryEnabledReader,
  setOcrScannedPdfsEnabledReader,
  setPdfIndexingEnabledReader,
  isOcrScannedPdfsEnabled,
} from '@/platform/rag/MemoryService';
import { useOcrProgressStore } from '@/platform/rag/ocrProgressStore';
import { ragIndexPdfChunks } from '@/platform/utils/tauri-commands';

const NATIVE_PAGE_TEXT =
  'This page has a real extracted text layer with well over the per-page OCR threshold of characters.';

function mockExtraction(pages: string[], scanned: boolean): void {
  vi.mocked(extractPdfText).mockResolvedValue({
    pages,
    pageCount: pages.length,
    encrypted: false,
    scanned,
  });
}

const ws = () => ({ readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)) });

describe('OCR toggle reader (ocrScannedPdfs)', () => {
  afterEach(() => {
    resetOcrScannedPdfsEnabledReader();
  });

  it('defaults to ON (the schema toggle defaults to true)', () => {
    expect(isOcrScannedPdfsEnabled()).toBe(true);
  });

  it('can be turned off via the reader, and a throwing reader means ON', () => {
    setOcrScannedPdfsEnabledReader(() => false);
    expect(isOcrScannedPdfsEnabled()).toBe(false);
    setOcrScannedPdfsEnabledReader(() => {
      throw new Error('settings not hydrated');
    });
    expect(isOcrScannedPdfsEnabled()).toBe(true);
  });
});

describe('MemoryService.indexPdfFile OCR pipeline', () => {
  beforeEach(() => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => true);
    vi.mocked(isOcrEngineAvailable).mockReturnValue(true);
    vi.mocked(ocrPageImage).mockResolvedValue({ text: 'recognized text from the scan', confidence: 87 });
    vi.mocked(ragIndexPdfChunks).mockResolvedValue(3);
  });

  afterEach(() => {
    resetMemoryEnabledReader();
    resetPdfIndexingEnabledReader();
    resetOcrScannedPdfsEnabledReader();
    useOcrProgressStore.getState().clear();
    vi.clearAllMocks();
  });

  it('OCRs exactly the empty page of a mixed file and aligns pageConfidences', async () => {
    // Page 1 native, page 2 image-only. The file as a whole is NOT flagged
    // scanned (native text >= whole-file threshold) — the per-page check is
    // what catches page 2.
    mockExtraction([NATIVE_PAGE_TEXT, ''], false);

    const r = await MemoryService.indexPdfFile('/w/mixed.pdf', ws());

    expect(ocrPageImage).toHaveBeenCalledTimes(1);
    expect(renderPdfPageToPng).toHaveBeenCalledTimes(1);
    // Rendered the 0-based page index 1 (the second page).
    expect(vi.mocked(renderPdfPageToPng).mock.calls[0][1]).toBe(1);

    expect(ragIndexPdfChunks).toHaveBeenCalledTimes(1);
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0];
    // Native page text kept verbatim; OCR text fills the empty page.
    expect(call[1]).toEqual([NATIVE_PAGE_TEXT, 'recognized text from the scan']);
    // pageConfidences aligned with pages: [undefined, 87].
    expect(call[5]).toEqual([undefined, 87]);
    expect(r.indexed).toBe(true);
  });

  it('indexes a fully scanned file through OCR (one call per page, in order)', async () => {
    mockExtraction(['', '  '], true);
    vi.mocked(ocrPageImage)
      .mockResolvedValueOnce({ text: 'page one text', confidence: 91.5 })
      .mockResolvedValueOnce({ text: 'page two text', confidence: 48.6 });

    const r = await MemoryService.indexPdfFile('/w/scan.pdf', ws());

    expect(ocrPageImage).toHaveBeenCalledTimes(2);
    const renderedPages = vi.mocked(renderPdfPageToPng).mock.calls.map((c) => c[1]);
    expect(renderedPages).toEqual([0, 1]); // sequential, in page order
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0];
    expect(call[1]).toEqual(['page one text', 'page two text']);
    expect(call[5]).toEqual([91.5, 48.6]);
    expect(r.indexed).toBe(true);
    // The worker heap is returned once the file's scanned pages finish.
    expect(destroyOcrClient).toHaveBeenCalledTimes(1);
  });

  it('keeps the honest scanned skip when the toggle is off', async () => {
    setOcrScannedPdfsEnabledReader(() => false);
    mockExtraction(['', ''], true);

    const r = await MemoryService.indexPdfFile('/w/scan.pdf', ws());

    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('scanned');
    expect(ocrPageImage).not.toHaveBeenCalled();
    expect(ragIndexPdfChunks).not.toHaveBeenCalled();
  });

  it('keeps the honest scanned skip when the engine is unavailable (jsdom honesty)', async () => {
    vi.mocked(isOcrEngineAvailable).mockReturnValue(false);
    mockExtraction(['', ''], true);

    const r = await MemoryService.indexPdfFile('/w/scan.pdf', ws());

    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('scanned');
    expect(ocrPageImage).not.toHaveBeenCalled();
  });

  it('still indexes a mixed file natively when the toggle is off (pre-VG-2 behaviour)', async () => {
    setOcrScannedPdfsEnabledReader(() => false);
    mockExtraction([NATIVE_PAGE_TEXT, ''], false);

    const r = await MemoryService.indexPdfFile('/w/mixed.pdf', ws());

    expect(ocrPageImage).not.toHaveBeenCalled();
    expect(ragIndexPdfChunks).toHaveBeenCalledTimes(1);
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0];
    expect(call[1]).toEqual([NATIVE_PAGE_TEXT, '']);
    expect(call[5]).toBeUndefined(); // no confidences array on the native path
    expect(r.indexed).toBe(true);
  });

  it('a per-page OCR failure never loses the native pages', async () => {
    mockExtraction([NATIVE_PAGE_TEXT, ''], false);
    vi.mocked(ocrPageImage).mockRejectedValue(new Error('worker crashed'));

    const r = await MemoryService.indexPdfFile('/w/mixed.pdf', ws());

    // The failed page stays empty (no fabricated text), confidences stay
    // undefined, and the native page still indexes.
    expect(ragIndexPdfChunks).toHaveBeenCalledTimes(1);
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0];
    expect(call[1]).toEqual([NATIVE_PAGE_TEXT, '']);
    expect(call[5]).toEqual([undefined, undefined]);
    expect(r.indexed).toBe(true);
    // Teardown still runs after a failure.
    expect(destroyOcrClient).toHaveBeenCalledTimes(1);
  });

  it('publishes honest OCR progress while reading and clears it after', async () => {
    mockExtraction(['', ''], true);
    const seen: Array<{ page: number; totalPages: number } | null> = [];
    vi.mocked(ocrPageImage).mockImplementation(() => {
      const cur = useOcrProgressStore.getState().current;
      seen.push(cur ? { page: cur.page, totalPages: cur.totalPages } : null);
      return Promise.resolve({ text: 'scan text', confidence: 70 });
    });

    await MemoryService.indexPdfFile('/w/scan.pdf', ws());

    expect(seen).toEqual([
      { page: 1, totalPages: 2 },
      { page: 2, totalPages: 2 },
    ]);
    expect(useOcrProgressStore.getState().current).toBeNull();
  });
});

describe('committed scanned fixtures are genuinely image-only', () => {
  // The REAL extractPdfText (pdfjs legacy build, configured by tests/setup.ts)
  // over the REAL committed bytes: both fixtures must report scanned: true so
  // the OCR pipeline is what makes them searchable.
  const FIXTURES = resolve(__dirname, '../fixtures/matter-corpus');

  it.each([
    ['scanned-filing-stamped.pdf', 2],
    ['scanned-fax-noisy.pdf', 1],
  ])('%s extracts as scanned (%i image-only pages)', async (name, pageCount) => {
    const real = await vi.importActual<typeof import('@/lib/pdf-extract')>('@/lib/pdf-extract');
    const bytes = new Uint8Array(readFileSync(resolve(FIXTURES, name)));
    const result = await real.extractPdfText(bytes);
    expect(result.encrypted).toBe(false);
    expect(result.pageCount).toBe(pageCount);
    expect(result.scanned).toBe(true);
    // Every page individually trips the per-page OCR threshold.
    for (const page of result.pages) {
      expect(real.pageNeedsOcr(page)).toBe(true);
    }
  });
});

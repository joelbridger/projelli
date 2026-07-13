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
    ragDeletePdfPath: vi.fn(() => Promise.resolve()),
    ragManifestForgetPdf: vi.fn(() => Promise.resolve()),
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
import {
  OCR_SKIP_CONFIDENCE,
  ragDeletePdfPath,
  ragIndexPdfChunks,
} from '@/platform/utils/tauri-commands';

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

    const r = await MemoryService.indexPdfFile('/w/mixed.pdf', ws(), '/w');

    expect(ocrPageImage).toHaveBeenCalledTimes(1);
    expect(renderPdfPageToPng).toHaveBeenCalledTimes(1);
    // Rendered the 0-based page index 1 (the second page).
    expect(vi.mocked(renderPdfPageToPng).mock.calls[0]![1]).toBe(1);

    expect(ragIndexPdfChunks).toHaveBeenCalledTimes(1);
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0]!;
    // Native page text kept verbatim; OCR text fills the empty page.
    expect(call[1]).toEqual([NATIVE_PAGE_TEXT, 'recognized text from the scan']);
    // pageConfidences aligned with pages: [undefined, 87].
    expect(call[7]).toEqual([undefined, 87]);
    expect(r.indexed).toBe(true);
  });

  it('indexes a fully scanned file through OCR (one call per page, in order)', async () => {
    mockExtraction(['', '  '], true);
    vi.mocked(ocrPageImage)
      .mockResolvedValueOnce({ text: 'page one text', confidence: 91.5 })
      .mockResolvedValueOnce({ text: 'page two text', confidence: 48.6 });

    const r = await MemoryService.indexPdfFile('/w/scan.pdf', ws(), '/w');

    expect(ocrPageImage).toHaveBeenCalledTimes(2);
    const renderedPages = vi.mocked(renderPdfPageToPng).mock.calls.map((c) => c[1]);
    expect(renderedPages).toEqual([0, 1]); // sequential, in page order
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0]!;
    expect(call[1]).toEqual(['page one text', 'page two text']);
    expect(call[7]).toEqual([91.5, 48.6]);
    expect(r.indexed).toBe(true);
    // The worker heap is returned once the file's scanned pages finish.
    expect(destroyOcrClient).toHaveBeenCalledTimes(1);
  });

  it('keeps the honest scanned skip when the toggle is off', async () => {
    setOcrScannedPdfsEnabledReader(() => false);
    mockExtraction(['', ''], true);

    const r = await MemoryService.indexPdfFile('/w/scan.pdf', ws(), '/w');

    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('scanned');
    expect(ocrPageImage).not.toHaveBeenCalled();
    expect(ragIndexPdfChunks).not.toHaveBeenCalled();
  });

  it('keeps the honest scanned skip when the engine is unavailable (jsdom honesty)', async () => {
    vi.mocked(isOcrEngineAvailable).mockReturnValue(false);
    mockExtraction(['', ''], true);

    const r = await MemoryService.indexPdfFile('/w/scan.pdf', ws(), '/w');

    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('scanned');
    expect(ocrPageImage).not.toHaveBeenCalled();
  });

  it('still indexes a mixed file natively when the toggle is off (pre-VG-2 behaviour)', async () => {
    setOcrScannedPdfsEnabledReader(() => false);
    mockExtraction([NATIVE_PAGE_TEXT, ''], false);

    const r = await MemoryService.indexPdfFile('/w/mixed.pdf', ws(), '/w');

    expect(ocrPageImage).not.toHaveBeenCalled();
    expect(ragIndexPdfChunks).toHaveBeenCalledTimes(1);
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0]!;
    expect(call[1]).toEqual([NATIVE_PAGE_TEXT, '']);
    expect(call[7]).toBeUndefined(); // no confidences array on the native path
    expect(r.indexed).toBe(true);
  });

  it('a per-page OCR failure never loses the native pages', async () => {
    mockExtraction([NATIVE_PAGE_TEXT, ''], false);
    vi.mocked(ocrPageImage).mockRejectedValue(new Error('worker crashed'));

    const r = await MemoryService.indexPdfFile('/w/mixed.pdf', ws(), '/w');

    // The failed page stays empty (no fabricated text), confidences stay
    // undefined, and the native page still indexes.
    expect(ragIndexPdfChunks).toHaveBeenCalledTimes(1);
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0]!;
    expect(call[1]).toEqual([NATIVE_PAGE_TEXT, '']);
    expect(call[7]).toEqual([undefined, undefined]);
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

    await MemoryService.indexPdfFile('/w/scan.pdf', ws(), '/w');

    expect(seen).toEqual([
      { page: 1, totalPages: 2 },
      { page: 2, totalPages: 2 },
    ]);
    expect(useOcrProgressStore.getState().current).toBeNull();
  });
});

describe('WS3c — OCR confidence skip gate (< 30 not indexed)', () => {
  beforeEach(() => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => true);
    vi.mocked(isOcrEngineAvailable).mockReturnValue(true);
    vi.mocked(ragIndexPdfChunks).mockResolvedValue(3);
  });

  afterEach(() => {
    resetMemoryEnabledReader();
    resetPdfIndexingEnabledReader();
    resetOcrScannedPdfsEnabledReader();
    useOcrProgressStore.getState().clear();
    vi.clearAllMocks();
  });

  it('(a) drops an OCR page below 30 confidence while keeping the good page', async () => {
    // Fully scanned two-page file: page 1 reads cleanly (85), page 2 is
    // near-gibberish (20). Only page 2 must be excluded from indexing.
    mockExtraction(['', ''], true);
    vi.mocked(ocrPageImage)
      .mockResolvedValueOnce({ text: 'a clean confident scan page', confidence: 85 })
      .mockResolvedValueOnce({ text: 'gjbber1sh n0ise scan', confidence: 20 });

    const r = await MemoryService.indexPdfFile('/w/scan.pdf', ws(), '/w');

    expect(ragIndexPdfChunks).toHaveBeenCalledTimes(1);
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0]!;
    // Sub-30 page is blanked (Rust chunker then skips it); good page kept.
    expect(call[1]).toEqual(['a clean confident scan page', '']);
    // Its confidence is cleared too, so the array stays aligned with pages.
    expect(call[7]).toEqual([85, undefined]);
    expect(r.indexed).toBe(true);
  });

  it('(b) indexes a page exactly at the threshold (>= 30) and preserves its OCR confidence', async () => {
    // A page at exactly OCR_SKIP_CONFIDENCE is KEPT (gate is strictly "<").
    // Its confidence rides along so the chunk still carries extraction=("ocr",conf).
    mockExtraction(['', ''], true);
    vi.mocked(ocrPageImage)
      .mockResolvedValueOnce({ text: 'boundary page text', confidence: OCR_SKIP_CONFIDENCE })
      .mockResolvedValueOnce({ text: 'clearly confident page', confidence: 90 });

    await MemoryService.indexPdfFile('/w/scan.pdf', ws(), '/w');

    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0]!;
    expect(call[1]).toEqual(['boundary page text', 'clearly confident page']);
    // Both confidences survive — the extraction marker is intact for both pages.
    expect(call[7]).toEqual([OCR_SKIP_CONFIDENCE, 90]);
  });

  it('(c) leaves the 30–60 low-confidence disclosure band untouched', async () => {
    // A page at 45 sits in the disclose band: kept AND its confidence preserved
    // so the citation UI still labels it a "low-confidence scan" (< 60).
    mockExtraction([''], true);
    vi.mocked(ocrPageImage).mockResolvedValueOnce({ text: 'midband scan page', confidence: 45 });

    const r = await MemoryService.indexPdfFile('/w/scan.pdf', ws(), '/w');

    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0]!;
    expect(call[1]).toEqual(['midband scan page']);
    expect(call[7]).toEqual([45]);
    expect(r.indexed).toBe(true);
  });

  it('(d) a fully-garbage scan (all pages < 30) is an honest skip, not a silent empty index', async () => {
    mockExtraction(['', ''], true);
    vi.mocked(ocrPageImage)
      .mockResolvedValueOnce({ text: 'n0ise', confidence: 15 })
      .mockResolvedValueOnce({ text: 'm0re n0ise', confidence: 22 });

    const r = await MemoryService.indexPdfFile('/w/garbage.pdf', ws(), '/w');

    // Nothing survived the gate and there is no native text -> never index a
    // broken empty result; report a scanned-equivalent reason instead.
    expect(ragIndexPdfChunks).not.toHaveBeenCalled();
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('scanned-low-confidence');
    // Stale rows for the path are cleared so a previously-good index can't orphan.
    expect(ragDeletePdfPath).toHaveBeenCalledWith('/w/garbage.pdf', '/w', 0);
    // The OCR worker heap is still returned after the (failed) read.
    expect(destroyOcrClient).toHaveBeenCalledTimes(1);
  });

  it('(d2) an all-failed scan (every OCR page threw) reports ocr-failed, not low-confidence', async () => {
    // OCR ran but every page render/recognition threw: confidences stay
    // undefined and no page was dropped by the < 30 gate. The honest reason is
    // an OCR failure, NOT a low-confidence scan — otherwise a real engine fault
    // hides behind the low-confidence label.
    mockExtraction(['', ''], true);
    vi.mocked(ocrPageImage).mockRejectedValue(new Error('worker crashed'));

    const r = await MemoryService.indexPdfFile('/w/broken.pdf', ws(), '/w');

    expect(ragIndexPdfChunks).not.toHaveBeenCalled();
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('ocr-failed');
    expect(ragDeletePdfPath).toHaveBeenCalledWith('/w/broken.pdf', '/w', 0);
  });

  it('(e) a sub-30 OCR page never costs a mixed file its native pages', async () => {
    // Native page 1 + image-only page 2 OCR'd at 18. Page 2 is dropped, but the
    // native page must still index (the gate only touches OCR-read pages).
    mockExtraction([NATIVE_PAGE_TEXT, ''], false);
    vi.mocked(ocrPageImage).mockResolvedValueOnce({ text: 'low conf garbage', confidence: 18 });

    const r = await MemoryService.indexPdfFile('/w/mixed.pdf', ws(), '/w');

    expect(ragIndexPdfChunks).toHaveBeenCalledTimes(1);
    const call = vi.mocked(ragIndexPdfChunks).mock.calls[0]!;
    expect(call[1]).toEqual([NATIVE_PAGE_TEXT, '']);
    expect(call[7]).toEqual([undefined, undefined]);
    expect(r.indexed).toBe(true);
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

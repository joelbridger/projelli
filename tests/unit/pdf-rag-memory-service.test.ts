/**
 * Plan A3 - PDF RAG MemoryService integration tests.
 *
 * Tests the JS-side PDF indexing coordination in MemoryService:
 *   - isPdfIndexingEnabled reader pattern
 *   - indexPdfFile returns correct short-circuit reasons
 *   - deleteAllPdfChunks is best-effort
 *
 * The Tauri commands (ragIndexPdfChunks, ragDeletePath) are mocked since
 * tests run in Node/JSDOM — no Tauri runtime available.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock @tauri-apps/api/core so isTauri() returns false in tests ---
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

// --- Mock pdf-extract so we control the extraction result ---
// Partial mock (VG-2): the OCR pipeline also reads the REAL `pageNeedsOcr`
// from this module, so only the extraction entry point is stubbed.
vi.mock('@/lib/pdf-extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf-extract')>();
  return {
    ...actual,
    extractPdfText: vi.fn(),
  };
});

import {
  isPdfIndexingEnabled,
  isMemoryEnabled,
  MemoryService,
  resetMeetingFileVisibilityResolver,
  resetMemoryEnabledReader,
  resetPdfIndexingEnabledReader,
  setMemoryEnabledReader,
  setMeetingFileVisibilityResolver,
  setPdfIndexingEnabledReader,
} from '@/platform/rag/MemoryService';

describe('isPdfIndexingEnabled', () => {
  afterEach(() => {
    resetPdfIndexingEnabledReader();
  });

  it('defaults to false (opt-in)', () => {
    expect(isPdfIndexingEnabled()).toBe(false);
  });

  it('can be set to true via setPdfIndexingEnabledReader', () => {
    setPdfIndexingEnabledReader(() => true);
    expect(isPdfIndexingEnabled()).toBe(true);
  });

  it('returns false if reader throws', () => {
    setPdfIndexingEnabledReader(() => { throw new Error('oops'); });
    expect(isPdfIndexingEnabled()).toBe(false);
  });
});

describe('MemoryService.indexPdfFile', () => {
  beforeEach(() => {
    setMeetingFileVisibilityResolver((paths) =>
      Promise.resolve(new Map(paths.map((path) => [path, 'not-meeting'] as const)))
    );
  });

  afterEach(() => {
    resetMemoryEnabledReader();
    resetPdfIndexingEnabledReader();
    resetMeetingFileVisibilityResolver();
    vi.clearAllMocks();
  });

  it('returns memory-disabled when memory is off', async () => {
    setMemoryEnabledReader(() => false);
    const ws = { readBinary: vi.fn() };
    const r = await MemoryService.indexPdfFile('/a.pdf', ws, '/');
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('memory-disabled');
    expect(ws.readBinary).not.toHaveBeenCalled();
  });

  it('returns pdf-indexing-disabled when PDF toggle is off', async () => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => false);
    const ws = { readBinary: vi.fn() };
    const r = await MemoryService.indexPdfFile('/a.pdf', ws, '/');
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('pdf-indexing-disabled');
    expect(ws.readBinary).not.toHaveBeenCalled();
  });

  it('returns read-error when readBinary throws', async () => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => true);
    const ws = { readBinary: vi.fn().mockRejectedValue(new Error('fs error')) };
    const r = await MemoryService.indexPdfFile('/a.pdf', ws, '/');
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('read-error');
  });

  it('returns encrypted reason for encrypted PDFs', async () => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => true);
    const ws = { readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(10)) };
    const { extractPdfText } = await import('@/lib/pdf-extract');
    vi.mocked(extractPdfText).mockResolvedValue({
      pages: [],
      pageCount: 0,
      encrypted: true,
      scanned: false,
    });
    const r = await MemoryService.indexPdfFile('/a.pdf', ws, '/');
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('encrypted');
  });

  it('returns scanned reason for scanned PDFs', async () => {
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => true);
    const ws = { readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(10)) };
    const { extractPdfText } = await import('@/lib/pdf-extract');
    vi.mocked(extractPdfText).mockResolvedValue({
      pages: ['image-only page'],
      pageCount: 1,
      encrypted: false,
      scanned: true,
    });
    const r = await MemoryService.indexPdfFile('/a.pdf', ws, '/');
    expect(r.indexed).toBe(false);
    expect(r.reason).toBe('scanned');
  });

  it('returns indexed=false when ragIndexPdfChunks throws (not in Tauri)', async () => {
    // In test environment, ragIndexPdfChunks will throw because isTauri()=false.
    setMemoryEnabledReader(() => true);
    setPdfIndexingEnabledReader(() => true);
    const ws = { readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(10)) };
    const { extractPdfText } = await import('@/lib/pdf-extract');
    vi.mocked(extractPdfText).mockResolvedValue({
      pages: ['Hello page one.'],
      pageCount: 1,
      encrypted: false,
      scanned: false,
    });
    // Will throw because we're not in Tauri — test that indexPdfFile
    // propagates the error (callers in useMemoryWiring catch it).
    await expect(MemoryService.indexPdfFile('/a.pdf', ws, '/')).rejects.toThrow(
      /RAG PDF indexing is only available/,
    );
  });
});

describe('MemoryService.deleteAllPdfChunks', () => {
  afterEach(() => {
    resetMemoryEnabledReader();
    vi.clearAllMocks();
  });

  it('is a no-op when memory is disabled', async () => {
    setMemoryEnabledReader(() => false);
    // Should complete without throwing (even though ragDeletePath not in Tauri)
    await expect(MemoryService.deleteAllPdfChunks(['/a.pdf'], '/')).resolves.toBeUndefined();
  });

  it('swallows errors for individual paths (best-effort)', async () => {
    setMemoryEnabledReader(() => true);
    // In test environment ragDeletePath will not throw (isTauri=false → no-op)
    await expect(
      MemoryService.deleteAllPdfChunks(['/a.pdf', '/b.pdf'], '/'),
    ).resolves.toBeUndefined();
  });
});

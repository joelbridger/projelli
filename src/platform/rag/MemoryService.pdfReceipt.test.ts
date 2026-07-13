import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  activeNativeWorkspace,
  bulkForget,
  deletePdfPath,
  extractPdfText,
  indexPdfChunks,
  isOcrEngineAvailable,
  manifestForget,
  manifestRecord,
  ocrPageImage,
  pageNeedsOcr,
  renderPdfPageToPng,
  setWorkspaceNative,
} = vi.hoisted(() => ({
  activeNativeWorkspace: { activation: 0, current: '' },
  bulkForget: vi.fn(),
  deletePdfPath: vi.fn<() => Promise<void>>(),
  extractPdfText: vi.fn(),
  indexPdfChunks: vi.fn(),
  isOcrEngineAvailable: vi.fn(),
  manifestForget: vi.fn<() => Promise<void>>(),
  manifestRecord: vi.fn<() => Promise<void>>(),
  ocrPageImage: vi.fn(),
  pageNeedsOcr: vi.fn(),
  renderPdfPageToPng: vi.fn(),
  setWorkspaceNative: vi.fn(),
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    ragDeletePdfPath: deletePdfPath,
    ragIndexPdfChunks: indexPdfChunks,
    ragManifestForgetPdf: manifestForget,
    ragManifestForgetPdfs: bulkForget,
    ragManifestRecordPdf: manifestRecord,
    ragSetWorkspace: setWorkspaceNative,
  };
});

vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText,
  pageNeedsOcr,
  renderPdfPageToPng,
}));

vi.mock('@/platform/rag/ocr/ocrEngine', () => ({
  destroyOcrClient: vi.fn().mockResolvedValue(undefined),
  isOcrEngineAvailable,
  ocrPageImage,
}));

import {
  MemoryService,
  resetPdfIndexingEnabledReader,
  setPdfIndexingEnabledReader,
} from '@/platform/rag/MemoryService';

beforeEach(async () => {
  activeNativeWorkspace.current = '';
  activeNativeWorkspace.activation = 0;
  setWorkspaceNative.mockReset().mockImplementation((path: string) => {
    if (path !== activeNativeWorkspace.current) {
      activeNativeWorkspace.current = path;
      activeNativeWorkspace.activation += 1;
    }
    return Promise.resolve(activeNativeWorkspace.activation);
  });
  deletePdfPath.mockReset().mockResolvedValue(undefined);
  bulkForget.mockReset().mockImplementation(
    (expectedWorkspace: string, expectedActivation: number) => {
      if (
        expectedWorkspace !== activeNativeWorkspace.current ||
        expectedActivation !== activeNativeWorkspace.activation
      ) {
        return Promise.reject(new Error('workspace changed; refusing stale PDF cleanup'));
      }
      return Promise.resolve();
    }
  );
  indexPdfChunks.mockReset().mockImplementation((...args: unknown[]) => {
    const expectedWorkspace = args[3];
    const expectedActivation = args[4];
    if (
      expectedWorkspace !== activeNativeWorkspace.current ||
      expectedActivation !== activeNativeWorkspace.activation
    ) {
      return Promise.reject(new Error('workspace changed; refusing stale PDF write'));
    }
    return Promise.resolve(1);
  });
  manifestRecord.mockReset().mockResolvedValue(undefined);
  manifestForget.mockReset().mockResolvedValue(undefined);
  extractPdfText.mockReset().mockResolvedValue({
    encrypted: true,
    pageCount: 3,
    pages: [],
    scanned: false,
  });
  pageNeedsOcr.mockReset().mockReturnValue(false);
  isOcrEngineAvailable.mockReset().mockReturnValue(true);
  renderPdfPageToPng.mockReset().mockResolvedValue(new Uint8Array([1]));
  ocrPageImage.mockReset().mockRejectedValue(new Error('temporary OCR failure'));
  await MemoryService.setWorkspace('C:/workspace');
});

afterEach(() => {
  resetPdfIndexingEnabledReader();
});

describe('MemoryService PDF persistence receipts', () => {
  it('remembers an unchanged encrypted PDF as checked but intentionally unsearchable', async () => {
    setPdfIndexingEnabledReader(() => true);

    const result = await MemoryService.indexPdfFile(
      'C:/workspace/private.pdf',
      {
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      },
      'C:/workspace'
    );

    expect(result).toEqual({
      indexed: false,
      pageCount: 3,
      reason: 'encrypted',
    });
    expect(deletePdfPath).toHaveBeenCalledWith(
      'C:/workspace/private.pdf',
      'C:/workspace',
      activeNativeWorkspace.activation
    );
    expect(manifestRecord).toHaveBeenCalledWith(
      'C:/workspace/private.pdf',
      3,
      true,
      'C:/workspace',
      activeNativeWorkspace.activation,
      'unassigned',
      'none',
      true
    );
  });

  it('does not save an empty receipt when stale search rows could not be removed', async () => {
    setPdfIndexingEnabledReader(() => true);
    deletePdfPath.mockRejectedValueOnce(new Error('delete failed'));

    const result = await MemoryService.indexPdfFile(
      'C:/workspace/private.pdf',
      {
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      },
      'C:/workspace'
    );

    expect(result.reason).toBe('encrypted');
    expect(manifestRecord).not.toHaveBeenCalled();
  });

  it('does not remember a temporary OCR failure as permanently empty', async () => {
    setPdfIndexingEnabledReader(() => true);
    extractPdfText.mockResolvedValue({
      encrypted: false,
      pageCount: 1,
      pages: [''],
      scanned: true,
    });
    pageNeedsOcr.mockReturnValue(true);

    const result = await MemoryService.indexPdfFile(
      'C:/workspace/scan.pdf',
      {
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      },
      'C:/workspace'
    );

    expect(result.reason).toBe('ocr-failed');
    expect(deletePdfPath).toHaveBeenCalledWith(
      'C:/workspace/scan.pdf',
      'C:/workspace',
      activeNativeWorkspace.activation
    );
    expect(manifestForget).toHaveBeenCalledWith(
      'C:/workspace/scan.pdf',
      'C:/workspace',
      activeNativeWorkspace.activation
    );
    expect(manifestRecord).not.toHaveBeenCalled();
  });

  it('does not remember a scan as empty when its OCR engine is temporarily unavailable', async () => {
    setPdfIndexingEnabledReader(() => true);
    extractPdfText.mockResolvedValue({
      encrypted: false,
      pageCount: 1,
      pages: [''],
      scanned: true,
    });
    pageNeedsOcr.mockReturnValue(true);
    isOcrEngineAvailable.mockReturnValue(false);

    const result = await MemoryService.indexPdfFile(
      'C:/workspace/engine-wait.pdf',
      {
        readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      },
      'C:/workspace'
    );

    expect(result.reason).toBe('scanned');
    expect(deletePdfPath).toHaveBeenCalledWith(
      'C:/workspace/engine-wait.pdf',
      'C:/workspace',
      activeNativeWorkspace.activation
    );
    expect(manifestForget).toHaveBeenCalledWith(
      'C:/workspace/engine-wait.pdf',
      'C:/workspace',
      activeNativeWorkspace.activation
    );
    expect(manifestRecord).not.toHaveBeenCalled();
  });

  it('refuses to save an old workspace PDF after a switch', async () => {
    setPdfIndexingEnabledReader(() => true);
    await MemoryService.setWorkspace('C:/workspace-A');
    let finishExtraction!: (value: {
      encrypted: boolean;
      pageCount: number;
      pages: string[];
      scanned: boolean;
    }) => void;
    extractPdfText.mockReturnValue(
      new Promise((resolve) => {
        finishExtraction = resolve;
      })
    );

    const indexing = MemoryService.indexPdfFile(
      'C:/workspace-A/slow.pdf',
      { readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)) },
      'C:/workspace-A'
    );
    await Promise.resolve();
    await MemoryService.setWorkspace('C:/workspace-B');
    finishExtraction({
      encrypted: false,
      pageCount: 1,
      pages: ['native text from workspace A'],
      scanned: false,
    });

    await expect(indexing).rejects.toThrow('workspace changed');
    expect(indexPdfChunks).toHaveBeenCalledWith(
      'C:/workspace-A/slow.pdf',
      ['native text from workspace A'],
      1,
      'C:/workspace-A',
      activeNativeWorkspace.activation - 1,
      'unassigned',
      'none',
      undefined
    );
    expect(manifestRecord).not.toHaveBeenCalled();
  });

  it('deletes partial rows and fails when an old receipt cannot be invalidated', async () => {
    setPdfIndexingEnabledReader(() => true);
    extractPdfText.mockResolvedValue({
      encrypted: false,
      pageCount: 2,
      pages: ['native page', ''],
      scanned: false,
    });
    pageNeedsOcr.mockImplementation((text: string) => text.length === 0);
    manifestForget.mockRejectedValueOnce(new Error('receipt save failed'));

    await expect(
      MemoryService.indexPdfFile(
        'C:/workspace/mixed.pdf',
        { readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)) },
        'C:/workspace'
      )
    ).rejects.toThrow('receipt save failed');

    expect(indexPdfChunks).toHaveBeenCalled();
    expect(deletePdfPath).toHaveBeenCalledWith(
      'C:/workspace/mixed.pdf',
      'C:/workspace',
      activeNativeWorkspace.activation
    );
    expect(manifestRecord).not.toHaveBeenCalled();
  });

  it('cannot erase the new workspace receipts when toggle-off cleanup crosses a switch', async () => {
    await MemoryService.setWorkspace('C:/workspace-A');
    const oldActivation = activeNativeWorkspace.activation;
    deletePdfPath.mockImplementationOnce(async () => {
      await MemoryService.setWorkspace('C:/workspace-B');
    });

    await expect(
      MemoryService.deleteAllPdfChunks(
        ['C:/workspace-A/old.pdf'],
        'C:/workspace-A'
      )
    ).rejects.toThrow('workspace changed');

    expect(bulkForget).toHaveBeenCalledWith('C:/workspace-A', oldActivation);
    expect(activeNativeWorkspace.current).toBe('C:/workspace-B');
  });
});

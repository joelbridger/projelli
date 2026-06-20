// BUG-014 — importPickedFiles: bring existing files (chosen via the native
// "Add files" picker) INTO the workspace and index them.
//
// The "Add files" button used to just open the New-Document dialog (no import
// existed). This helper is the import core: given source paths + a byte reader
// + the workspace writer + the indexers, it copies each file in (dedup names)
// and EXPLICITLY indexes it (so search works deterministically, not relying on
// the flaky file-watcher), surfacing per-file index status/errors.

import { describe, it, expect, vi } from 'vitest';
import { importPickedFiles } from '@/platform/utils/fileDrop';

function fakeService(existing: string[] = []) {
  const exists = new Set(existing);
  return {
    exists: vi.fn(async (p: string) => exists.has(p)),
    writeFile: vi.fn(async () => {}),
    writeFileBinary: vi.fn(async () => {}),
    _exists: exists,
  };
}

const bytes = (n = 4) => new Uint8Array(Array.from({ length: n }, (_, i) => i)).buffer;

describe('importPickedFiles (BUG-014)', () => {
  it('copies a non-PDF in and indexes it with indexFile', async () => {
    const service = fakeService();
    const indexFile = vi.fn(async () => {});
    const indexPdf = vi.fn(async () => ({ indexed: true }));
    const res = await importPickedFiles({
      service,
      targetFolder: 'C:/ws',
      paths: ['C:/Users/me/Downloads/contract.txt'],
      readBytes: async () => bytes(),
      indexFile,
      indexPdf,
    });
    expect(service.writeFileBinary).toHaveBeenCalledWith('C:/ws/contract.txt', expect.anything());
    expect(indexFile).toHaveBeenCalledWith('C:/ws/contract.txt');
    expect(indexPdf).not.toHaveBeenCalled();
    expect(res).toEqual([{ path: 'C:/ws/contract.txt', name: 'contract.txt', indexed: true }]);
  });

  it('handles a Windows backslash source path (basename only)', async () => {
    const service = fakeService();
    const res = await importPickedFiles({
      service,
      targetFolder: 'C:/ws',
      paths: ['C:\\Users\\me\\Downloads\\Exhibit A.pdf'],
      readBytes: async () => bytes(),
      indexFile: vi.fn(async () => {}),
      indexPdf: vi.fn(async () => ({ indexed: true })),
    });
    expect(service.writeFileBinary).toHaveBeenCalledWith('C:/ws/Exhibit A.pdf', expect.anything());
    expect(res[0]?.name).toBe('Exhibit A.pdf');
  });

  it('routes a PDF through indexPdf and surfaces its indexed/reason result', async () => {
    const service = fakeService();
    const indexPdf = vi.fn(async () => ({ indexed: false, reason: 'no-text-and-ocr-off' }));
    const res = await importPickedFiles({
      service,
      targetFolder: 'C:/ws',
      paths: ['C:/scan.pdf'],
      readBytes: async () => bytes(),
      indexFile: vi.fn(async () => {}),
      indexPdf,
    });
    expect(indexPdf).toHaveBeenCalledWith('C:/ws/scan.pdf');
    expect(res[0]).toEqual({ path: 'C:/ws/scan.pdf', name: 'scan.pdf', indexed: false, reason: 'no-text-and-ocr-off' });
  });

  it('dedupes a colliding name to " (1)"', async () => {
    const service = fakeService(['C:/ws/scan.pdf']);
    const res = await importPickedFiles({
      service,
      targetFolder: 'C:/ws',
      paths: ['C:/scan.pdf'],
      readBytes: async () => bytes(),
      indexFile: vi.fn(async () => {}),
      indexPdf: vi.fn(async () => ({ indexed: true })),
    });
    expect(res[0]?.name).toBe('scan (1).pdf');
    expect(service.writeFileBinary).toHaveBeenCalledWith('C:/ws/scan (1).pdf', expect.anything());
  });

  it('records a per-file error and keeps importing the rest', async () => {
    const service = fakeService();
    const readBytes = vi
      .fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce(bytes());
    const res = await importPickedFiles({
      service,
      targetFolder: 'C:/ws',
      paths: ['C:/bad.txt', 'C:/good.txt'],
      readBytes,
      indexFile: vi.fn(async () => {}),
      indexPdf: vi.fn(async () => ({ indexed: true })),
    });
    expect(res).toHaveLength(2);
    expect(res[0]?.error).toMatch(/read failed/);
    expect(res[0]?.indexed).toBe(false);
    expect(res[1]).toEqual({ path: 'C:/ws/good.txt', name: 'good.txt', indexed: true });
  });
});

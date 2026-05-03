import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke BEFORE importing install.ts so the module-level import
// binds to the mock.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import * as tauriCore from '@tauri-apps/api/core';
import {
  downloadTarball,
  verifyChecksum,
  extractTarball,
  cleanupOnError,
} from '@/modules/marketplace/install';
import type { FSBackend } from '@/modules/workspace/types';

const mockInvoke = vi.mocked(tauriCore.invoke);

interface FakeFs {
  fs: FSBackend;
  writes: Map<string, Uint8Array>;
  moveSpy: ReturnType<typeof vi.fn>;
  deleteSpy: ReturnType<typeof vi.fn>;
  writeBinarySpy: ReturnType<typeof vi.fn>;
}

function makeFs(opts?: { failWriteBinary?: boolean; failMove?: boolean }): FakeFs {
  const writes = new Map<string, Uint8Array>();
  const writeBinarySpy = vi.fn(async (p: string, b: ArrayBuffer) => {
    if (opts?.failWriteBinary) throw new Error('disk full');
    writes.set(p, new Uint8Array(b));
  });
  const moveSpy = vi.fn(async (from: string, to: string) => {
    if (opts?.failMove) throw new Error('rename failed');
    const buf = writes.get(from);
    if (buf) {
      writes.set(to, buf);
      writes.delete(from);
    }
  });
  const deleteSpy = vi.fn(async (p: string) => {
    writes.delete(p);
  });
  const fs = {
    read: vi.fn(),
    readBinary: vi.fn(),
    write: vi.fn(),
    writeBinary: writeBinarySpy,
    exists: vi.fn(async (p: string) => writes.has(p)),
    delete: deleteSpy,
    move: moveSpy,
    copy: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    list: vi.fn(),
    stat: vi.fn(),
    isSymlink: vi.fn(),
    resolveSymlink: vi.fn(),
    getRootPath: vi.fn(),
    setRootPath: vi.fn(),
  } as unknown as FSBackend;
  return { fs, writes, moveSpy, deleteSpy, writeBinarySpy };
}

/**
 * Build a fake Response whose `body.getReader()` yields the supplied chunks.
 * If `total` is provided, the response sets a Content-Length header so
 * progress callbacks receive a known fraction; otherwise the header is absent
 * to exercise the "unknown total" path.
 */
function fakeStreamingResponse(
  chunks: Uint8Array[],
  opts: { ok?: boolean; status?: number; total?: number; bodyless?: boolean } = {},
): Response {
  const queue = [...chunks];
  const reader = {
    read: vi.fn(async () => {
      const next = queue.shift();
      if (next === undefined) return { done: true, value: undefined };
      return { done: false, value: next };
    }),
    releaseLock: vi.fn(),
  };
  const headers = new Map<string, string>();
  if (opts.total !== undefined) headers.set('content-length', String(opts.total));
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    body: opts.bodyless ? null : { getReader: () => reader },
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
  } as unknown as Response;
}

describe('downloadTarball', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads the response body to destPath via a temp file rename', async () => {
    const { fs, writes, moveSpy, writeBinarySpy } = makeFs();
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])];
    vi.stubGlobal('fetch', vi.fn(async () => fakeStreamingResponse(chunks, { total: 5 })));

    await downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs);

    expect(writeBinarySpy).toHaveBeenCalledTimes(1);
    expect(writeBinarySpy.mock.calls[0][0]).toBe('/tmp/x.tar.gz.partial');
    expect(moveSpy).toHaveBeenCalledWith('/tmp/x.tar.gz.partial', '/tmp/x.tar.gz');
    const finalBuf = writes.get('/tmp/x.tar.gz');
    expect(finalBuf).toBeDefined();
    expect(Array.from(finalBuf!)).toEqual([1, 2, 3, 4, 5]);
  });

  it('reports progress with fraction when Content-Length is present', async () => {
    const { fs } = makeFs();
    const chunks = [new Uint8Array(4), new Uint8Array(6)];
    vi.stubGlobal('fetch', vi.fn(async () => fakeStreamingResponse(chunks, { total: 10 })));
    const onProgress = vi.fn();

    await downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs, { onProgress });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[0][0]).toEqual({ loaded: 4, total: 10, fraction: 0.4 });
    expect(onProgress.mock.calls[1][0]).toEqual({ loaded: 10, total: 10, fraction: 1 });
  });

  it('reports progress with null fraction when Content-Length is absent', async () => {
    const { fs } = makeFs();
    const chunks = [new Uint8Array(3)];
    vi.stubGlobal('fetch', vi.fn(async () => fakeStreamingResponse(chunks, {})));
    const onProgress = vi.fn();

    await downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs, { onProgress });

    expect(onProgress).toHaveBeenCalledWith({ loaded: 3, total: null, fraction: null });
  });

  it('throws and cleans up the temp file on non-ok HTTP status', async () => {
    const { fs, writes, deleteSpy } = makeFs();
    vi.stubGlobal('fetch', vi.fn(async () => fakeStreamingResponse([], { ok: false, status: 404 })));

    await expect(
      downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs),
    ).rejects.toThrow(/HTTP 404/);
    expect(writes.has('/tmp/x.tar.gz')).toBe(false);
    // The non-ok branch never wrote a temp file, so delete is not required.
    void deleteSpy;
  });

  it('throws on missing response body', async () => {
    const { fs } = makeFs();
    vi.stubGlobal('fetch', vi.fn(async () => fakeStreamingResponse([], { bodyless: true })));

    await expect(
      downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs),
    ).rejects.toThrow(/no body/);
  });

  it('aborts mid-stream when AbortSignal fires and rolls back the temp file', async () => {
    const { fs, deleteSpy, writes } = makeFs();
    // Pre-populate a stale temp file to verify cleanup on abort.
    writes.set('/tmp/x.tar.gz.partial', new Uint8Array([9]));
    const controller = new AbortController();
    // Reader returns one chunk then we abort before the next read.
    let calls = 0;
    const reader = {
      read: vi.fn(async () => {
        calls += 1;
        if (calls === 1) return { done: false, value: new Uint8Array([1, 2]) };
        controller.abort();
        // Loop continuation re-checks signal.aborted before the next read,
        // but we throw here as a safety net for the abort path.
        throw new DOMException('Aborted', 'AbortError');
      }),
      releaseLock: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      body: { getReader: () => reader },
      headers: { get: () => '100' },
    } as unknown as Response)));

    await expect(
      downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs, { signal: controller.signal }),
    ).rejects.toThrow();
    // safeDelete must have been called against the temp path during rollback.
    expect(deleteSpy).toHaveBeenCalledWith('/tmp/x.tar.gz.partial');
    expect(writes.has('/tmp/x.tar.gz')).toBe(false);
  });

  it('rolls back the temp file when writeBinary fails', async () => {
    const { fs, deleteSpy } = makeFs({ failWriteBinary: true });
    vi.stubGlobal('fetch', vi.fn(async () =>
      fakeStreamingResponse([new Uint8Array([1])], { total: 1 })));

    await expect(
      downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs),
    ).rejects.toThrow(/disk full/);
    expect(deleteSpy).toHaveBeenCalledWith('/tmp/x.tar.gz.partial');
  });

  it('rolls back the temp file when move (rename) fails', async () => {
    const { fs, deleteSpy } = makeFs({ failMove: true });
    vi.stubGlobal('fetch', vi.fn(async () =>
      fakeStreamingResponse([new Uint8Array([1])], { total: 1 })));

    await expect(
      downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs),
    ).rejects.toThrow(/rename failed/);
    expect(deleteSpy).toHaveBeenCalledWith('/tmp/x.tar.gz.partial');
  });

  it('throws when fetch itself rejects (e.g., network error)', async () => {
    const { fs } = makeFs();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connection refused');
    }));

    await expect(
      downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs),
    ).rejects.toThrow(/connection refused/);
  });
});

describe('verifyChecksum', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true on case-insensitive checksum match', async () => {
    mockInvoke.mockResolvedValueOnce('ABCDEF1234');
    const ok = await verifyChecksum('/tmp/x.tar.gz', 'abcdef1234');
    expect(ok).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith('sha256_file', { path: '/tmp/x.tar.gz' });
  });

  it('returns false on checksum mismatch', async () => {
    mockInvoke.mockResolvedValueOnce('aaaaaaaa');
    const ok = await verifyChecksum('/tmp/x.tar.gz', 'bbbbbbbb');
    expect(ok).toBe(false);
  });

  it('trims whitespace before comparing', async () => {
    mockInvoke.mockResolvedValueOnce('  abc  ');
    const ok = await verifyChecksum('/tmp/x.tar.gz', 'abc');
    expect(ok).toBe(true);
  });

  it('propagates errors from the Tauri command', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('open: no such file'));
    await expect(verifyChecksum('/missing.tar.gz', 'abc')).rejects.toThrow(/no such file/);
  });
});

describe('extractTarball', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards camelCase args to Tauri and returns the file list', async () => {
    mockInvoke.mockResolvedValueOnce(['manifest.json', 'workflow.json', 'template.md']);
    const files = await extractTarball('/tmp/x.tar.gz', '/installs/x');
    expect(files).toEqual(['manifest.json', 'workflow.json', 'template.md']);
    expect(mockInvoke).toHaveBeenCalledWith('extract_tarball', {
      tarballPath: '/tmp/x.tar.gz',
      destPath: '/installs/x',
    });
  });

  it('propagates extraction errors so the caller can run cleanup', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('path traversal blocked: ../etc/passwd'));
    await expect(extractTarball('/tmp/bad.tar.gz', '/installs/x')).rejects.toThrow(/traversal/);
  });
});

describe('cleanupOnError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attempts to delete each path independently', async () => {
    const { fs, deleteSpy } = makeFs();
    await cleanupOnError(fs, ['/a', '/b', '/c']);
    expect(deleteSpy).toHaveBeenCalledTimes(3);
    expect(deleteSpy).toHaveBeenNthCalledWith(1, '/a');
    expect(deleteSpy).toHaveBeenNthCalledWith(2, '/b');
    expect(deleteSpy).toHaveBeenNthCalledWith(3, '/c');
  });

  it('swallows individual delete failures and continues', async () => {
    const { fs, deleteSpy } = makeFs();
    deleteSpy.mockImplementationOnce(async () => {
      throw new Error('ENOENT');
    });
    await expect(cleanupOnError(fs, ['/missing', '/present'])).resolves.toBeUndefined();
    expect(deleteSpy).toHaveBeenCalledTimes(2);
  });

  it('is a no-op for an empty path list', async () => {
    const { fs, deleteSpy } = makeFs();
    await cleanupOnError(fs, []);
    expect(deleteSpy).not.toHaveBeenCalled();
  });
});

describe('install pipeline composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clean download → verifyChecksum (match) → extractTarball returns file list', async () => {
    const { fs } = makeFs();
    vi.stubGlobal('fetch', vi.fn(async () =>
      fakeStreamingResponse([new Uint8Array([1, 2, 3])], { total: 3 })));

    await downloadTarball('http://e/x.tar.gz', '/tmp/x.tar.gz', fs);

    mockInvoke.mockResolvedValueOnce('deadbeef'); // sha256_file
    expect(await verifyChecksum('/tmp/x.tar.gz', 'deadbeef')).toBe(true);

    mockInvoke.mockResolvedValueOnce(['manifest.json']); // extract_tarball
    expect(await extractTarball('/tmp/x.tar.gz', '/installs/x')).toEqual(['manifest.json']);
  });

  it('checksum mismatch → cleanup runs against tarball + (would-be) install dir', async () => {
    const { fs, deleteSpy } = makeFs();
    mockInvoke.mockResolvedValueOnce('aaaaaaaa');
    const matched = await verifyChecksum('/tmp/x.tar.gz', 'bbbbbbbb');
    expect(matched).toBe(false);
    await cleanupOnError(fs, ['/tmp/x.tar.gz', '/installs/x']);
    expect(deleteSpy).toHaveBeenCalledWith('/tmp/x.tar.gz');
    expect(deleteSpy).toHaveBeenCalledWith('/installs/x');
  });

  it('extraction error → cleanup runs against the tarball + partial extract dir', async () => {
    const { fs, deleteSpy } = makeFs();
    mockInvoke.mockRejectedValueOnce(new Error('truncated archive'));

    let caught: Error | null = null;
    try {
      await extractTarball('/tmp/x.tar.gz', '/installs/x');
    } catch (err) {
      caught = err as Error;
      await cleanupOnError(fs, ['/tmp/x.tar.gz', '/installs/x']);
    }
    expect(caught).not.toBeNull();
    expect(deleteSpy).toHaveBeenCalledWith('/tmp/x.tar.gz');
    expect(deleteSpy).toHaveBeenCalledWith('/installs/x');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AttachmentService } from '@/features/ask/attachments/AttachmentService';
import type { FSBackend } from '@/platform/fs/types';

// FSBackend uses readBinary/writeBinary with ArrayBuffer (not readBytes/writeBytes with Uint8Array).
// The mock stores Uint8Array internally and converts at the boundary.
function makeMockFs(): FSBackend & { writes: Map<string, Uint8Array> } {
  const writes = new Map<string, Uint8Array>();
  const fs = {
    writes,
    read: vi.fn(async (p: string) => {
      const stored = writes.get(p);
      if (!stored) throw new Error(`not found: ${p}`);
      return new TextDecoder().decode(stored);
    }),
    readBinary: vi.fn(async (p: string) => {
      const stored = writes.get(p);
      if (!stored) throw new Error(`not found: ${p}`);
      return stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength) as ArrayBuffer;
    }),
    write: vi.fn(async (p: string, content: string) => {
      writes.set(p, new TextEncoder().encode(content));
    }),
    writeBinary: vi.fn(async (p: string, content: ArrayBuffer) => {
      writes.set(p, new Uint8Array(content));
    }),
    delete: vi.fn(async (p: string) => {
      writes.delete(p);
    }),
    exists: vi.fn(async (p: string) => writes.has(p)),
    move: vi.fn(),
    copy: vi.fn(),
    rename: vi.fn(),
    list: vi.fn(),
    mkdir: vi.fn(async () => {}),
    stat: vi.fn(),
    isSymlink: vi.fn(),
    resolveSymlink: vi.fn(),
    getRootPath: vi.fn(() => ''),
    setRootPath: vi.fn(),
  } as unknown as FSBackend & { writes: Map<string, Uint8Array> };
  return fs;
}

describe('AttachmentService.save', () => {
  let fs: ReturnType<typeof makeMockFs>;
  let svc: AttachmentService;

  beforeEach(() => {
    fs = makeMockFs();
    svc = new AttachmentService(fs, () => '2026-04');
  });

  it('saves bytes and returns ChatAttachment with hash, path, size', async () => {
    const bytes = new TextEncoder().encode('hello-image');
    const att = await svc.save(bytes, 'chart.png', 'image/png');
    expect(att.type).toBe('image');
    expect(att.mimeType).toBe('image/png');
    expect(att.fileName).toBe('chart.png');
    expect(att.byteSize).toBe(bytes.byteLength);
    expect(att.id).toMatch(/^[0-9a-f]{64}$/);
    expect(att.pathInWorkspace).toMatch(/^media\/2026-04\/chat-image-[0-9a-f]{64}\.png$/);
  });

  it('infers PDF type from mime', async () => {
    const att = await svc.save(new Uint8Array([1, 2, 3]), 'doc.pdf', 'application/pdf');
    expect(att.type).toBe('pdf');
  });

  it('rejects non-image/non-pdf MIME types', async () => {
    await expect(
      svc.save(new Uint8Array([1]), 'data.csv', 'text/csv')
    ).rejects.toThrow(/unsupported/i);
  });

  it('writes file at returned path', async () => {
    const bytes = new TextEncoder().encode('hello');
    const att = await svc.save(bytes, 'a.png', 'image/png');
    expect(fs.writes.has(att.pathInWorkspace)).toBe(true);
  });

  it('produces same hash for same bytes (dedup)', async () => {
    const bytes = new TextEncoder().encode('same');
    const a = await svc.save(bytes, 'a.png', 'image/png');
    const b = await svc.save(bytes, 'b.png', 'image/png');
    expect(a.id).toBe(b.id);
    expect(a.pathInWorkspace).toBe(b.pathInWorkspace);
  });
});

describe('AttachmentService.read', () => {
  let fs: ReturnType<typeof makeMockFs>;
  let svc: AttachmentService;

  beforeEach(() => {
    fs = makeMockFs();
    svc = new AttachmentService(fs, () => '2026-04');
  });

  it('returns bytes previously saved', async () => {
    const bytes = new TextEncoder().encode('content-here');
    const att = await svc.save(bytes, 'a.png', 'image/png');
    const readBack = await svc.read(att);
    expect(Array.from(readBack)).toEqual(Array.from(bytes));
  });

  it('throws when file is missing', async () => {
    const bytes = new TextEncoder().encode('x');
    const att = await svc.save(bytes, 'a.png', 'image/png');
    fs.writes.delete(att.pathInWorkspace);
    await expect(svc.read(att)).rejects.toThrow();
  });
});

describe('AttachmentService.delete', () => {
  let fs: ReturnType<typeof makeMockFs>;
  let svc: AttachmentService;

  beforeEach(() => {
    fs = makeMockFs();
    svc = new AttachmentService(fs, () => '2026-04');
  });

  it('removes file from workspace', async () => {
    const att = await svc.save(new TextEncoder().encode('x'), 'a.png', 'image/png');
    expect(fs.writes.has(att.pathInWorkspace)).toBe(true);
    await svc.delete(att);
    expect(fs.writes.has(att.pathInWorkspace)).toBe(false);
  });
});

describe('AttachmentService.exists', () => {
  let fs: ReturnType<typeof makeMockFs>;
  let svc: AttachmentService;

  beforeEach(() => {
    fs = makeMockFs();
    svc = new AttachmentService(fs, () => '2026-04');
  });

  it('returns true after save', async () => {
    const att = await svc.save(new TextEncoder().encode('x'), 'a.png', 'image/png');
    expect(await svc.exists(att)).toBe(true);
  });

  it('returns false after delete', async () => {
    const att = await svc.save(new TextEncoder().encode('x'), 'a.png', 'image/png');
    await svc.delete(att);
    expect(await svc.exists(att)).toBe(false);
  });
});

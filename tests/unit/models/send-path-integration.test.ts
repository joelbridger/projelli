/**
 * Stream A1 — Send-path integration test.
 *
 * Verifies the full path from AttachmentService → provider send call:
 * saves an image via AttachmentService, reads it back, formats it,
 * and confirms the resulting bytes make it into the provider's API envelope.
 *
 * Uses the same mock-FS pattern as AttachmentService.test.ts.
 * Uses MockProvider's getLastSendAttachments() to assert the bytes arrived.
 */

import { describe, it, expect, vi } from 'vitest';
import { AttachmentService } from '@/features/ask/attachments/AttachmentService';
import { MockProvider } from '@/platform/providers/MockProvider';
import type { FSBackend } from '@/platform/fs/types';
import type { AttachmentBytes } from '@/platform/providers/Provider';

// Minimal PNG bytes
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function makeMockFs(): FSBackend & { writes: Map<string, Uint8Array> } {
  const writes = new Map<string, Uint8Array>();
  return {
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
    delete: vi.fn(async (p: string) => { writes.delete(p); }),
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
}

describe('Full attachment send-path integration', () => {
  it('saves → reads → passes bytes to provider sendMessage', async () => {
    const fs = makeMockFs();
    const svc = new AttachmentService(fs, () => '2026-04');

    // 1. Save the file (simulates what ChatInputToolbar / handleFilesSelected does)
    const att = await svc.save(PNG_BYTES, 'screenshot.png', 'image/png');

    // 2. Read the bytes back (simulates what AIChatViewer does before sending)
    const bytes = await svc.read(att);

    // 3. Build the AttachmentBytes payload
    const attachmentBytes: AttachmentBytes[] = [{ att, bytes }];

    // 4. Call MockProvider.sendMessage with the payload
    const provider = new MockProvider();
    await provider.sendMessage('What is in this screenshot?', { attachmentBytes });

    // 5. Assert the provider received the exact bytes
    const recorded = provider.getLastSendAttachments();
    expect(recorded).not.toBeNull();
    expect(recorded!).toHaveLength(1);
    expect(recorded![0].att.id).toBe(att.id);
    expect(Array.from(recorded![0].bytes)).toEqual(Array.from(PNG_BYTES));
  });

  it('saves → reads → passes bytes to provider sendMessageStreaming', async () => {
    const fs = makeMockFs();
    const svc = new AttachmentService(fs, () => '2026-04');

    const att = await svc.save(PNG_BYTES, 'chart.png', 'image/png');
    const bytes = await svc.read(att);

    const attachmentBytes: AttachmentBytes[] = [{ att, bytes }];
    const provider = new MockProvider();

    const chunks: string[] = [];
    await provider.sendMessageStreaming('Describe this chart.', {
      onChunk: (c) => chunks.push(c),
      attachmentBytes,
    });

    const recorded = provider.getLastSendAttachments();
    expect(recorded!).toHaveLength(1);
    expect(recorded![0].att.mimeType).toBe('image/png');
    // Chunks should have been emitted (mock streams the response text)
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('formatAttachmentForRequest on read bytes produces valid Claude block', async () => {
    // Simulate the AIChatViewer calling provider.formatAttachmentForRequest
    // with bytes that came from AttachmentService.read().
    const provider = new MockProvider();

    const att = {
      id: 'test-hash',
      type: 'image' as const,
      mimeType: 'image/png',
      fileName: 'test.png',
      pathInWorkspace: 'media/2026-04/chat-image-test-hash.png',
      byteSize: PNG_BYTES.length,
      metadata: {},
    };

    const block = await provider.formatAttachmentForRequest(att, PNG_BYTES) as any;
    expect(block.type).toBe('image');
    expect(block.source?.type).toBe('base64');
    expect(block.source?.data).toBe('MOCK_BASE64');

    // Also verify the call was recorded
    expect(provider.getLastFormattedAttachment()).toEqual({
      att,
      bytesLength: PNG_BYTES.length,
    });
  });

  it('zero attachments → provider receives no attachmentBytes', async () => {
    const provider = new MockProvider();
    await provider.sendMessage('Text only message.', {});
    expect(provider.getLastSendAttachments()).toBeNull();
  });
});

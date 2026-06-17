import { describe, it, expect } from 'vitest';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import type { ChatAttachment } from '@/platform/types/ai';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header

const imageAtt: ChatAttachment = {
  id: 'abc123',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-abc123.png',
  byteSize: 4,
  metadata: { width: 100, height: 100 },
};

const pdfAtt: ChatAttachment = {
  id: 'def456',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'doc.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-def456.pdf',
  byteSize: 1024,
  metadata: {},
};

function makeProvider(model: string) {
  return new ClaudeProvider({ apiKey: 'test-key', model });
}

describe('ClaudeProvider.formatAttachmentForRequest (image)', () => {
  it('returns Claude image block shape', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES);
    expect(block).toMatchObject({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
      },
    });
  });

  it('base64 data encodes the bytes correctly', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    const decoded = atob(block.source.data);
    expect(decoded.charCodeAt(0)).toBe(0x89);
    expect(decoded.charCodeAt(1)).toBe(0x50);
  });

  it('returns ClaudeDocumentBlock for pdf on a native-capable model (A2)', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = provider.formatAttachmentForRequest(pdfAtt, new Uint8Array([0x25, 0x50])) as any;
    expect(block.type).toBe('document');
    expect(block.source?.type).toBe('base64');
    expect(block.source?.media_type).toBe('application/pdf');
  });
});

describe('ClaudeProvider.supportsAttachment', () => {
  it('returns true for vision model + image', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    expect(provider.supportsAttachment(imageAtt, 'claude-3-5-sonnet-20241022')).toBe(true);
  });

  it('returns error string for text-only model (claude-3-5-haiku)', () => {
    const provider = makeProvider('claude-3-5-haiku-20251001');
    const result = provider.supportsAttachment(imageAtt, 'claude-3-5-haiku-20251001');
    expect(typeof result).toBe('string');
    expect(result).not.toBe('');
  });

  it('returns true for pdf on native-capable model (A2)', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const result = provider.supportsAttachment(pdfAtt, 'claude-3-5-sonnet-20241022');
    expect(result).toBe(true);
  });
});

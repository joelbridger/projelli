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
  it('blocks an image when local OCR text is unavailable', async () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    await expect(provider.formatAttachmentForRequest(imageAtt, PNG_BYTES))
      .rejects.toThrow('unscannable_attachment');
  });

  it('allows the original image bytes after clean local OCR text is supplied', async () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    await expect(provider.formatAttachmentForRequest(imageAtt, PNG_BYTES, 'A clean chart title'))
      .resolves.toMatchObject({ type: 'image' });
  });

  it('blocks an image whose local OCR finds a secret because pixels cannot be redacted yet', async () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    await expect(provider.formatAttachmentForRequest(imageAtt, PNG_BYTES, 'access_token=image-secret'))
      .rejects.toThrow('prompt_review_required');
  });

  it('blocks an unreadable PDF before native upload', async () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    await expect(provider.formatAttachmentForRequest(pdfAtt, new Uint8Array([0x25, 0x50])))
      .rejects.toThrow('unscannable_attachment');
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

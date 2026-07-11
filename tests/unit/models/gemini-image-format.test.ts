import { describe, it, expect } from 'vitest';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import type { ChatAttachment } from '@/platform/types/ai';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const imageAtt: ChatAttachment = {
  id: 'abc123',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-abc123.png',
  byteSize: 4,
  metadata: {},
};

function makeProvider(model: string) {
  return new GeminiProvider({ apiKey: 'test-key', model });
}

describe('GeminiProvider.formatAttachmentForRequest (image)', () => {
  it('blocks an image when local OCR text is unavailable', async () => {
    const provider = makeProvider('gemini-1.5-flash');
    await expect(provider.formatAttachmentForRequest(imageAtt, PNG_BYTES))
      .rejects.toThrow('unscannable_attachment');
  });
});

describe('GeminiProvider.supportsAttachment', () => {
  it('returns true for gemini-1.5-flash + image', () => {
    const provider = makeProvider('gemini-1.5-flash');
    expect(provider.supportsAttachment(imageAtt, 'gemini-1.5-flash')).toBe(true);
  });

  it('returns error string for gemini-pro (no version) + image', () => {
    const provider = makeProvider('gemini-pro');
    const result = provider.supportsAttachment(imageAtt, 'gemini-pro');
    expect(typeof result).toBe('string');
  });

  it('gemini-2.0-flash supports images', () => {
    const provider = makeProvider('gemini-2.0-flash');
    expect(provider.supportsAttachment(imageAtt, 'gemini-2.0-flash')).toBe(true);
  });
});

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
  it('returns inlineData block', async () => {
    const provider = makeProvider('gemini-1.5-flash');
    const block = await provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(block).toMatchObject({
      inlineData: {
        mimeType: 'image/png',
      },
    });
  });

  it('inlineData.data is base64 of bytes', async () => {
    const provider = makeProvider('gemini-1.5-flash');
    const block = await provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(atob(block.inlineData.data).charCodeAt(0)).toBe(0x89);
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

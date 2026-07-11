import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
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
  return new OpenAIProvider({ apiKey: 'test-key', model });
}

describe('OpenAIProvider.formatAttachmentForRequest (image)', () => {
  it('blocks an image when local OCR text is unavailable', async () => {
    const provider = makeProvider('gpt-4o');
    await expect(provider.formatAttachmentForRequest(imageAtt, PNG_BYTES))
      .rejects.toThrow('unscannable_attachment');
  });

  it('passes the original image bytes after clean local OCR text', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(imageAtt, PNG_BYTES, 'Clean chart title');
    expect(block).toMatchObject({ type: 'image_url' });
    expect((block as { image_url: { url: string } }).image_url.url)
      .toContain('iVBORw==');
  });

  it('blocks an image when local OCR finds a secret', async () => {
    const provider = makeProvider('gpt-4o');
    await expect(provider.formatAttachmentForRequest(imageAtt, PNG_BYTES, 'access_token=image-secret'))
      .rejects.toThrow('prompt_review_required');
  });
});

describe('OpenAIProvider.supportsAttachment', () => {
  it('returns true for gpt-4o + image', () => {
    const provider = makeProvider('gpt-4o');
    expect(provider.supportsAttachment(imageAtt, 'gpt-4o')).toBe(true);
  });

  it('returns error string for gpt-3.5-turbo + image', () => {
    const provider = makeProvider('gpt-3.5-turbo');
    const result = provider.supportsAttachment(imageAtt, 'gpt-3.5-turbo');
    expect(typeof result).toBe('string');
    expect(result).not.toBe('');
  });

  it('o1 model supports images', () => {
    const provider = makeProvider('o1');
    expect(provider.supportsAttachment(imageAtt, 'o1')).toBe(true);
  });
});

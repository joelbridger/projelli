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
  it('returns image_url block with data URL', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(block.type).toBe('image_url');
    expect(block.image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it('data URL contains correct base64', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    const b64 = block.image_url.url.split(',')[1];
    expect(atob(b64).charCodeAt(0)).toBe(0x89);
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

import { describe, it, expect } from 'vitest';
import { OllamaProvider } from '@/modules/models/OllamaProvider';
import type { ChatAttachment } from '@/types/ai';

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
  return new OllamaProvider({ model });
}

describe('OllamaProvider.formatAttachmentForRequest (image)', () => {
  it('returns OllamaImagesPayload sentinel', async () => {
    const provider = makeProvider('llava:13b');
    const block = await provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(Array.isArray(block._ollama_images)).toBe(true);
    expect(block._ollama_images).toHaveLength(1);
  });

  it('_ollama_images[0] is base64 of bytes', async () => {
    const provider = makeProvider('llava:13b');
    const block = await provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    expect(atob(block._ollama_images[0]).charCodeAt(0)).toBe(0x89);
  });
});

describe('OllamaProvider.supportsAttachment', () => {
  it('returns true for llava model + image', () => {
    const provider = makeProvider('llava:13b');
    expect(provider.supportsAttachment(imageAtt, 'llava:13b')).toBe(true);
  });

  it('returns error string for llama3.2:3b + image', () => {
    const provider = makeProvider('llama3.2:3b');
    const result = provider.supportsAttachment(imageAtt, 'llama3.2:3b');
    expect(typeof result).toBe('string');
    expect(result).not.toBe('');
  });

  it('qwen2.5-vl:7b is vision-capable', () => {
    const provider = makeProvider('qwen2.5-vl:7b');
    expect(provider.supportsAttachment(imageAtt, 'qwen2.5-vl:7b')).toBe(true);
  });
});

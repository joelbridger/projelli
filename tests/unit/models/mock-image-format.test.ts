import { describe, it, expect } from 'vitest';
import { MockProvider } from '@/platform/providers/MockProvider';
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

describe('MockProvider.formatAttachmentForRequest', () => {
  it('records the call and returns a stub block', () => {
    const provider = new MockProvider();
    const block = provider.formatAttachmentForRequest(imageAtt, PNG_BYTES) as any;
    // Mock returns a minimal valid structure to satisfy type checks.
    expect(block).toBeDefined();
    expect(provider.getLastFormattedAttachment()).toEqual({
      att: imageAtt,
      bytesLength: PNG_BYTES.length,
    });
  });
});

describe('MockProvider.supportsAttachment', () => {
  it('always returns true', () => {
    const provider = new MockProvider();
    expect(provider.supportsAttachment(imageAtt, 'mock-model')).toBe(true);
  });
});

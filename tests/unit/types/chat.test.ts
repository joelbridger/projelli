import { describe, it, expect } from 'vitest';
import type { ChatAttachment, ChatMessage } from '@/types/ai';

describe('ChatAttachment type', () => {
  it('accepts a fully-populated image attachment', () => {
    const att: ChatAttachment = {
      id: 'sha256-abc',
      type: 'image',
      mimeType: 'image/png',
      fileName: 'chart.png',
      pathInWorkspace: 'media/2026-04/chat-image-abc.png',
      byteSize: 12345,
      metadata: { width: 1024, height: 768 },
    };
    expect(att.type).toBe('image');
  });

  it('accepts a PDF attachment with native extraction mode', () => {
    const att: ChatAttachment = {
      id: 'sha256-def',
      type: 'pdf',
      mimeType: 'application/pdf',
      fileName: 'contract.pdf',
      pathInWorkspace: 'media/2026-04/chat-pdf-def.pdf',
      byteSize: 540000,
      metadata: { pages: 12, extractionMode: 'native' },
    };
    expect(att.metadata.pages).toBe(12);
  });

  it('ChatMessage allows omitting attachments', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'hi',
      timestamp: new Date().toISOString(),
    };
    expect(msg.attachments).toBeUndefined();
  });

  it('ChatMessage accepts attachments array', () => {
    const msg: ChatMessage = {
      role: 'user',
      content: 'check this',
      timestamp: new Date().toISOString(),
      attachments: [
        {
          id: 'sha256-abc',
          type: 'image',
          mimeType: 'image/png',
          fileName: 'chart.png',
          pathInWorkspace: 'media/2026-04/chat-image-abc.png',
          byteSize: 12345,
          metadata: {},
        },
      ],
    };
    expect(msg.attachments).toHaveLength(1);
  });
});

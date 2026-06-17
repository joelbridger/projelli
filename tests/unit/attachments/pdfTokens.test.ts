import { describe, it, expect } from 'vitest';
import { estimatePdfTokens } from '@/features/ask/attachments/pdfTokens';
import type { ChatAttachment } from '@/types/ai';

function pdfAtt(pages: number, byteSize = 10000): ChatAttachment {
  return {
    id: 'p1',
    type: 'pdf',
    mimeType: 'application/pdf',
    fileName: 'doc.pdf',
    pathInWorkspace: 'media/2026-04/chat-pdf-p1.pdf',
    byteSize,
    metadata: { pages },
  };
}

describe('estimatePdfTokens — native mode (Claude)', () => {
  it('1 page = 1500 tokens', () => {
    expect(estimatePdfTokens('claude', pdfAtt(1), 'native')).toBe(1500);
  });

  it('5 pages = 7500 tokens', () => {
    expect(estimatePdfTokens('claude', pdfAtt(5), 'native')).toBe(7500);
  });

  it('anthropic alias works the same as claude', () => {
    expect(estimatePdfTokens('anthropic', pdfAtt(3), 'native')).toBe(4500);
  });
});

describe('estimatePdfTokens — text-extract mode', () => {
  it('uses extractedTextLength when provided (1 token per 4 chars)', () => {
    // 400 chars → 100 tokens
    expect(estimatePdfTokens('claude', pdfAtt(1), 'text-extract', 400)).toBe(100);
    expect(estimatePdfTokens('openai', pdfAtt(1), 'text-extract', 400)).toBe(100);
    expect(estimatePdfTokens('gemini', pdfAtt(1), 'text-extract', 400)).toBe(100);
  });

  it('falls back to 400 tokens/page when text length is unavailable', () => {
    expect(estimatePdfTokens('claude', pdfAtt(2), 'text-extract')).toBe(800);
    expect(estimatePdfTokens('openai', pdfAtt(2), 'text-extract')).toBe(800);
  });

  it('falls back when extractedTextLength is 0', () => {
    // 0-length text (scanned PDF) falls back to page estimate
    expect(estimatePdfTokens('claude', pdfAtt(1), 'text-extract', 0)).toBe(400);
  });

  it('rounds up fractional tokens', () => {
    // 401 chars → ceil(401/4) = 101
    expect(estimatePdfTokens('openai', pdfAtt(1), 'text-extract', 401)).toBe(101);
  });
});

describe('estimatePdfTokens — free providers', () => {
  it('ollama returns 0 regardless of mode', () => {
    expect(estimatePdfTokens('ollama', pdfAtt(5), 'text-extract')).toBe(0);
    expect(estimatePdfTokens('ollama', pdfAtt(5), 'native')).toBe(0);
  });

  it('mock returns 0', () => {
    expect(estimatePdfTokens('mock', pdfAtt(3), 'text-extract')).toBe(0);
  });
});

describe('estimatePdfTokens — guard', () => {
  it('returns 0 for non-pdf attachment', () => {
    const img: ChatAttachment = {
      id: 'i1',
      type: 'image',
      mimeType: 'image/png',
      fileName: 'test.png',
      pathInWorkspace: 'media/2026-04/chat-image-i1.png',
      byteSize: 1000,
      metadata: {},
    };
    expect(estimatePdfTokens('claude', img, 'native')).toBe(0);
  });
});

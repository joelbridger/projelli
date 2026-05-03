import { describe, it, expect, vi } from 'vitest';
import { GeminiProvider } from '@/modules/models/GeminiProvider';
import type { ChatAttachment } from '@/types/ai';

vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    pages: ['Gemini page content.'],
    pageCount: 1,
    encrypted: false,
    scanned: false,
  }),
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const pdfAtt: ChatAttachment = {
  id: 'pdf003',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'report.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf003.pdf',
  byteSize: 4,
  metadata: { pages: 1 },
};

function makeProvider(model: string) {
  return new GeminiProvider({ apiKey: 'test-key', model });
}

describe('GeminiProvider.formatAttachmentForRequest (PDF)', () => {
  it('returns a TextExtractBlock', async () => {
    const provider = makeProvider('gemini-1.5-pro');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract).toBeDefined();
    expect(block._text_extract.text).toContain('Gemini page content.');
    expect(block._text_extract.pageCount).toBe(1);
    expect(block._text_extract.fileName).toBe('report.pdf');
  });
});

describe('GeminiProvider.supportsAttachment (PDF)', () => {
  it('returns true (text-extract works for all Gemini models)', () => {
    const provider = makeProvider('gemini-1.5-pro');
    expect(provider.supportsAttachment(pdfAtt, 'gemini-1.5-pro')).toBe(true);
  });
});

describe('GeminiProvider.supportsNativePdf', () => {
  it('always returns false', () => {
    const provider = makeProvider('gemini-1.5-pro');
    expect(provider.supportsNativePdf!('gemini-1.5-pro')).toBe(false);
  });
});

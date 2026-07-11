import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import type { ChatAttachment } from '@/platform/types/ai';
import { extractPdfText } from '@/lib/pdf-extract';

// Mock pdf-extract so tests do not need a real PDF.js environment.
vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    pages: ['Page one text content.', 'Page two text content.'],
    pageCount: 2,
    encrypted: false,
    scanned: false,
  }),
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const pdfAtt: ChatAttachment = {
  id: 'pdf002',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'deck.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf002.pdf',
  byteSize: 4,
  metadata: { pages: 2 },
};

function makeProvider(model: string) {
  return new OpenAIProvider({ apiKey: 'test-key', model });
}

describe('OpenAIProvider.formatAttachmentForRequest (PDF)', () => {
  it('returns a TextExtractBlock shape', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract).toBeDefined();
  });

  it('includes the extracted text in the block', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract.text).toContain('Page one text content.');
    expect(block._text_extract.text).toContain('Page two text content.');
  });

  it('includes pageCount in the block', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract.pageCount).toBe(2);
  });

  it('includes fileName in the block', async () => {
    const provider = makeProvider('gpt-4o');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract.fileName).toBe('deck.pdf');
  });

  it('blocks extracted PDF text containing a private link before upload', async () => {
    vi.mocked(extractPdfText).mockResolvedValueOnce({
      pages: ['https://example.test/i/abc#intake-secret'],
      pageCount: 1,
      encrypted: false,
      scanned: false,
    });
    const provider = makeProvider('gpt-4o');
    await expect(provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES))
      .rejects.toThrow('prompt_review_required');
  });
});

describe('OpenAIProvider.supportsAttachment (PDF)', () => {
  it('returns true for gpt-4o + PDF (text-extract works universally)', () => {
    const provider = makeProvider('gpt-4o');
    expect(provider.supportsAttachment(pdfAtt, 'gpt-4o')).toBe(true);
  });

  it('returns true for gpt-3.5-turbo + PDF', () => {
    const provider = makeProvider('gpt-3.5-turbo');
    expect(provider.supportsAttachment(pdfAtt, 'gpt-3.5-turbo')).toBe(true);
  });
});

describe('OpenAIProvider.supportsNativePdf', () => {
  it('always returns false', () => {
    const provider = makeProvider('gpt-4o');
    expect(provider.supportsNativePdf!('gpt-4o')).toBe(false);
  });
});

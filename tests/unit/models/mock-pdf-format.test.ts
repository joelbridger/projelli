import { describe, it, expect, vi } from 'vitest';
import { MockProvider } from '@/platform/providers/MockProvider';
import type { ChatAttachment } from '@/platform/types/ai';

vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    pages: ['Mock extracted text page one.'],
    pageCount: 1,
    encrypted: false,
    scanned: false,
  }),
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const pdfAtt: ChatAttachment = {
  id: 'pdf005',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'mock.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf005.pdf',
  byteSize: 4,
  metadata: { pages: 1 },
};

describe('MockProvider.formatAttachmentForRequest (PDF)', () => {
  it('returns a TextExtractBlock', async () => {
    const provider = new MockProvider();
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract).toBeDefined();
    expect(block._text_extract.text).toContain('Mock extracted text page one.');
    expect(block._text_extract.fileName).toBe('mock.pdf');
  });

  it('records the call for later inspection', async () => {
    const provider = new MockProvider();
    await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES);
    expect(provider.attachmentCallLog).toHaveLength(1);
    expect(provider.attachmentCallLog[0]!.att.type).toBe('pdf');
  });
});

describe('MockProvider.supportsAttachment (PDF)', () => {
  it('returns true (mock supports all attachment types)', () => {
    const provider = new MockProvider();
    expect(provider.supportsAttachment(pdfAtt, 'mock-model')).toBe(true);
  });
});

describe('MockProvider.supportsNativePdf', () => {
  it('returns false (mock always uses text-extract for deterministic testing)', () => {
    const provider = new MockProvider();
    expect(provider.supportsNativePdf!('mock-model')).toBe(false);
  });
});

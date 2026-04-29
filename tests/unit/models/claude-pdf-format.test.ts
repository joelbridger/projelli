import { describe, it, expect } from 'vitest';
import { ClaudeProvider } from '@/modules/models/ClaudeProvider';
import type { ChatAttachment } from '@/types/ai';

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // '%PDF' magic bytes

const pdfAtt: ChatAttachment = {
  id: 'pdf001',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'contract.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf001.pdf',
  byteSize: 4,
  metadata: { pages: 3 },
};

function makeProvider(model: string) {
  return new ClaudeProvider({ apiKey: 'test-key', model });
}

describe('ClaudeProvider.formatAttachmentForRequest (PDF, native model)', () => {
  it('returns a ClaudeDocumentBlock shape', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block.type).toBe('document');
    expect(block.source.type).toBe('base64');
    expect(block.source.media_type).toBe('application/pdf');
  });

  it('encodes PDF bytes as base64', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    const decoded = atob(block.source.data);
    // First byte of PDF_BYTES is 0x25 ('%')
    expect(decoded.charCodeAt(0)).toBe(0x25);
  });

  it('claude-sonnet-4-6 also returns native PDF block', () => {
    const provider = makeProvider('claude-sonnet-4-6');
    const block = provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block.type).toBe('document');
  });
});

describe('ClaudeProvider.formatAttachmentForRequest (PDF, text-extract model)', () => {
  it('throws when called with PDF bytes on Haiku (text-extract path - caller should use extractPdfText instead)', () => {
    // Haiku does not support native PDF. The caller (AIChatViewer) is
    // responsible for calling extractPdfText and injecting text for Haiku.
    // formatAttachmentForRequest for Haiku PDF should throw a clear error
    // so callers detect the misconfiguration.
    const provider = makeProvider('claude-3-haiku-20240307');
    expect(() => provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES))
      .toThrow(/haiku.*text.extract|use text.extract/i);
  });
});

describe('ClaudeProvider.supportsAttachment (PDF)', () => {
  it('returns true for native-capable Sonnet model', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    expect(provider.supportsAttachment(pdfAtt, 'claude-3-5-sonnet-20241022')).toBe(true);
  });

  it('returns true for claude-sonnet-4-6', () => {
    const provider = makeProvider('claude-sonnet-4-6');
    expect(provider.supportsAttachment(pdfAtt, 'claude-sonnet-4-6')).toBe(true);
  });

  it('returns true even for Haiku (text-extract is still supported; caller decides path)', () => {
    // supportsAttachment returning true for Haiku + PDF means the PDF
    // will be processed via text-extract. The mode chip indicates which
    // path was used.
    const provider = makeProvider('claude-3-haiku-20240307');
    expect(provider.supportsAttachment(pdfAtt, 'claude-3-haiku-20240307')).toBe(true);
  });
});

describe('ClaudeProvider.supportsNativePdf', () => {
  it('returns true for claude-3-5-sonnet-20241022', () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    expect(provider.supportsNativePdf!('claude-3-5-sonnet-20241022')).toBe(true);
  });

  it('returns false for claude-3-haiku-20240307', () => {
    const provider = makeProvider('claude-3-haiku-20240307');
    expect(provider.supportsNativePdf!('claude-3-haiku-20240307')).toBe(false);
  });
});

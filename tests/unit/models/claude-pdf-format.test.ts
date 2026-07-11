import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import type { ChatAttachment } from '@/platform/types/ai';
import { extractPdfText } from '@/lib/pdf-extract';

vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn(),
}));

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

beforeEach(() => {
  vi.mocked(extractPdfText).mockResolvedValue({
    pages: ['Safe contract text.'], pageCount: 1, encrypted: false, scanned: false,
  });
});

describe('ClaudeProvider.formatAttachmentForRequest (PDF, native model)', () => {
  it('scans locally before returning a native PDF block', async () => {
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block.type).toBe('document');
    expect(extractPdfText).toHaveBeenCalledWith(PDF_BYTES);
  });

  it('blocks a secret-bearing PDF before native upload', async () => {
    vi.mocked(extractPdfText).mockResolvedValue({
      pages: ['Open https://example.test/i/abc#intake-secret'], pageCount: 1, encrypted: false, scanned: false,
    });
    const provider = makeProvider('claude-3-5-sonnet-20241022');
    await expect(provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES))
      .rejects.toThrow('prompt_review_required');
  });
});

describe('ClaudeProvider.formatAttachmentForRequest (PDF, text-extract model)', () => {
  it('still rejects the non-native provider path after a safe local scan', async () => {
    // Haiku does not support native PDF. The caller (AIChatViewer) is
    // responsible for calling extractPdfText and injecting text for Haiku.
    // formatAttachmentForRequest for Haiku PDF should throw a clear error
    // so callers detect the misconfiguration.
    const provider = makeProvider('claude-3-haiku-20240307');
    await expect(provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES))
      .rejects.toThrow(/haiku.*text.extract|use text.extract/i);
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

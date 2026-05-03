import { describe, it, expect, vi } from 'vitest';
import { OllamaProvider } from '@/modules/models/OllamaProvider';
import type { ChatAttachment } from '@/types/ai';

vi.mock('@/lib/pdf-extract', () => ({
  extractPdfText: vi.fn().mockResolvedValue({
    pages: ['Ollama extracted text.'],
    pageCount: 1,
    encrypted: false,
    scanned: false,
  }),
}));

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

const pdfAtt: ChatAttachment = {
  id: 'pdf004',
  type: 'pdf',
  mimeType: 'application/pdf',
  fileName: 'notes.pdf',
  pathInWorkspace: 'media/2026-04/chat-pdf-pdf004.pdf',
  byteSize: 4,
  metadata: { pages: 1 },
};

function makeProvider(model: string) {
  return new OllamaProvider({ model, baseUrl: 'http://localhost:11434' });
}

describe('OllamaProvider.formatAttachmentForRequest (PDF)', () => {
  it('returns a TextExtractBlock', async () => {
    const provider = makeProvider('llama3.2:3b');
    const block = await provider.formatAttachmentForRequest(pdfAtt, PDF_BYTES) as any;
    expect(block._text_extract).toBeDefined();
    expect(block._text_extract.text).toContain('Ollama extracted text.');
  });
});

describe('OllamaProvider.supportsAttachment (PDF)', () => {
  it('returns true for any Ollama model + PDF (text-extract works universally)', () => {
    const provider = makeProvider('llama3.2:3b');
    expect(provider.supportsAttachment(pdfAtt, 'llama3.2:3b')).toBe(true);
  });
});

describe('OllamaProvider.supportsNativePdf', () => {
  it('always returns false', () => {
    const provider = makeProvider('llama3.2:3b');
    expect(provider.supportsNativePdf!('llama3.2:3b')).toBe(false);
  });
});

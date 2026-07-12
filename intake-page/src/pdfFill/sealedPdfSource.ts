import type { PdfFillRequestItem } from '@/platform/intake/types';

const SEALED_PDF_SOURCE_MAX_BYTES = 50 * 1024 * 1024;
const SEALED_PDF_SOURCE_MAX_BASE64_CHARS = Math.ceil(SEALED_PDF_SOURCE_MAX_BYTES / 3) * 4;

/** Decodes a sealed source only after its encoded size has passed the device guard. */
export function sealedPdfSourceBytes(item: PdfFillRequestItem): Uint8Array | undefined {
  const candidate = (item as PdfFillRequestItem & { sealed_source_pdf_b64?: unknown }).sealed_source_pdf_b64;
  if (typeof candidate !== 'string' || candidate.length === 0) return undefined;
  if (candidate.length > SEALED_PDF_SOURCE_MAX_BASE64_CHARS) return undefined;
  try {
    const binary = atob(candidate);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

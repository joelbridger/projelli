import type { PdfFillRequestItem, PdfTemplateDescriptor } from '@/platform/intake/types';
import { bytesToB64 } from '@/platform/intake/pageSeal';
import { sha256Hex } from '@/platform/intake/pdfTemplates/receipt';
import { assertValidPdfTemplateDescriptor } from '@/platform/intake/pdfTemplates/templateValidation';

/** Creates a sealed-by-value draft item, never a live link to the library. */
export async function createPdfFillDraftItem(
  template: PdfTemplateDescriptor,
  sourceBytes: Uint8Array,
): Promise<PdfFillRequestItem> {
  assertValidPdfTemplateDescriptor(template);
  if (await sha256Hex(sourceBytes) !== template.sourceSha256) {
    throw new Error('Source PDF bytes do not match the approved template hash.');
  }
  return {
    t: 'pdf_fill',
    item_id: `pdf_${template.templateId}_${String(template.version)}`,
    label: 'Form ready',
    help_text: 'Complete the approved form securely.',
    required: true,
    subject: 'household',
    template: structuredClone(template),
    prefill: [],
    sealed_source_pdf_b64: bytesToB64(sourceBytes),
  };
}

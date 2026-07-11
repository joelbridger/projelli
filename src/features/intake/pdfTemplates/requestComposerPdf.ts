import type { PdfFillRequestItem, PdfTemplateDescriptor } from '@/platform/intake/types';
import { assertValidPdfTemplateDescriptor } from '@/platform/intake/pdfTemplates/templateValidation';

/** Creates a sealed-by-value draft item, never a live link to the library. */
export function createPdfFillDraftItem(template: PdfTemplateDescriptor): PdfFillRequestItem {
  assertValidPdfTemplateDescriptor(template);
  return {
    t: 'pdf_fill',
    item_id: `pdf_${template.templateId}_${String(template.version)}`,
    label: 'Form ready',
    help_text: 'Complete the approved form securely.',
    required: true,
    subject: 'household',
    template: structuredClone(template),
    prefill: [],
  };
}

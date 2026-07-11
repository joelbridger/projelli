import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';

import {
  sha256Hex,
  verifyCompletedBytesAgainstReceipt,
  verifySourceBytesAgainstDescriptor,
} from '@/platform/intake/pdfTemplates/receipt';
import type {
  PdfCompletionReceipt,
  PdfFieldMapEntry,
  PdfTemplateDescriptor,
} from '@/platform/intake/types';
import type { PdfOverlayFieldMapEntry } from '@/platform/intake/pdfTemplates/templateContract';

const MAX_SOURCE_PAGES = 50;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const PDF_HEADER = new TextEncoder().encode('%PDF-');
const ACTIVE_PDF_TOKENS = [
  '/JavaScript', '/JS', '/Launch', '/EmbeddedFile', '/RichMedia', '/XFA', '/Sig',
  '/URI', '/GoToR', '/SubmitForm',
] as const;

export class PdfFillValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfFillValidationError';
  }
}

export interface PreparedPdfFillSubmission {
  pdfBytes: Uint8Array;
  file: File;
  receipt: PdfCompletionReceipt;
  contentType: 'application/pdf';
  fileName: string;
}

export interface PreparePdfFillSubmissionInput {
  sourceBytes: Uint8Array;
  template: PdfTemplateDescriptor;
  values: Record<string, string>;
  /** A public build identifier, not a client value or advisor-provided label. */
  pageVersion?: string;
}

function text(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  return PDF_HEADER.every((byte, index) => bytes[index] === byte);
}

/** A deliberately conservative static scan. Any ambiguous active feature is rejected. */
export function assertSafeStaticPdf(bytes: Uint8Array): void {
  if (!hasPdfHeader(bytes)) throw new PdfFillValidationError('This form is not a valid PDF. Contact your advisor.');
  const source = text(bytes);
  for (const token of ACTIVE_PDF_TOKENS) {
    if (source.includes(token)) {
      throw new PdfFillValidationError('This form has an unsupported active feature. Contact your advisor.');
    }
  }
}

function requiredEntry(entry: PdfFieldMapEntry, value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  const checkboxMissing = entry.pdf_field_type === 'checkbox' && trimmed !== 'true' && trimmed !== 'yes' && trimmed !== 'on';
  if (entry.required && (!trimmed || checkboxMissing)) {
    throw new PdfFillValidationError('Please complete every required field before you send this form.');
  }
  return trimmed;
}

function assertValue(entry: PdfFieldMapEntry, raw: string | undefined): string {
  const value = requiredEntry(entry, raw);
  if (!value) return value;
  if ((entry.pdf_field_type === 'number' || entry.pdf_field_type === 'money') && !/^-?(?:\d+|\d*\.\d+)$/u.test(value.replace(/[$,\s]/gu, ''))) {
    throw new PdfFillValidationError('Enter a valid number before you send this form.');
  }
  if (entry.pdf_field_type === 'date' && !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new PdfFillValidationError('Enter a valid date before you send this form.');
  }
  if ((entry.pdf_field_type === 'radio' || entry.pdf_field_type === 'select') && !entry.options.some((option) => option.value === value)) {
    throw new PdfFillValidationError('Choose one of the listed options before you send this form.');
  }
  return value;
}

function parseHexColor(value: string | undefined): ReturnType<typeof rgb> {
  const hex = value?.match(/^#([0-9a-f]{6})$/iu)?.[1] ?? '000000';
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  );
}

async function overlayFont(entry: PdfOverlayFieldMapEntry, doc: PDFDocument): Promise<PDFFont> {
  const font = entry.font.family === 'Times-Roman'
    ? StandardFonts.TimesRoman
    : entry.font.family === 'Courier'
      ? StandardFonts.Courier
      : StandardFonts.Helvetica;
  return doc.embedFont(font);
}

function overlayBox(entry: PdfOverlayFieldMapEntry, page: PDFPage): { x: number; y: number; width: number; height: number } {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const { rect } = entry;
  return {
    x: rect.x * pageWidth,
    // PDF coordinates begin at the bottom. Template coordinates begin at the top.
    y: pageHeight - ((rect.y + rect.height) * pageHeight),
    width: rect.width * pageWidth,
    height: rect.height * pageHeight,
  };
}

function wrappedLines(value: string, font: PDFFont, size: number, width: number): string[] | null {
  const words = value.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return [''];
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
      continue;
    }
    if (!line || font.widthOfTextAtSize(word, size) > width) return null;
    out.push(line);
    line = word;
  }
  out.push(line);
  return out;
}

function drawOverlayValue(page: PDFPage, entry: PdfOverlayFieldMapEntry, value: string, font: PDFFont): void {
  if (!value) return;
  const box = overlayBox(entry, page);
  const size = entry.font.size;
  const color = parseHexColor(entry.font.color);
  if (entry.pdf_field_type === 'checkbox') {
    if (value !== 'true' && value !== 'yes' && value !== 'on') return;
    page.drawText('X', { x: box.x, y: box.y + Math.max(0, (box.height - size) / 2), size, font, color });
    return;
  }
  if (entry.pdf_field_type === 'radio') {
    if (!entry.options.some((option) => option.value === value)) return;
    page.drawText('X', { x: box.x, y: box.y + Math.max(0, (box.height - size) / 2), size, font, color });
    return;
  }
  const lines = wrappedLines(value, font, size, box.width);
  if (!lines || (entry.overflow === 'stop' && lines.length > 1) || lines.length * size * 1.25 > box.height) {
    throw new PdfFillValidationError('One answer does not fit in this form. Please contact your advisor for help.');
  }
  lines.forEach((line, index) => {
    const textWidth = font.widthOfTextAtSize(line, size);
    const x = entry.alignment === 'center'
      ? box.x + (box.width - textWidth) / 2
      : entry.alignment === 'right'
        ? box.x + box.width - textWidth
        : box.x;
    page.drawText(line, { x, y: box.y + box.height - size - (index * size * 1.25), size, font, color });
  });
}

function setAcroFormValue(doc: PDFDocument, entry: Extract<PdfFieldMapEntry, { kind: 'acroform' }>, value: string): void {
  const form = doc.getForm();
  if (!value) return;
  switch (entry.pdf_field_type) {
    case 'checkbox':
      if (value === 'true' || value === 'yes' || value === 'on') form.getCheckBox(entry.acroform_field).check();
      else form.getCheckBox(entry.acroform_field).uncheck();
      return;
    case 'radio':
      form.getRadioGroup(entry.acroform_field).select(value);
      return;
    case 'select':
      form.getDropdown(entry.acroform_field).select(value);
      return;
    default:
      form.getTextField(entry.acroform_field).setText(value);
  }
}

function assertNoInteractiveFields(doc: PDFDocument): void {
  if (doc.getForm().getFields().length > 0) {
    throw new PdfFillValidationError('The completed form could not be secured. Please contact your advisor.');
  }
}

function genericFileName(): string {
  const random = globalThis.crypto.getRandomValues(new Uint32Array(2));
  return `completed-form-${random[0]?.toString(16)}${random[1]?.toString(16)}.pdf`;
}

/**
 * Builds the only plaintext file used by the intake path. Callers must submit
 * `file` with the ordinary encrypted `files` payload and keep `receipt` in the
 * encrypted manifest. No bytes or values leave this function in relay metadata.
 */
export async function preparePdfFillSubmission(input: PreparePdfFillSubmissionInput): Promise<PreparedPdfFillSubmission> {
  const { sourceBytes, template, values } = input;
  if (sourceBytes.byteLength === 0 || sourceBytes.byteLength > MAX_SOURCE_BYTES) {
    throw new PdfFillValidationError('This form is too large to open safely. Contact your advisor.');
  }
  await verifySourceBytesAgainstDescriptor(sourceBytes, template);
  assertSafeStaticPdf(sourceBytes);

  const source = await PDFDocument.load(sourceBytes, { ignoreEncryption: false, updateMetadata: false });
  if (source.getPageCount() === 0 || source.getPageCount() > MAX_SOURCE_PAGES) {
    throw new PdfFillValidationError('This form has too many pages to open safely. Contact your advisor.');
  }

  for (const entry of Object.values(template.fields)) assertValue(entry, values[entry.field_id]);

  if (template.kind === 'acroform') {
    for (const entry of Object.values(template.fields)) {
      if (entry.kind !== 'acroform') throw new PdfFillValidationError('This form map is not safe to use. Contact your advisor.');
      setAcroFormValue(source, entry, values[entry.field_id]?.trim() ?? '');
    }
    const font = await source.embedFont(StandardFonts.Helvetica);
    source.getForm().updateFieldAppearances(font);
    source.getForm().flatten();
  } else {
    for (const entry of Object.values(template.fields)) {
      if (entry.kind !== 'overlay') throw new PdfFillValidationError('This form map is not safe to use. Contact your advisor.');
      const page = source.getPages()[entry.page - 1];
      if (!page) throw new PdfFillValidationError('This form map has a missing page. Contact your advisor.');
      drawOverlayValue(page, entry, values[entry.field_id]?.trim() ?? '', await overlayFont(entry, source));
    }
  }

  const completedBytes = new Uint8Array(await source.save({ useObjectStreams: false }));
  if (completedBytes.byteLength > template.maxOutputBytes) {
    throw new PdfFillValidationError('The completed form is too large to send safely. Contact your advisor.');
  }
  assertSafeStaticPdf(completedBytes);
  const verified = await PDFDocument.load(completedBytes, { ignoreEncryption: false, updateMetadata: false });
  if (verified.getPageCount() === 0 || verified.getPageCount() > MAX_SOURCE_PAGES) {
    throw new PdfFillValidationError('The completed form could not be checked safely. Contact your advisor.');
  }
  assertNoInteractiveFields(verified);
  // Re-check the immutable source immediately before finalizing, not only at display time.
  await verifySourceBytesAgainstDescriptor(sourceBytes, template);

  const receipt: PdfCompletionReceipt = {
    templateId: template.templateId,
    templateVersion: template.version,
    sourceSha256: template.sourceSha256,
    completedSha256: await sha256Hex(completedBytes),
    completedAt: new Date().toISOString(),
    pageVersion: input.pageVersion ?? 'intake-page-v8',
  };
  await verifyCompletedBytesAgainstReceipt(completedBytes, receipt, template);
  const fileName = genericFileName();
  const file = new File([completedBytes], fileName, { type: 'application/pdf' });
  return { pdfBytes: completedBytes, file, receipt, contentType: 'application/pdf', fileName };
}

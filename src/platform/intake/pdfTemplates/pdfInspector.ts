import { getDocument } from 'pdfjs-dist';
import { BRAND } from '@/config/brand';

export type InspectedPdfFieldType = 'text' | 'date' | 'checkbox' | 'number' | 'money' | 'radio' | 'select';

export interface InspectedPdfField {
  name: string;
  type: InspectedPdfFieldType;
  options?: Array<{ value: string; label: string }>;
}

export interface PdfInspection {
  kind: 'acroform' | 'overlay';
  pageCount: number;
  fields: InspectedPdfField[];
}

export class PdfImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfImportError';
  }
}

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const MAX_IMPORT_PAGES = 250;

function sourceText(bytes: Uint8Array): string {
  return new TextDecoder('latin1').decode(bytes);
}

/**
 * Reject features Lantern deliberately never interprets. This scan happens
 * before PDF.js is allowed to read the file, so import never follows an action
 * or treats a signature widget as a fill field.
 */
export function assertSafePdfImportSource(bytes: Uint8Array): void {
  if (bytes.byteLength < 8 || bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new PdfImportError('This PDF is empty or too large to review locally.');
  }
  const text = sourceText(bytes);
  if (!text.startsWith('%PDF-') || !text.includes('%%EOF')) {
    throw new PdfImportError('This file is not a complete PDF. Please choose a different file.');
  }
  if (/\/Encrypt\b|\/Filter\s*\/Standard\b/u.test(text)) {
    throw new PdfImportError('Password-protected PDFs cannot be used. Please export an unlocked copy.');
  }
  if (/\/XFA\b|\/NeedsRendering\s+true\b/u.test(text)) {
    throw new PdfImportError('Dynamic XFA PDFs cannot be used. Please export a static PDF.');
  }
  if (/\/ByteRange\b|\/DocMDP\b|\/UR3\b/u.test(text)) {
    throw new PdfImportError('Certificate-signed PDFs cannot be used as a template. Please use an unsigned copy.');
  }
  if (/\/JavaScript\b|\/JS\b|\/Launch\b|\/GoToR\b|\/SubmitForm\b|\/ImportData\b|\/EmbeddedFiles\b|\/RichMedia\b|\/URI\b|\/OpenAction\b/u.test(text)) {
    throw new PdfImportError('This PDF contains active content and cannot be used as a template.');
  }
  if (/\/FT\s*\/Sig\b|\/Subtype\s*\/Widget[^>]{0,600}\/FT\s*\/Sig\b/u.test(text)) {
    throw new PdfImportError('PDFs with signature widgets cannot be used for a fill-only request.');
  }
}

function safeName(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u.test(value) ? value : null;
}

function fieldType(value: unknown): InspectedPdfFieldType | null {
  if (value === 'checkbox') return 'checkbox';
  if (value === 'radiobutton') return 'radio';
  if (value === 'combobox' || value === 'listbox') return 'select';
  if (value === 'text') return 'text';
  return null;
}

/**
 * Structure-only PDF inspection. PDF.js is configured with JavaScript
 * evaluation disabled; this function only asks for AcroForm metadata.
 */
export async function inspectPdfTemplate(bytes: Uint8Array): Promise<PdfInspection> {
  assertSafePdfImportSource(bytes);
  let task: ReturnType<typeof getDocument> | undefined;
  try {
    task = getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      disableFontFace: true,
      disableAutoFetch: true,
      disableRange: true,
      useWorkerFetch: false,
      stopAtErrors: true,
    });
    const pdf = await task.promise;
    if (pdf.numPages < 1 || pdf.numPages > MAX_IMPORT_PAGES) {
      throw new PdfImportError('This PDF has an unsupported number of pages.');
    }
    const objects = await pdf.getFieldObjects();
    const fields = Object.entries(objects ?? {}).flatMap(([name, widgets]) => {
      const safe = safeName(name);
      // PDF.js's public getFieldObjects() shape uses `type`, not `fieldType`.
      // Push buttons intentionally return null below: they are actions, never
      // client-answer fields.
      const widget = widgets[0] as { type?: unknown; items?: unknown[] } | undefined;
      const type = fieldType(widget?.type);
      if (!safe || !type) return [];
      const options = type === 'radio' || type === 'select'
        ? (widget?.items ?? []).flatMap((item) => {
          const option = item as { exportValue?: unknown; displayValue?: unknown };
          const value = typeof option.exportValue === 'string' ? option.exportValue : null;
          const label = typeof option.displayValue === 'string' ? option.displayValue : value;
          return value && label ? [{ value, label }] : [];
        })
        : undefined;
      return [{ name: safe, type, ...(options && options.length >= 2 ? { options } : {}) }];
    });
    return { kind: fields.length > 0 ? 'acroform' : 'overlay', pageCount: pdf.numPages, fields };
  } catch (error) {
    if (error instanceof PdfImportError) throw error;
    throw new PdfImportError(`${BRAND.name} could not safely read this PDF. Please choose a different file.`);
  } finally {
    await task?.destroy();
  }
}

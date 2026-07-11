import type { PdfCompletionReceipt, PdfTemplateDescriptor } from './types';
import { verifyCompletedBytesAgainstReceipt } from './pdfTemplates/receipt';
import {
  assertValidPdfCompletionReceipt,
  verifyReceiptAgainstDescriptor,
} from './pdfTemplates/templateValidation';

type PdfJsDocument = {
  numPages: number;
  isPureXfa: boolean;
  getAttachments(): Promise<unknown>;
  getFieldObjects(): Promise<Record<string, unknown[]> | null>;
  getJSActions(): Promise<Record<string, unknown> | null>;
  hasJSActions(): Promise<boolean>;
  getPage(pageNumber: number): Promise<{
    getAnnotations(options?: { intent?: string }): Promise<Array<Record<string, unknown>>>;
    getJSActions(): Promise<Record<string, unknown>>;
  }>;
  destroy(): Promise<void>;
};

type PdfJsLoadingTask = {
  promise: Promise<PdfJsDocument>;
  destroy(): Promise<void>;
};

type PdfJsModule = {
  getDocument(options: Record<string, unknown>): PdfJsLoadingTask;
};

export interface VerifyPdfFillReceiptOptions {
  completedBytes: Uint8Array;
  receipt: unknown;
  descriptor: PdfTemplateDescriptor | null;
}

const PDF_HEADER = new TextEncoder().encode('%PDF-');
const ACTIVE_PDF_NAME = /\/(?:AcroForm|JavaScript|JS|Launch|EmbeddedFiles?|Filespec|RichMedia|XFA|Sig)\b|\/Subtype\s*\/Widget\b/iu;

function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.byteLength - PDF_HEADER.byteLength, 1024);
  for (let index = 0; index <= limit; index += 1) {
    if (PDF_HEADER.every((value, offset) => bytes[index + offset] === value)) return true;
  }
  return false;
}

function hasPdfEndMarker(bytes: Uint8Array): boolean {
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.byteLength - 2048)));
  return tail.includes('%%EOF');
}

function containsActivePdfNames(bytes: Uint8Array): boolean {
  // This is an additional fail-closed guard. PDF.js below resolves the document
  // structure, while this also catches dangerous names in otherwise unused objects.
  return ACTIVE_PDF_NAME.test(new TextDecoder('latin1').decode(bytes));
}

function hasEntries(value: Record<string, unknown> | null): boolean {
  return value !== null && Object.keys(value).length > 0;
}

function annotationIsActive(annotation: Record<string, unknown>): boolean {
  if (annotation['subtype'] === 'Widget' || annotation['fieldType'] === 'Sig') return true;
  const actions = annotation['actions'];
  return typeof actions === 'object' && actions !== null && Object.keys(actions as object).length > 0;
}

async function loadPdfJs(): Promise<PdfJsModule> {
  // The advisor desktop provides DOMMatrix. This tiny test-only fallback lets
  // PDF.js parse bytes under the Node test runner, where it does not render.
  if (typeof globalThis.DOMMatrix === 'undefined') {
    (globalThis as unknown as { DOMMatrix: typeof DOMMatrix }).DOMMatrix = class DOMMatrix {} as typeof DOMMatrix;
  }
  return await import('pdfjs-dist') as unknown as PdfJsModule;
}

export async function assertSafeFlattenedPdf(completedBytes: Uint8Array): Promise<void> {
  if (!hasPdfHeader(completedBytes) || !hasPdfEndMarker(completedBytes)) {
    throw new Error('Completed form is not a valid PDF file.');
  }
  if (containsActivePdfNames(completedBytes)) {
    throw new Error('Completed form contains interactive or active PDF content.');
  }

  const { getDocument } = await loadPdfJs();
  const loadingTask = getDocument({
    data: new Uint8Array(completedBytes),
    disableWorker: true,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    stopAtErrors: true,
  });
  let document: PdfJsDocument | null = null;
  try {
    document = await loadingTask.promise;
    if (document.isPureXfa) throw new Error('Completed form contains an unsupported XFA form.');
    if (hasEntries(await document.getAttachments())) {
      throw new Error('Completed form contains an attachment.');
    }
    if (hasEntries(await document.getJSActions()) || await document.hasJSActions()) {
      throw new Error('Completed form contains PDF JavaScript.');
    }
    if (hasEntries(await document.getFieldObjects())) {
      throw new Error('Completed form still has interactive fields.');
    }
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      if (hasEntries(await page.getJSActions())) {
        throw new Error('Completed form contains PDF JavaScript.');
      }
      if ((await page.getAnnotations({ intent: 'display' })).some(annotationIsActive)) {
        throw new Error('Completed form contains an interactive or signature field.');
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Completed form')) throw error;
    throw new Error('Completed form could not be parsed safely as a PDF.');
  } finally {
    await document?.destroy();
    await loadingTask.destroy();
  }
}

/** Verifies the sealed receipt, locally recovered descriptor, bytes, and PDF safety. */
export async function verifyPdfFillReceipt(options: VerifyPdfFillReceiptOptions): Promise<void> {
  if (!options.descriptor) {
    throw new Error('This completed form is missing its local approved template.');
  }
  assertValidPdfCompletionReceipt(options.receipt);
  verifyReceiptAgainstDescriptor(options.receipt, options.descriptor);
  await verifyCompletedBytesAgainstReceipt(options.completedBytes, options.receipt, options.descriptor);
  await assertSafeFlattenedPdf(options.completedBytes);
}

export function pdfCompletionReceiptFromManifest(manifest: unknown): PdfCompletionReceipt | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const receipt = (manifest as Record<string, unknown>)['pdf_completion_receipt'];
  return receipt && typeof receipt === 'object' ? receipt as PdfCompletionReceipt : null;
}

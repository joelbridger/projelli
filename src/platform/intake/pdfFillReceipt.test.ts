import { afterEach, describe, expect, it, vi } from 'vitest';

import * as pdfExtractModule from '@/lib/pdf-extract';

import type { PdfCompletionReceipt, PdfTemplateDescriptor } from './types';
import { sha256Hex } from './pdfTemplates/receipt';
import { PdfToolingFailure, assertSafeFlattenedPdf, verifyPdfFillReceipt } from './pdfFillReceipt';

// getDocument can't be vi.spyOn'd directly: pdfjs-dist's real ESM module
// namespace is non-configurable, so Vitest can't redefine it in place. This
// mock wraps the real implementation by default (every other test in this
// file exercises genuine PDF.js parsing through it unchanged) and lets the
// worker-configuration tests below override it per-call to simulate the two
// real PDF.js error shapes without touching PDF.js's own internal caching.
vi.mock('pdfjs-dist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pdfjs-dist')>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});

const enc = new TextEncoder();

function pdf(objects: string[]): Uint8Array {
  let value = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    if (object === undefined) throw new Error('Expected PDF object.');
    offsets.push(enc.encode(value).byteLength);
    value += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = enc.encode(value).byteLength;
  value += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) value += `${String(offset).padStart(10, '0')} 00000 n \n`;
  value += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF\n`;
  return enc.encode(value);
}

function validPdf(extraCatalog = '', extraObjects: string[] = []): Uint8Array {
  return pdf([
    `<< /Type /Catalog /Pages 2 0 R ${extraCatalog} >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    ...extraObjects,
  ]);
}

function descriptor(overrides: Partial<PdfTemplateDescriptor> = {}): PdfTemplateDescriptor {
  return {
    templateId: 'template_approved_01', version: 1, kind: 'acroform',
    sourceSha256: 'a'.repeat(64), sourceArtifactRef: 'sealed-artifact:abcdefghijklmnop',
    outputFileStem: 'completed-form', maxOutputBytes: 1024 * 1024,
    fields: {
      client_name: { kind: 'acroform', field_id: 'client_name', pdf_field_type: 'text', acroform_field: 'client_name' },
    },
    ...overrides,
  };
}

async function receipt(bytes: Uint8Array, template = descriptor()): Promise<PdfCompletionReceipt> {
  return {
    issuedItemId: 'ri_0123456789abcdef0123456789abcdef0123',
    templateId: template.templateId, templateVersion: template.version,
    sourceSha256: template.sourceSha256, completedSha256: await sha256Hex(bytes),
    completedAt: '2026-07-11T12:00:00.000Z', pageVersion: 'w8.1',
  };
}

describe('verifyPdfFillReceipt', () => {
  it('accepts a matching safe flattened PDF', async () => {
    const bytes = validPdf();
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({ completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: approved, expectedItemId: 'ri_0123456789abcdef0123456789abcdef0123' }))
      .resolves.toBeUndefined();
  });

  it('accepts an empty AcroForm shell left by a flattened pdf-lib document', async () => {
    const bytes = validPdf('/AcroForm << /Fields [] >>');
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({ completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: approved, expectedItemId: 'ri_0123456789abcdef0123456789abcdef0123' }))
      .resolves.toBeUndefined();
  });

  it('rejects a changed completed hash, oversize bytes, and another template version', async () => {
    const bytes = validPdf();
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({
      completedBytes: bytes, receipt: { ...await receipt(bytes, approved), completedSha256: 'b'.repeat(64) }, descriptor: approved, expectedItemId: 'ri_0123456789abcdef0123456789abcdef0123',
    })).rejects.toThrow(/receipt hash/iu);
    await expect(verifyPdfFillReceipt({
      completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: descriptor({ maxOutputBytes: 1 }), expectedItemId: 'ri_0123456789abcdef0123456789abcdef0123',
    })).rejects.toThrow(/output size limit/iu);
    await expect(verifyPdfFillReceipt({
      completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: descriptor({ templateId: 'template_approved_02' }), expectedItemId: 'ri_0123456789abcdef0123456789abcdef0123',
    })).rejects.toThrow(/template version/iu);
  });

  it.each([
    ['interactive fields', validPdf('/AcroForm << /Fields [5 0 R] >>', ['<< /Type /Annot /Subtype /Widget /FT /Tx /Rect [0 0 0 0] >>'])],
    ['JavaScript', validPdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>')],
    ['launch action', validPdf('/OpenAction << /S /Launch /F (unsafe.exe) >>')],
    ['attachment', validPdf('/Names << /EmbeddedFiles << >> >>')],
    ['signature widget', validPdf('/AcroForm << /Fields [5 0 R] >>', ['<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] >>'])],
  ])('rejects %s', async (_name, bytes) => {
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({ completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: approved, expectedItemId: 'ri_0123456789abcdef0123456789abcdef0123' }))
      .rejects.toThrow(/interactive|active|attachment/iu);
  });

  it('rejects a name-escaped launch action after PDF.js resolves the catalog action', async () => {
    const bytes = validPdf('/OpenAction << /S /#4c#61#75#6e#63#68 /F (unsafe.exe) >>');

    await expect(assertSafeFlattenedPdf(bytes)).rejects.toThrow(/active document action/iu);
  });

  it('rejects malformed bytes and a missing local descriptor', async () => {
    const bytes = enc.encode('%PDF-not-a-real-document');
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({ completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: approved, expectedItemId: 'ri_0123456789abcdef0123456789abcdef0123' }))
      .rejects.toThrow(/valid PDF|parsed safely/iu);
    const safeBytes = validPdf();
    await expect(verifyPdfFillReceipt({ completedBytes: safeBytes, receipt: await receipt(safeBytes, approved), descriptor: null, expectedItemId: 'ri_0123456789abcdef0123456789abcdef0123' }))
      .rejects.toThrow(/local approved template/iu);
  });

  it('rejects a completed form issued for a sibling request item', async () => {
    const bytes = validPdf();
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({
      completedBytes: bytes,
      receipt: await receipt(bytes, approved),
      descriptor: approved,
      expectedItemId: 'ri_abcdef0123456789abcdef0123456789abcd',
    })).rejects.toThrow(/request item/iu);
  });
});

describe('assertSafeFlattenedPdf PDF.js worker configuration', () => {
  // tests/setup.ts pre-configures GlobalWorkerOptions.workerSrc once,
  // globally, before any test file runs - which is exactly why the real
  // production bug this guards against (the desktop app throwing
  // 'No "GlobalWorkerOptions.workerSrc" specified.' on every pdf_fill
  // submission) was invisible to every existing test in this file: they
  // all inherit that global pre-configuration, so a call site that forgot
  // to configure it itself (the old pdfFillReceipt.ts) never got caught.
  // A full fresh-module reset to force PDF.js's own internal bootstrap to
  // genuinely re-run turned out to be flaky and order-dependent - PDF.js
  // memoizes its fake-worker setup as a class-level cached getter in ways
  // a vitest reset does not reliably unwind. These tests instead spy on
  // the REAL, unmocked ensureWorkerConfigured export to prove the wiring
  // fix, and stub only getDocument's rejection (the one surface where the
  // two known real PDF.js error shapes actually get produced) to prove
  // the message-classification fix - both real production code, with the
  // narrowest possible seam substituted for what pdf.js's own
  // undocumented internals can't be forced to reproduce deterministically.

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('configures the PDF.js worker before parsing every completed form', async () => {
    const ensureSpy = vi.spyOn(pdfExtractModule, 'ensureWorkerConfigured');
    await assertSafeFlattenedPdf(validPdf());
    expect(ensureSpy).toHaveBeenCalled();
  });

  it.each([
    // The real, unwrapped message a genuine browser's direct-worker path
    // throws (confirmed in node_modules/pdfjs-dist/{legacy/,}build/pdf.mjs).
    ['No "GlobalWorkerOptions.workerSrc" specified.'],
    // The wrapped form Node's fake-worker bootstrap path produces for the
    // exact same underlying cause (what this test suite's own environment
    // always takes, since it runs under Node).
    ['Setting up fake worker failed: "No \\"GlobalWorkerOptions.workerSrc\\" specified.".'],
  ])('classifies "%s" as PdfToolingFailure with an honest, non-data-blaming message', async (workerSrcErrorMessage) => {
    const pdfjsLib = await import('pdfjs-dist');
    const getDocumentMock = vi.mocked(pdfjsLib.getDocument);
    getDocumentMock.mockReturnValueOnce({
      promise: Promise.reject(new Error(workerSrcErrorMessage)),
      destroy: () => Promise.resolve(),
    } as never);

    const error: unknown = await assertSafeFlattenedPdf(validPdf()).catch((caught: unknown) => caught);
    expect(getDocumentMock).toHaveBeenCalled();
    expect(error).toBeInstanceOf(PdfToolingFailure);
    const message = error instanceof Error ? error.message : '';
    // The advisor-facing message must own the failure, not the client's
    // data - it must never say the form "could not be parsed safely" or
    // similar, which is the wording reserved for genuine content problems.
    expect(message).not.toMatch(/parsed safely/iu);
    expect(message).toMatch(/app problem/iu);
  });

  it('still uses the generic data-safety message for an unrelated PDF.js failure', async () => {
    const pdfjsLib = await import('pdfjs-dist');
    vi.mocked(pdfjsLib.getDocument).mockReturnValueOnce({
      promise: Promise.reject(new Error('Invalid PDF structure.')),
      destroy: () => Promise.resolve(),
    } as never);

    const error: unknown = await assertSafeFlattenedPdf(validPdf()).catch((caught: unknown) => caught);
    expect(error).not.toBeInstanceOf(PdfToolingFailure);
    expect(error instanceof Error ? error.message : '').toMatch(/parsed safely/iu);
  });
});

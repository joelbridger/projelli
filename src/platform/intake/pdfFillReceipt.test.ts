import { describe, expect, it } from 'vitest';

import type { PdfCompletionReceipt, PdfTemplateDescriptor } from './types';
import { sha256Hex } from './pdfTemplates/receipt';
import { assertSafeFlattenedPdf, verifyPdfFillReceipt } from './pdfFillReceipt';

const enc = new TextEncoder();

function pdf(objects: string[]): Uint8Array {
  let value = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(enc.encode(value).byteLength);
    value += `${String(index + 1)} 0 obj\n${objects[index]}\nendobj\n`;
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
    templateId: template.templateId, templateVersion: template.version,
    sourceSha256: template.sourceSha256, completedSha256: await sha256Hex(bytes),
    completedAt: '2026-07-11T12:00:00.000Z', pageVersion: 'w8.1',
  };
}

describe('verifyPdfFillReceipt', () => {
  it('accepts a matching safe flattened PDF', async () => {
    const bytes = validPdf();
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({ completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: approved }))
      .resolves.toBeUndefined();
  });

  it('rejects a changed completed hash, oversize bytes, and another template version', async () => {
    const bytes = validPdf();
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({
      completedBytes: bytes, receipt: { ...await receipt(bytes, approved), completedSha256: 'b'.repeat(64) }, descriptor: approved,
    })).rejects.toThrow(/receipt hash/iu);
    await expect(verifyPdfFillReceipt({
      completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: descriptor({ maxOutputBytes: 1 }),
    })).rejects.toThrow(/output size limit/iu);
    await expect(verifyPdfFillReceipt({
      completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: descriptor({ templateId: 'template_approved_02' }),
    })).rejects.toThrow(/template version/iu);
  });

  it.each([
    ['interactive fields', validPdf('/AcroForm << /Fields [] >>')],
    ['JavaScript', validPdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>')],
    ['launch action', validPdf('/OpenAction << /S /Launch /F (unsafe.exe) >>')],
    ['attachment', validPdf('/Names << /EmbeddedFiles << >> >>')],
    ['signature widget', validPdf('/AcroForm << /Fields [5 0 R] >>', ['<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] >>'])],
  ])('rejects %s', async (_name, bytes) => {
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({ completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: approved }))
      .rejects.toThrow(/interactive|active|attachment/iu);
  });

  it('rejects a name-escaped launch action after PDF.js resolves the catalog action', async () => {
    const bytes = validPdf('/OpenAction << /S /#4c#61#75#6e#63#68 /F (unsafe.exe) >>');

    await expect(assertSafeFlattenedPdf(bytes)).rejects.toThrow(/active document action/iu);
  });

  it('rejects malformed bytes and a missing local descriptor', async () => {
    const bytes = enc.encode('%PDF-not-a-real-document');
    const approved = descriptor();
    await expect(verifyPdfFillReceipt({ completedBytes: bytes, receipt: await receipt(bytes, approved), descriptor: approved }))
      .rejects.toThrow(/valid PDF|parsed safely/iu);
    const safeBytes = validPdf();
    await expect(verifyPdfFillReceipt({ completedBytes: safeBytes, receipt: await receipt(safeBytes, approved), descriptor: null }))
      .rejects.toThrow(/local approved template/iu);
  });
});

import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

import { sha256Hex } from '../../src/platform/intake/pdfTemplates/receipt';
import {
  generateIntakeKeypair,
  importContentKey,
  openItemChunk,
  openManifest,
  unwrapContentKey,
} from '../../src/platform/intake/intakeCrypto';
import type { ChunkUpload, SubmitManifest } from '../../src/platform/intake/intakeContract';
import type { PdfFillRequestItem, PdfTemplateDescriptor } from '../../src/platform/intake/types';
import {
  PdfFillValidationError,
  preparePdfFillSubmission,
} from '../src/pdfFill/preparePdfFillSubmission';
import { sealedPdfSourceBytes } from '../src/pdfFill/sealedPdfSource';
import { submitAnswer } from '../src/submission';
import { syntheticAcroFormPdf, syntheticOverlayPdf, syntheticPdfWithExternalUriAction } from './fixtures/pdfFixtures';

const ISSUED_ITEM_ID = 'ri_0123456789abcdef0123456789abcdef0123';

async function acroTemplate(source: Uint8Array): Promise<PdfTemplateDescriptor> {
  return {
    templateId: 'synthetic-acro-001', version: 1, kind: 'acroform', sourceSha256: await sha256Hex(source),
    sourceArtifactRef: 'sealed-artifact:syntheticacro0001', outputFileStem: 'ignored', maxOutputBytes: 2 * 1024 * 1024,
    fields: {
      name: { kind: 'acroform', field_id: 'name', acroform_field: 'Client.Name', pdf_field_type: 'text', required: true },
      date: { kind: 'acroform', field_id: 'date', acroform_field: 'Date', pdf_field_type: 'date', required: true },
      money: { kind: 'acroform', field_id: 'money', acroform_field: 'Money', pdf_field_type: 'money', required: true },
      agree: { kind: 'acroform', field_id: 'agree', acroform_field: 'Agree', pdf_field_type: 'checkbox', required: true },
      choice: { kind: 'acroform', field_id: 'choice', acroform_field: 'Choice', pdf_field_type: 'radio', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
      select: { kind: 'acroform', field_id: 'select', acroform_field: 'Select', pdf_field_type: 'select', options: [{ value: 'one', label: 'One' }, { value: 'two', label: 'Two' }] },
    },
  };
}

async function overlayTemplate(source: Uint8Array, overflow: 'wrap' | 'stop' = 'wrap'): Promise<PdfTemplateDescriptor> {
  return {
    templateId: 'synthetic-overlay-001', version: 1, kind: 'overlay', sourceSha256: await sha256Hex(source),
    sourceArtifactRef: 'sealed-artifact:syntheticoverlay001', outputFileStem: 'ignored', maxOutputBytes: 2 * 1024 * 1024,
    fields: {
      answer: { kind: 'overlay', field_id: 'answer', pdf_field_type: 'text', required: true, page: 1, rect: { x: 72 / 612, y: 112 / 792, width: 260 / 612, height: 30 / 792 }, font: { family: 'Helvetica', size: 12 }, alignment: 'left', overflow },
      notes: { kind: 'overlay', field_id: 'notes', pdf_field_type: 'text', page: 1, rect: { x: 72 / 612, y: 157 / 792, width: 260 / 612, height: 45 / 792 }, font: { family: 'Helvetica', size: 12 }, alignment: 'left', overflow: 'wrap' },
    },
  };
}

async function overlayChoiceTemplate(source: Uint8Array): Promise<PdfTemplateDescriptor> {
  return {
    templateId: 'synthetic-overlay-choice-001', version: 1, kind: 'overlay', sourceSha256: await sha256Hex(source),
    sourceArtifactRef: 'sealed-artifact:syntheticoverlaychoice001', outputFileStem: 'ignored', maxOutputBytes: 2 * 1024 * 1024,
    fields: {
      delivery: {
        kind: 'overlay', field_id: 'delivery', pdf_field_type: 'radio', required: true, page: 1,
        rect: { x: 72 / 612, y: 112 / 792, width: 18 / 612, height: 18 / 792 },
        font: { family: 'Helvetica', size: 12 }, alignment: 'left', overflow: 'stop',
        options: [{ value: 'email', label: 'Email' }, { value: 'mail', label: 'Mail' }],
      },
    },
  };
}

test('flattens a synthetic AcroForm locally with all supported form controls', async () => {
  const source = await syntheticAcroFormPdf();
  const prepared = await preparePdfFillSubmission({
    issuedItemId: ISSUED_ITEM_ID,
    sourceBytes: source,
    template: await acroTemplate(source),
    values: { name: 'Avery Chen', date: '1990-01-02', money: '90000', agree: 'true', choice: 'yes', select: 'two' },
  });
  expect(prepared.contentType).toBe('application/pdf');
  expect(prepared.file.type).toBe('application/pdf');
  expect(prepared.fileName).toMatch(/^completed-form-[a-f0-9]+\.pdf$/u);
  expect(prepared.fileName).not.toContain('ignored');
  expect(prepared.receipt.completedSha256).toHaveLength(64);
  const flattened = await PDFDocument.load(prepared.pdfBytes);
  expect(flattened.getForm().getFields()).toEqual([]);
});

test('writes a synthetic non-fillable overlay locally without introducing fields', async () => {
  const source = await syntheticOverlayPdf();
  const prepared = await preparePdfFillSubmission({
    issuedItemId: ISSUED_ITEM_ID,
    sourceBytes: source,
    template: await overlayTemplate(source),
    values: { answer: 'Avery Chen', notes: 'A short synthetic note for the reviewed box.' },
  });
  const flattened = await PDFDocument.load(prepared.pdfBytes);
  expect(flattened.getForm().getFields()).toEqual([]);
  expect(prepared.pdfBytes).not.toEqual(source);
});

test('draws an overlay radio mark for a reviewed option value that is not truthy text', async () => {
  const source = await syntheticOverlayPdf();
  const prepared = await preparePdfFillSubmission({
    issuedItemId: ISSUED_ITEM_ID,
    sourceBytes: source,
    template: await overlayChoiceTemplate(source),
    values: { delivery: 'email' },
  });
  const task = pdfjs.getDocument({ data: prepared.pdfBytes.slice() });
  const document = await task.promise;
  const textContent = await (await document.getPage(1)).getTextContent();
  await document.destroy();
  expect(textContent.items.map((item) => ('str' in item ? item.str : '')).join('')).toContain('X');
});

test('rejects a source PDF with an external URI action before it can be rendered or filled', async () => {
  const source = await syntheticPdfWithExternalUriAction();
  await expect(preparePdfFillSubmission({
    issuedItemId: ISSUED_ITEM_ID,
    sourceBytes: source,
    template: await overlayTemplate(source),
    values: { answer: 'Avery Chen', notes: '' },
  })).rejects.toThrow('unsupported active feature');
});

test('rejects an oversized sealed PDF value before base64 decoding', () => {
  const originalAtob = globalThis.atob;
  let decodeCalls = 0;
  Object.defineProperty(globalThis, 'atob', {
    configurable: true,
    value: () => { decodeCalls += 1; throw new Error('Base64 decoding should not run'); },
  });
  try {
    const oversizedEncodedLength = Math.ceil((50 * 1024 * 1024) / 3) * 4 + 4;
    const item = {
      t: 'pdf_fill',
      sealed_source_pdf_b64: 'A'.repeat(oversizedEncodedLength),
    } as unknown as PdfFillRequestItem;
    expect(sealedPdfSourceBytes(item)).toBeUndefined();
    expect(decodeCalls).toBe(0);
  } finally {
    Object.defineProperty(globalThis, 'atob', { configurable: true, value: originalAtob });
  }
});

test('blocks missing, invalid, and too-long values before any upload can begin', async () => {
  const source = await syntheticAcroFormPdf();
  await expect(preparePdfFillSubmission({
    issuedItemId: ISSUED_ITEM_ID,
    sourceBytes: source, template: await acroTemplate(source), values: { name: '', date: 'not-a-date', money: 'nope', agree: 'false', choice: 'other', select: 'other' },
  })).rejects.toBeInstanceOf(PdfFillValidationError);

  const overlay = await syntheticOverlayPdf();
  await expect(preparePdfFillSubmission({
    issuedItemId: ISSUED_ITEM_ID,
    sourceBytes: overlay, template: await overlayTemplate(overlay, 'stop'), values: { answer: 'This sentence is intentionally much too long for the reviewed one-line form box.', notes: '' },
  })).rejects.toThrow(/contact your advisor/iu);
});

test('never asks the browser to contact a third-party host while loading the public page', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol !== 'data:' && url.protocol !== 'about:' && url.hostname !== '127.0.0.1') externalRequests.push(url.href);
  });
  await page.goto('/');
  expect(externalRequests).toEqual([]);
});

test('sends one encrypted PDF and keeps source bytes, values, receipt, and hashes off the relay wire', async () => {
  const source = await syntheticAcroFormPdf();
  const template = await acroTemplate(source);
  const values = { name: 'Avery Chen', date: '1990-01-02', money: '90000', agree: 'true', choice: 'yes', select: 'two' };
  const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
  const chunks: ChunkUpload[] = [];
  let submit: SubmitManifest | undefined;
  const item: PdfFillRequestItem = { t: 'pdf_fill', item_id: ISSUED_ITEM_ID, label: 'Synthetic form', help_text: '', required: true, subject: 'primary', template, prefill: [] };
  const prepared = await preparePdfFillSubmission({ issuedItemId: item.item_id, sourceBytes: source, template, values });
  const relay = {
    fetchUploadedIndexes: async () => [] as number[],
    uploadChunk: async (_itemId: string, chunk: ChunkUpload) => { chunks.push(chunk); },
    submitManifest: async (_itemId: string, manifest: SubmitManifest) => { submit = manifest; },
  };
  await submitAnswer({
    intakeId: 'intake-synthetic', intakePubRaw: publicKeyRaw, item,
    payload: { kind: 'files', files: [prepared.file], pdf_completion_receipt: prepared.receipt },
    relay: relay as never, sessionId: 'session-synthetic',
  });
  expect(submit).toBeTruthy();
  const wire = JSON.stringify({ chunks, submit });
  for (const forbidden of [
    'Avery Chen', 'Synthetic form', template.templateId, template.sourceSha256,
    prepared.receipt.completedSha256, 'issuedItemId', new TextDecoder().decode(source), new TextDecoder().decode(prepared.pdfBytes),
  ]) expect(wire).not.toContain(forbidden);

  if (!submit) throw new Error('Missing encrypted submission');
  const contentKeyB64 = await unwrapContentKey(submit.wrapped_content_key_b64, privateKey);
  const contentKey = await importContentKey(contentKeyB64);
  const ids = { intakeId: submit.intake_id, itemId: submit.item_id, submissionId: submit.submission_id };
  const manifest = await openManifest(contentKey, submit.manifest_ciphertext_b64, ids);
  expect(manifest.ok).toBe(true);
  if (!manifest.ok) throw new Error('Manifest did not decrypt');
  expect(manifest.manifest.content_type).toBe('application/pdf');
  expect(manifest.manifest.file_names).toEqual([prepared.fileName]);
  expect((manifest.manifest as typeof manifest.manifest & { pdf_completion_receipt?: unknown }).pdf_completion_receipt).toEqual(prepared.receipt);
  const chunk = chunks[0];
  expect(chunk).toBeTruthy();
  if (!chunk) throw new Error('Missing encrypted PDF chunk');
  const plaintext = await openItemChunk(contentKey, chunk.ciphertext_b64, { intakeId: chunk.intake_id, itemId: chunk.item_id, submissionId: chunk.submission_id, index: chunk.index });
  expect(plaintext.ok).toBe(true);
  if (plaintext.ok) expect(plaintext.data).toEqual(prepared.pdfBytes);
});

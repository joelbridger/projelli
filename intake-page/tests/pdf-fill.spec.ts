import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

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
import { submitAnswer } from '../src/submission';
import { syntheticAcroFormPdf, syntheticOverlayPdf } from './fixtures/pdfFixtures';

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

test('flattens a synthetic AcroForm locally with all supported form controls', async () => {
  const source = await syntheticAcroFormPdf();
  const prepared = await preparePdfFillSubmission({
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
    sourceBytes: source,
    template: await overlayTemplate(source),
    values: { answer: 'Avery Chen', notes: 'A short synthetic note for the reviewed box.' },
  });
  const flattened = await PDFDocument.load(prepared.pdfBytes);
  expect(flattened.getForm().getFields()).toEqual([]);
  expect(prepared.pdfBytes).not.toEqual(source);
});

test('blocks missing, invalid, and too-long values before any upload can begin', async () => {
  const source = await syntheticAcroFormPdf();
  await expect(preparePdfFillSubmission({
    sourceBytes: source, template: await acroTemplate(source), values: { name: '', date: 'not-a-date', money: 'nope', agree: 'false', choice: 'other', select: 'other' },
  })).rejects.toBeInstanceOf(PdfFillValidationError);

  const overlay = await syntheticOverlayPdf();
  await expect(preparePdfFillSubmission({
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
  const prepared = await preparePdfFillSubmission({ sourceBytes: source, template, values });
  const { privateKey, publicKeyRaw } = await generateIntakeKeypair();
  const chunks: ChunkUpload[] = [];
  let submit: SubmitManifest | undefined;
  const item: PdfFillRequestItem = { t: 'pdf_fill', item_id: 'opaque-handle', label: 'Synthetic form', help_text: '', required: true, subject: 'primary', template, prefill: [] };
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
    prepared.receipt.completedSha256, new TextDecoder().decode(source), new TextDecoder().decode(prepared.pdfBytes),
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

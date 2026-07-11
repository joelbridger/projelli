import { describe, expect, it } from 'vitest';
import type { PdfCompletionReceipt, PdfTemplateDescriptor } from './templateContract';
import {
  MAX_PDF_TEMPLATE_OUTPUT_BYTES,
  assertValidPdfCompletionReceipt,
  assertValidPdfTemplateDescriptor,
  verifyReceiptAgainstDescriptor,
} from './templateValidation';
import {
  sha256Hex,
  verifyCompletedBytesAgainstReceipt,
  verifySourceBytesAgainstDescriptor,
} from './receipt';

const SOURCE_HASH = 'a'.repeat(64);

function descriptor(overrides: Record<string, unknown> = {}): PdfTemplateDescriptor {
  return {
    templateId: 'template_approved_01',
    version: 1,
    kind: 'acroform',
    sourceSha256: SOURCE_HASH,
    sourceArtifactRef: 'sealed-artifact:approvedartifact0001',
    outputFileStem: 'client-information',
    maxOutputBytes: 1024 * 1024,
    fields: {
      account_number: {
        kind: 'acroform', field_id: 'account_number', acroform_field: 'Account.Number',
        pdf_field_type: 'text', fact_kind: 'beneficiary', required: true,
      },
    },
    ...overrides,
  } as PdfTemplateDescriptor;
}

function receipt(overrides: Record<string, unknown> = {}): PdfCompletionReceipt {
  return {
    templateId: 'template_approved_01', templateVersion: 1,
    sourceSha256: SOURCE_HASH, completedSha256: 'b'.repeat(64),
    completedAt: '2026-07-11T12:00:00.000Z', pageVersion: 'w8.1',
    ...overrides,
  } as PdfCompletionReceipt;
}

describe('PDF template contract validation', () => {
  it('accepts a reviewed AcroForm snapshot and a reviewed normalized overlay snapshot', () => {
    expect(() => { assertValidPdfTemplateDescriptor(descriptor()); }).not.toThrow();
    expect(() => { assertValidPdfTemplateDescriptor(descriptor({
      kind: 'overlay',
      fields: {
        client_name: {
          kind: 'overlay', field_id: 'client_name', pdf_field_type: 'text', page: 1,
          rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.08 },
          font: { family: 'Helvetica', size: 10, color: '#123456' },
          alignment: 'left', overflow: 'stop',
        },
      },
    })); }).not.toThrow();
  });

  it.each([
    ['bad source hash', { sourceSha256: 'ABC' }],
    ['URL artifact reference', { sourceArtifactRef: 'https://custodian.example/form.pdf' }],
    ['filesystem artifact reference', { sourceArtifactRef: '/tmp/form.pdf' }],
    ['unsafe output stem', { outputFileStem: '../client-form' }],
    ['unreasonable output cap', { maxOutputBytes: MAX_PDF_TEMPLATE_OUTPUT_BYTES + 1 }],
    ['client value property', { client_value: 'Avery Chen' }],
  ])('rejects %s', (_name, overrides) => {
    expect(() => { assertValidPdfTemplateDescriptor(descriptor(overrides)); }).toThrow();
  });

  it('rejects duplicate field ids, signatures, invalid choice lists, and values hidden in map entries', () => {
    expect(() => { assertValidPdfTemplateDescriptor(descriptor({ fields: {
      first: { kind: 'acroform', field_id: 'same', acroform_field: 'First', pdf_field_type: 'text' },
      second: { kind: 'acroform', field_id: 'same', acroform_field: 'Second', pdf_field_type: 'text' },
    } })); }).toThrow(/match its map key|duplicated/iu);
    expect(() => { assertValidPdfTemplateDescriptor(descriptor({ fields: {
      signature: { kind: 'acroform', field_id: 'signature', acroform_field: 'Signature', pdf_field_type: 'signature' },
    } })); }).toThrow(/signature|supported/iu);
    expect(() => { assertValidPdfTemplateDescriptor(descriptor({ fields: {
      choice: { kind: 'acroform', field_id: 'choice', acroform_field: 'Choice', pdf_field_type: 'select', options: [{ value: 'yes', label: 'Yes' }] },
    } })); }).toThrow(/choices/iu);
    expect(() => { assertValidPdfTemplateDescriptor(descriptor({ fields: {
      account_number: { kind: 'acroform', field_id: 'account_number', acroform_field: 'Account', pdf_field_type: 'text', value: 'client answer' },
    } })); }).toThrow(/unsupported property/iu);
    expect(() => { assertValidPdfTemplateDescriptor(descriptor({ fields: {
      account_number: { kind: 'acroform', field_id: 'account_number', acroform_field: 'Account.Number', pdf_field_type: 'text' },
      account_name: { kind: 'acroform', field_id: 'account_name', acroform_field: 'Account.Number', pdf_field_type: 'text' },
    } })); }).toThrow(/AcroForm field.*mapped more than once/iu);
  });

  it('rejects overlay coordinates, unsafe fonts, and omitted long-value behavior', () => {
    const overlay = (field: Record<string, unknown>) => descriptor({ kind: 'overlay', fields: { address_line: field } });
    const base = {
      kind: 'overlay', field_id: 'address_line', pdf_field_type: 'text', page: 1,
      rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.1 },
      font: { family: 'Helvetica', size: 10 }, alignment: 'left', overflow: 'wrap',
    };
    expect(() => { assertValidPdfTemplateDescriptor(overlay({ ...base, rect: { ...base.rect, x: 0 } })); }).toThrow(/positive/iu);
    expect(() => { assertValidPdfTemplateDescriptor(overlay({ ...base, rect: { ...base.rect, width: 0.95 } })); }).toThrow(/bounds/iu);
    expect(() => { assertValidPdfTemplateDescriptor(overlay({ ...base, font: { family: 'https://fonts.example/font', size: 10 } })); }).toThrow(/font/iu);
    const { overflow: _overflow, ...withoutOverflow } = base;
    expect(() => { assertValidPdfTemplateDescriptor(overlay(withoutOverflow)); }).toThrow(/overflow|unsupported/iu);
  });
});

describe('PDF completion receipt integrity helpers', () => {
  it('accepts a matching receipt and rejects a mismatched template snapshot', () => {
    const approved = descriptor();
    expect(() => { verifyReceiptAgainstDescriptor(receipt(), approved); }).not.toThrow();
    expect(() => { verifyReceiptAgainstDescriptor(receipt({ sourceSha256: 'c'.repeat(64) }), approved); }).toThrow(/source hash/iu);
    expect(() => { verifyReceiptAgainstDescriptor(receipt({ templateVersion: 2 }), approved); }).toThrow(/template version/iu);
  });

  it('rejects malformed receipt fields and unexpected raw payload data', () => {
    expect(() => { assertValidPdfCompletionReceipt(receipt({ completedSha256: 'not-a-hash' })); }).toThrow(/completedSha256/iu);
    expect(() => { assertValidPdfCompletionReceipt(receipt({ client_values: { name: 'Avery' } })); }).toThrow(/unsupported property/iu);
  });

  it('verifies source and completed bytes by SHA-256 without I/O', async () => {
    const bytes = new TextEncoder().encode('abc');
    const hash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    await expect(sha256Hex(bytes)).resolves.toBe(hash);
    const approved = descriptor({ sourceSha256: hash });
    await expect(verifySourceBytesAgainstDescriptor(bytes, approved)).resolves.toBeUndefined();
    await expect(verifyCompletedBytesAgainstReceipt(bytes, receipt({ sourceSha256: hash, completedSha256: hash }), approved)).resolves.toBeUndefined();
    await expect(verifyCompletedBytesAgainstReceipt(bytes, receipt({ sourceSha256: hash, completedSha256: 'd'.repeat(64) }), approved)).rejects.toThrow(/completed PDF/iu);
  });

  it('rejects completed bytes that exceed the approved output limit before hashing', async () => {
    const completedBytes = new Uint8Array([1, 2, 3, 4]);
    await expect(verifyCompletedBytesAgainstReceipt(
      completedBytes,
      receipt({ completedSha256: 'd'.repeat(64) }),
      descriptor({ maxOutputBytes: 3 }),
    )).rejects.toThrow(/output size limit/iu);
  });
});

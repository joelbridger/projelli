import { describe, expect, it } from 'vitest';
import type { RequestBlueprint } from './blueprintTypes';
import { assertValidRequestBlueprint, copyBlueprintItem } from './blueprintValidation';
import type { PdfFillRequestItem } from './types';

function approvedPdfItem(): PdfFillRequestItem {
  return {
    t: 'pdf_fill', item_id: 'tax-form', label: 'Tax form', help_text: '', required: true, subject: 'primary', prefill: [],
    template: {
      templateId: 'template_approved_02', version: 1, kind: 'acroform', sourceSha256: 'a'.repeat(64),
      sourceArtifactRef: 'sealed-artifact:approvedartifact0002', outputFileStem: 'tax-information', maxOutputBytes: 1024 * 1024,
      fields: {
        taxpayer_name: { kind: 'acroform', field_id: 'taxpayer_name', acroform_field: 'Taxpayer.Name', pdf_field_type: 'text' },
      },
    },
  };
}

function blueprint(items: unknown[]): RequestBlueprint {
  return { blueprintId: 'pdf-blueprint', schemaVersion: 1, label: 'PDF request', source: 'firm_saved', defaultKind: 'standing', items: items as RequestBlueprint['items'] };
}

describe('PDF blueprint validation', () => {
  it('copies the approved immutable descriptor by value and clears every prefill', () => {
    const item = approvedPdfItem();
    item.prefill = [{ field_id: 'taxpayer_name', fact_kind: 'beneficiary', sensitivity: 'confidential', mode: 'hidden_confirm' }];
    const copied = copyBlueprintItem(item) as PdfFillRequestItem;
    expect(copied.prefill).toEqual([]);
    expect(copied.template).toEqual({ ...item.template, fields: item.template.fields });
    expect(copied.template).not.toBe(item.template);
    expect(copied.template.fields).not.toBe(item.template.fields);
  });

  it('preserves a sealed source PDF only when it is present on an issued item', () => {
    const withSource = approvedPdfItem();
    withSource.sealed_source_pdf_b64 = 'c2VhbGVkLXBkZi1ieXRlcw==';
    const copiedWithSource = copyBlueprintItem(withSource) as PdfFillRequestItem;
    const copiedWithoutSource = copyBlueprintItem(approvedPdfItem()) as PdfFillRequestItem;

    expect(copiedWithSource.sealed_source_pdf_b64).toBe(withSource.sealed_source_pdf_b64);
    expect('sealed_source_pdf_b64' in copiedWithoutSource).toBe(false);
  });

  it('rejects unapproved templates and the retired Wave 7 pdf_ref shape', () => {
    const invalid = approvedPdfItem();
    invalid.template.sourceSha256 = 'bad';
    expect(() => { assertValidRequestBlueprint(blueprint([invalid])); }).toThrow(/template is not approved/iu);
    const oldWave7 = {
      t: 'pdf_fill', item_id: 'old', label: 'Old form', help_text: '', required: true, subject: 'primary',
      pdf_ref: 'forms/old.pdf', field_map: {}, prefill: [],
    };
    expect(() => { assertValidRequestBlueprint(blueprint([oldWave7])); }).toThrow(/template is not approved/iu);
  });
});

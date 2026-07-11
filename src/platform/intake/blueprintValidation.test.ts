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

describe('DocuSign signature blueprint validation', () => {
  function signature(sourceId = 'tax-form') {
    return {
      t: 'signature' as const, item_id: 'sign-form', label: 'Sign form', help_text: '', required: true, subject: 'primary',
      grade: 'docusign' as const, source_pdf_fill_item_id: sourceId,
      tab_map: {
        signatureTab: { page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } },
        dateSignedTab: { page: 1, rect: { x: 0.1, y: 0.25, width: 0.2, height: 0.1 } },
        signerNameTab: { page: 1, rect: { x: 0.1, y: 0.4, width: 0.2, height: 0.1 } },
      },
    };
  }

  it('copies a complete reviewed DocuSign signature item by value', () => {
    const item = signature();
    const copy = copyBlueprintItem(item);
    expect(copy).toEqual(item);
    expect((copy as typeof item).tab_map).not.toBe(item.tab_map);
  });

  it.each([
    ['native clicksign', [{ t: 'signature', item_id: 'native', label: 'Native', help_text: '', required: true, subject: 'primary', grade: 'native_clicksign' }], /native_clicksign/iu],
    ['missing source', [approvedPdfItem(), signature('missing')], /source_pdf_fill_item_id/iu],
    ['non-pdf source', [{ t: 'readonly_card', item_id: 'not-pdf', label: 'Card', help_text: '', required: false, subject: 'primary', body: 'Read' }, signature('not-pdf')], /pdf_fill/iu],
    ['duplicate source', [approvedPdfItem(), signature(), { ...signature(), item_id: 'sign-form-2' }], /only one/iu],
    ['retired placeholder', [{ t: 'signature', item_id: 'old', label: 'Old', help_text: '', required: true, subject: 'primary', grade: 'docusign' }], /source_pdf_fill_item_id/iu],
  ])('rejects %s', (_name, items, message) => {
    expect(() => assertValidRequestBlueprint(blueprint(items))).toThrow(message);
  });

  it.each([
    ['missing tab', (() => { const item = signature() as Omit<ReturnType<typeof signature>, 'tab_map'> & { tab_map: Partial<ReturnType<typeof signature>['tab_map']> }; delete item.tab_map.signerNameTab; return item; })()],
    ['bad coordinate', { ...signature(), tab_map: { ...signature().tab_map, signatureTab: { ...signature().tab_map.signatureTab, rect: { ...signature().tab_map.signatureTab.rect, x: 0 } } } }],
    ['bad page', { ...signature(), tab_map: { ...signature().tab_map, signatureTab: { ...signature().tab_map.signatureTab, page: 1.5 } } }],
  ])('rejects an incomplete tab map: %s', (_name, item) => {
    expect(() => assertValidRequestBlueprint(blueprint([approvedPdfItem(), item]))).toThrow(/tab map/iu);
  });

  it('rejects a tab beyond an overlay template field page', () => {
    const overlay = approvedPdfItem();
    overlay.template = {
      ...overlay.template, kind: 'overlay', fields: {
        field: {
          kind: 'overlay', field_id: 'field', page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 },
          font: { family: 'Helvetica', size: 10 }, alignment: 'left', overflow: 'stop', pdf_field_type: 'text',
        },
      },
    };
    const item = signature();
    item.tab_map.signatureTab.page = 2;
    expect(() => assertValidRequestBlueprint(blueprint([overlay, item]))).toThrow(/page range/iu);
  });
});

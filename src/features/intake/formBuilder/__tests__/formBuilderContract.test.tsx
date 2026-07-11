import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { instantiateRequestBlueprint } from '@/platform/intake/blueprintFactory';
import { useBlueprintStore } from '@/platform/intake/blueprintStore';
import type { RequestBlueprint } from '@/platform/intake/blueprintTypes';
import { assertSendableRequest } from '@/platform/intake/createIntake';
import type { RequestItem } from '@/platform/intake/types';
import {
  draftDocUpload,
  draftGuidedQuestion,
  draftTypedField,
  draftWelcomeCard,
} from '@/platform/intake/formBuilder/formItemDrafts';
import { FormBuilderEditor } from '../FormBuilderEditor';

describe('form builder intake contract', () => {
  beforeEach(() => {
    useBlueprintStore.getState().resetForTests();
  });

  it('round trips a form through the store and produces a sendable request', () => {
    const assembled: RequestItem[] = [draftWelcomeCard(), draftTypedField(), draftDocUpload(), draftGuidedQuestion()];
    expect(assembled.some((item) => item.t === 'pdf_fill' || item.t === 'signature')).toBe(false);

    const onSaved = vi.fn<(blueprint: RequestBlueprint) => void>();
    render(<FormBuilderEditor blueprint={null} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Contract form' } });
    fireEvent.change(screen.getByLabelText('Welcome message'), { target: { value: 'Start here.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add typed field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add document upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add guided question' }));
    screen.getAllByLabelText('Label').forEach((input, index) => {
      fireEvent.change(input, { target: { value: `Item ${String(index + 1)}` } });
    });
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'What is your income?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));

    const saved = onSaved.mock.calls[0]?.[0];
    if (!saved) throw new Error('expected the contract form to be saved');
    expect(saved).toBeTruthy();
    expect(saved.items.map((item: { t: string }) => item.t)).toEqual(assembled.map((item) => item.t));
    expect(saved.items.filter((item) => item.t === 'readonly_card').every((item) => item.item_id.toLowerCase().includes('welcome'))).toBe(true);
    expect(useBlueprintStore.getState().getBlueprint(saved.blueprintId)).toEqual(saved);
    expect(useBlueprintStore.getState().listBlueprints().some((blueprint) => blueprint.blueprintId === saved.blueprintId)).toBe(true);

    const updated = useBlueprintStore.getState().updateFirmBlueprint(saved.blueprintId, { label: 'Contract form updated' });
    expect(updated.label).toBe('Contract form updated');
    const archived = useBlueprintStore.getState().archiveFirmBlueprint(saved.blueprintId);
    expect(archived.archived).toBe(true);
    expect(useBlueprintStore.getState().listBlueprints().some((blueprint) => blueprint.blueprintId === saved.blueprintId)).toBe(false);
    expect(useBlueprintStore.getState().listBlueprints(true).some((blueprint) => blueprint.blueprintId === saved.blueprintId)).toBe(true);

    const sendableBlueprint = useBlueprintStore.getState().createFirmBlueprint({ blueprintId: 'contract-sendable', label: 'Contract sendable', items: saved.items });
    const request = instantiateRequestBlueprint({ blueprint: sendableBlueprint, requestId: 'test_request', matterId: 'test_matter' });
    expect(() => {
      assertSendableRequest(request.items);
    }).not.toThrow();
    expect(sendableBlueprint.items.some((item) => item.t === 'pdf_fill' || item.t === 'signature')).toBe(false);
  });

  it('preserves an existing PDF form and signature request unchanged through the full store lifecycle', () => {
    const pdfItem: RequestItem = {
      t: 'pdf_fill', item_id: 'custodian-form', label: 'Custodian transfer form', help_text: 'Complete every required field.', required: true, subject: 'primary',
      template: {
        templateId: 'template_custodian_transfer_01', version: 1, kind: 'acroform', sourceSha256: 'a'.repeat(64),
        sourceArtifactRef: 'sealed-artifact:custodiantransfer0001', outputFileStem: 'custodian-transfer', maxOutputBytes: 1024 * 1024,
        fields: {
          account_number: { kind: 'acroform', field_id: 'account_number', fact_kind: 'ssn', acroform_field: 'Account.Number', pdf_field_type: 'text' },
        },
      },
      prefill: [],
    };
    const signatureItem: RequestItem = {
      t: 'signature', item_id: 'sign-transfer', label: 'Sign transfer form', help_text: 'Sign after reviewing.', required: true, subject: 'primary',
      grade: 'docusign', source_pdf_fill_item_id: 'custodian-form',
      tab_map: {
        signatureTab: { page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } },
        dateSignedTab: { page: 1, rect: { x: 0.1, y: 0.25, width: 0.2, height: 0.1 } },
        signerNameTab: { page: 1, rect: { x: 0.1, y: 0.4, width: 0.2, height: 0.1 } },
      },
    };
    const typedItem = { ...draftTypedField(), label: 'Date of birth' };

    const stored = useBlueprintStore.getState().createFirmBlueprint({
      blueprintId: 'existing-managed-items', label: 'Existing managed items', items: [typedItem, pdfItem, signatureItem],
    });

    const onSaved = vi.fn<(blueprint: RequestBlueprint) => void>();
    render(<FormBuilderEditor blueprint={stored} onSaved={onSaved} onCancel={vi.fn()} />);

    expect(screen.getByText('PDF form')).toBeTruthy();
    expect(screen.getByText('Signature request')).toBeTruthy();
    expect(screen.queryByText('Text block')).toBeNull();
    expect(screen.getAllByLabelText('Label')).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Renamed typed field' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));

    const saved = onSaved.mock.calls[0]?.[0];
    if (!saved) throw new Error('expected the existing-managed-items form to be saved');
    // Deep equality, not JSON.stringify: copyBlueprintItem/copyPdfTemplate
    // reconstruct these objects with their own key order, which is a
    // harmless, semantically-irrelevant difference a raw string compare
    // would wrongly flag.
    expect(saved.items.find((item) => item.t === 'pdf_fill')).toEqual(pdfItem);
    expect(saved.items.find((item) => item.t === 'signature')).toEqual(signatureItem);
    expect(saved.items.find((item) => item.t === 'typed_field')?.label).toBe('Renamed typed field');

    const persisted = useBlueprintStore.getState().getBlueprint(saved.blueprintId);
    expect(persisted?.items.find((item) => item.t === 'pdf_fill')).toEqual(pdfItem);
    expect(persisted?.items.find((item) => item.t === 'signature')).toEqual(signatureItem);

    const updated = useBlueprintStore.getState().updateFirmBlueprint(saved.blueprintId, { label: 'Existing managed items updated' });
    expect(updated.label).toBe('Existing managed items updated');
    expect(updated.items.find((item) => item.t === 'pdf_fill')).toEqual(pdfItem);
    expect(updated.items.find((item) => item.t === 'signature')).toEqual(signatureItem);
  });
});

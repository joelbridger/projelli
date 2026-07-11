import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { instantiateRequestBlueprint } from '@/platform/intake/blueprintFactory';
import { useBlueprintStore } from '@/platform/intake/blueprintStore';
import { assertSendableRequest } from '@/platform/intake/createIntake';
import {
  draftDocUpload,
  draftGuidedQuestion,
  draftReadonlyCard,
  draftSectionHeader,
  draftTypedField,
} from '@/platform/intake/formBuilder/formItemDrafts';
import { FormBuilderEditor } from '../FormBuilderEditor';

describe('form builder intake contract', () => {
  beforeEach(() => {
    useBlueprintStore.getState().resetForTests();
  });

  it('round trips a form through the store and produces a sendable request', () => {
    const assembled = [draftSectionHeader(), draftTypedField(), draftDocUpload(), draftGuidedQuestion(), draftReadonlyCard()];
    expect(assembled.some((item) => item.t === 'pdf_fill' || item.t === 'signature')).toBe(false);

    const onSaved = vi.fn();
    render(<FormBuilderEditor blueprint={null} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Contract form' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add section header / text block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add typed field' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add document upload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add guided question' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add section header / text block' }));
    screen.getAllByLabelText('Label').forEach((input, index) => fireEvent.change(input, { target: { value: `Item ${index + 1}` } }));
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'What is your income?' } });
    fireEvent.change(screen.getAllByLabelText('Text')[0], { target: { value: 'Start here.' } });
    fireEvent.change(screen.getAllByLabelText('Text')[1], { target: { value: 'Thanks.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));

    const saved = onSaved.mock.calls[0]?.[0];
    expect(saved).toBeTruthy();
    expect(saved.items.map((item: { t: string }) => item.t)).toEqual(assembled.map((item) => item.t));
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
    expect(() => assertSendableRequest(request.items)).not.toThrow();
    expect(sendableBlueprint.items.some((item) => item.t === 'pdf_fill' || item.t === 'signature')).toBe(false);
  });
});

/// <reference types="@testing-library/jest-dom" />
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NEW_HOUSEHOLD_BLUEPRINT } from '@/platform/intake/defaultBlueprints';
import { useBlueprintStore } from '@/platform/intake/blueprintStore';
import type { RequestBlueprint } from '@/platform/intake/blueprintTypes';
import { FormBuilderEditor } from '../FormBuilderEditor';

function addAllItemKinds(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Add typed field' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add document upload' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add guided question' }));
}

function fillAddedItems(): void {
  screen.getAllByLabelText('Label').forEach((input, index) => {
    fireEvent.change(input, { target: { value: `Item ${String(index + 1)}` } });
  });
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'What is your income?' } });
}

describe('FormBuilderEditor', () => {
  beforeEach(() => {
    useBlueprintStore.getState().resetForTests();
  });

  it('authors a new form and saves every supported item kind', () => {
    const onSaved = vi.fn<(blueprint: RequestBlueprint) => void>();
    render(<FormBuilderEditor blueprint={null} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Annual review' } });
    fireEvent.change(screen.getByLabelText('Welcome message'), { target: { value: 'Please read this first.' } });
    addAllItemKinds();
    fillAddedItems();
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));

    const saved = onSaved.mock.calls[0]?.[0];
    if (!saved) throw new Error('expected the new form to be saved');
    expect(saved).toMatchObject({ blueprintId: 'annual-review', label: 'Annual review', source: 'firm_saved' });
    expect(saved.items.map((item: { t: string }) => item.t)).toEqual(['readonly_card', 'typed_field', 'doc_upload', 'guided_question']);
    expect(saved.items.filter((item) => item.t === 'readonly_card').every((item) => item.item_id.toLowerCase().includes('welcome'))).toBe(true);
    expect(useBlueprintStore.getState().listBlueprints().some((blueprint) => blueprint.blueprintId === 'annual-review')).toBe(true);
  });

  it('keeps an unrecognized legacy text block when an existing firm form is saved', () => {
    const stored = useBlueprintStore.getState().createFirmBlueprint({
      blueprintId: 'existing', label: 'Old name', items: [{ t: 'readonly_card', item_id: 'card', label: 'Card', help_text: '', required: false, subject: 'primary', body: 'Hello' }],
    });
    const onSaved = vi.fn();
    render(<FormBuilderEditor blueprint={stored} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'New name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ label: 'New name' }));
    expect(useBlueprintStore.getState().getBlueprint('existing')).toMatchObject({ label: 'New name' });
    expect(onSaved.mock.calls[0]?.[0].items).toEqual(stored.items);
  });

  it('loads a first welcome card into the welcome-message field', () => {
    const stored = useBlueprintStore.getState().createFirmBlueprint({
      blueprintId: 'welcome', label: 'Welcome form', items: [{ t: 'readonly_card', item_id: 'welcome_existing', label: 'Welcome', help_text: '', required: false, subject: 'primary', body: 'Hello' }],
    });
    const onSaved = vi.fn<(blueprint: RequestBlueprint) => void>();
    render(<FormBuilderEditor blueprint={stored} onSaved={onSaved} onCancel={vi.fn()} />);
    expect(screen.getByLabelText('Welcome message')).toHaveValue('Hello');
    fireEvent.change(screen.getByLabelText('Welcome message'), { target: { value: 'Updated hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    const saved = onSaved.mock.calls[0]?.[0];
    expect(saved?.items[0]).toMatchObject({ t: 'readonly_card', body: 'Updated hello' });
    expect(saved?.items[0]?.item_id.toLowerCase()).toContain('welcome');
  });

  it('shows a built-in form without editing or saving controls', () => {
    render(<FormBuilderEditor blueprint={NEW_HOUSEHOLD_BLUEPRINT} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('New household')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save form' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add typed field' })).toBeNull();
  });

  it('only offers money and range for guided questions', () => {
    render(<FormBuilderEditor blueprint={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add guided question' }));
    expect(screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual(['money', 'range']);
  });

  it('does not offer drivers license or file reference for typed fields', () => {
    render(<FormBuilderEditor blueprint={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add typed field' }));
    expect(screen.getByLabelText('Information to collect')).not.toHaveTextContent('drivers license');
    expect(screen.getByLabelText('Answer format')).not.toHaveTextContent('file_ref');
  });

  it.each(['', '0', '-5'])('keeps upload limits valid when %s is entered', (invalidValue) => {
    const onSaved = vi.fn<(blueprint: RequestBlueprint) => void>();
    render(<FormBuilderEditor blueprint={null} onSaved={onSaved} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Upload limits' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add document upload' }));
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Upload a document' } });

    const maxFiles = screen.getByLabelText('Maximum files');
    const maxMb = screen.getByLabelText('Maximum size in MB');
    fireEvent.change(maxFiles, { target: { value: invalidValue } });
    fireEvent.change(maxMb, { target: { value: invalidValue } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));

    const saved = onSaved.mock.calls[0]?.[0];
    const upload = saved?.items.find((item) => item.t === 'doc_upload');
    expect(upload).toMatchObject({ max_files: 1, max_bytes: 100 * 1024 * 1024 });
  });

  it('shows a collision error instead of crashing', () => {
    useBlueprintStore.getState().createFirmBlueprint({ blueprintId: 'same-form', label: 'Existing', items: [] });
    render(<FormBuilderEditor blueprint={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Same form' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Blueprint id is already in use.');
  });

  it('cancels without writing to the store', () => {
    const onCancel = vi.fn();
    render(<FormBuilderEditor blueprint={null} onSaved={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(useBlueprintStore.getState().firmBlueprintsById).toEqual({});
  });
});

/// <reference types="@testing-library/jest-dom" />
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NEW_HOUSEHOLD_BLUEPRINT } from '@/platform/intake/defaultBlueprints';
import { useBlueprintStore } from '@/platform/intake/blueprintStore';
import { FormBuilderLibrary } from '../FormBuilderLibrary';

function createFirmBlueprint(overrides: { blueprintId: string; label: string; items?: number }) {
  return useBlueprintStore.getState().createFirmBlueprint({
    blueprintId: overrides.blueprintId,
    label: overrides.label,
    items: Array.from({ length: overrides.items ?? 0 }, (_, index) => ({
      t: 'readonly_card' as const,
      item_id: `card-${String(index)}`,
      label: `Card ${String(index + 1)}`,
      help_text: '',
      required: false,
      subject: 'primary' as const,
      body: 'Hello',
    })),
  });
}

describe('FormBuilderLibrary', () => {
  beforeEach(() => {
    useBlueprintStore.getState().resetForTests();
  });

  it('shows the built-in form without Edit or Archive controls', () => {
    render(<FormBuilderLibrary open onOpenChange={vi.fn()} />);

    expect(screen.getByText(NEW_HOUSEHOLD_BLUEPRINT.label)).toBeTruthy();
    expect(screen.getByText('Built-in')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('opens a new form editor and returns to the list after saving', () => {
    render(<FormBuilderLibrary open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'New form' }));
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Annual review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));

    expect(screen.getByText('Annual review')).toBeTruthy();
    expect(screen.getByText('0 items')).toBeTruthy();
  });

  it('edits a firm-saved form and returns to the list with its updated details', () => {
    createFirmBlueprint({ blueprintId: 'annual-review', label: 'Annual review', items: 1 });
    render(<FormBuilderLibrary open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Form name')).toHaveValue('Annual review');
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Annual review update' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save form' }));

    expect(screen.getByText('Annual review update')).toBeTruthy();
    expect(screen.getByText('1 item')).toBeTruthy();
  });

  it('archives a firm-saved form after confirmation', () => {
    createFirmBlueprint({ blueprintId: 'annual-review', label: 'Annual review' });
    render(<FormBuilderLibrary open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByText('Archive this form?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Archive form' }));

    expect(screen.queryByText('Annual review')).toBeNull();
    expect(useBlueprintStore.getState().listBlueprints().some((blueprint) => blueprint.blueprintId === 'annual-review')).toBe(false);
  });

  it('resets to the list when reopened after entering the editor', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<FormBuilderLibrary open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'New form' }));
    expect(screen.getByLabelText('Form name')).toBeTruthy();
    rerender(<FormBuilderLibrary open={false} onOpenChange={onOpenChange} />);
    rerender(<FormBuilderLibrary open onOpenChange={onOpenChange} />);

    expect(screen.getByRole('button', { name: 'New form' })).toBeTruthy();
    expect(screen.queryByLabelText('Form name')).toBeNull();
  });
});

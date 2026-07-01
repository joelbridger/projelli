/**
 * PromptDialog — inline validation (2026-07-01, part of the "New Word
 * document" silent-no-op fix). A `validate` option lets a create dialog
 * reject an empty (or otherwise invalid) value WITHOUT silently resolving —
 * the dialog stays open and shows an inline error instead.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PromptDialog } from '@/ui/PromptDialog';

describe('PromptDialog — validate', () => {
  it('confirms normally when no validate is provided (back-compat)', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <PromptDialog
        open
        onOpenChange={onOpenChange}
        description="Enter a name:"
        defaultValue="my-document"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('OK'));
    expect(onConfirm).toHaveBeenCalledWith('my-document');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('blocks confirm and shows an inline error when validate rejects the value', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const validate = (v: string) => (v.trim() ? undefined : 'Enter a file name.');
    render(
      <PromptDialog
        open
        onOpenChange={onOpenChange}
        description="Enter a name:"
        defaultValue=""
        placeholder="my-document"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        validate={validate}
      />,
    );
    fireEvent.click(screen.getByText('OK'));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('prompt-dialog-error').textContent).toBe('Enter a file name.');
  });

  it('confirms once the user types a valid value, clearing the error', () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const validate = (v: string) => (v.trim() ? undefined : 'Enter a file name.');
    render(
      <PromptDialog
        open
        onOpenChange={onOpenChange}
        description="Enter a name:"
        defaultValue=""
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        validate={validate}
      />,
    );
    fireEvent.click(screen.getByText('OK'));
    expect(screen.getByTestId('prompt-dialog-error')).toBeTruthy();

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'report' } });
    expect(screen.queryByTestId('prompt-dialog-error')).toBeNull();

    fireEvent.click(screen.getByText('OK'));
    expect(onConfirm).toHaveBeenCalledWith('report');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

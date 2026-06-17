/**
 * MemoryFactsSettings — RTL tests for the settings panel table.
 *
 * Verifies:
 *   - existing facts render as rows with delete buttons
 *   - manual-add input + Add button saves a new fact
 *   - empty state renders when no facts exist
 *   - data-testids match the spec
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MemoryFactsSettings } from '@/features/settings/MemoryFactsSettings';
import type { Fact } from '@/platform/rag/FactsService';

function makeFact(id: string, text: string): Fact {
  return {
    id,
    text,
    created: '2026-04-16T12:00:00.000Z',
    approved_by: 'user',
  };
}

describe('MemoryFactsSettings', () => {
  it('renders the empty state when no facts exist', () => {
    render(<MemoryFactsSettings initialFacts={[]} />);
    expect(screen.getByTestId('settings-facts-empty')).toBeTruthy();
    expect(screen.getByTestId('settings-facts-table')).toBeTruthy();
  });

  it('renders a row per fact with the expected testids', () => {
    const facts = [
      makeFact('a1', 'The user lives in Austin.'),
      makeFact('a2', 'The user ships on Keepance.'),
    ];
    render(<MemoryFactsSettings initialFacts={facts} />);
    expect(screen.getByTestId('settings-facts-row-a1')).toBeTruthy();
    expect(screen.getByTestId('settings-facts-row-a2')).toBeTruthy();
    expect(screen.getByTestId('settings-facts-delete-a1')).toBeTruthy();
    expect(screen.getByTestId('settings-facts-delete-a2')).toBeTruthy();
    expect(
      screen.getByText('The user lives in Austin.', { exact: false }),
    ).toBeTruthy();
  });

  it('invokes onDelete when a delete button is clicked', async () => {
    const onDelete = vi.fn(async () => true);
    render(
      <MemoryFactsSettings
        initialFacts={[makeFact('abc', 'Sample fact.')]}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId('settings-facts-delete-abc'));
    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('abc');
    });
  });

  it('invokes onAdd with the typed text and clears the input', async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<MemoryFactsSettings initialFacts={[]} onAdd={onAdd} />);
    const input = screen.getByTestId(
      'settings-facts-add-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'New fact here' } });
    fireEvent.click(screen.getByTestId('settings-facts-add'));
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('New fact here');
    });
    // Input clears after successful add
    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('does not call onAdd for empty or whitespace-only input', async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<MemoryFactsSettings initialFacts={[]} onAdd={onAdd} />);
    const input = screen.getByTestId(
      'settings-facts-add-input',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    const addButton = screen.getByTestId('settings-facts-add') as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
    fireEvent.click(addButton);
    // Even if the click fires, onAdd must not have been called.
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('submits via Enter keypress on the add input', async () => {
    const onAdd = vi.fn(async () => undefined);
    render(<MemoryFactsSettings initialFacts={[]} onAdd={onAdd} />);
    const input = screen.getByTestId('settings-facts-add-input');
    fireEvent.change(input, { target: { value: 'Enter submit' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('Enter submit');
    });
  });
});

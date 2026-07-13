import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette, type PaletteCommand } from './CommandPalette';

const commands: PaletteCommand[] = [
  {
    id: 'workspace.change',
    label: 'Change Workspace',
    category: 'workspace',
    action: vi.fn(),
  },
  {
    id: 'file.new-document',
    label: 'New Document',
    category: 'file',
    action: vi.fn(),
  },
  {
    id: 'file.save',
    label: 'Save File',
    category: 'file',
    action: vi.fn(),
  },
];

describe('CommandPalette', () => {
  it('filters out unrelated commands when searching for workspace', () => {
    render(<CommandPalette open onOpenChange={vi.fn()} commands={commands} />);

    fireEvent.change(
      screen.getByPlaceholderText('Type a command or search...'),
      { target: { value: 'workspace ' } }
    );

    expect(
      screen.getByRole('button', { name: /change workspace/i })
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /new document/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save file/i })
    ).not.toBeInTheDocument();
  });
});

// VG-4c — the FileTree per-file menu offers "Use as letterhead template" on
// `.docx` files and fires the callback with the file's path. Non-`.docx` files
// (and callers that wire no handler) do not get the action.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';

import { FileTree } from '@/platform/fs/ui/FileTree';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { FileNode } from '@/types/workspace';

const docxNode: FileNode = {
  id: 'n-docx',
  name: 'letterhead.docx',
  path: '/ws/letterhead.docx',
  type: 'file',
};
const mdNode: FileNode = {
  id: 'n-md',
  name: 'notes.md',
  path: '/ws/notes.md',
  type: 'file',
};

function seedStore() {
  useWorkspaceStore.setState({
    rootPath: '/ws',
    fileTree: [docxNode, mdNode],
    selectedPath: null,
    expandedPaths: new Set<string>(),
    selectedPaths: new Set<string>(),
    lastSelectedPath: null,
  } as Partial<ReturnType<typeof useWorkspaceStore.getState>> as never);
}

/** Open the per-file "File options" dropdown for the row carrying `label`. */
async function openMenuFor(label: string) {
  const row = screen.getByText(label).closest('div');
  expect(row).toBeTruthy();
  const trigger = within(row as HTMLElement).getByLabelText('File options');
  // Radix DropdownMenu opens on pointerdown; setup.ts polyfills the pointer
  // capture APIs jsdom lacks so the menu mounts.
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

describe('FileTree — letterhead template menu action', () => {
  beforeEach(() => seedStore());
  afterEach(() => cleanup());

  it('shows the action on a .docx file and fires the callback with its path', async () => {
    const onSetLetterheadTemplate = vi.fn();
    render(
      <FileTree
        onFileOpen={vi.fn()}
        onSetLetterheadTemplate={onSetLetterheadTemplate}
      />,
    );

    await openMenuFor('letterhead.docx');
    const item = await screen.findByTestId('use-as-letterhead');
    expect(item).toBeInTheDocument();

    fireEvent.click(item);
    expect(onSetLetterheadTemplate).toHaveBeenCalledWith('/ws/letterhead.docx');
  });

  it('does not show the action on a non-.docx file', async () => {
    render(<FileTree onFileOpen={vi.fn()} onSetLetterheadTemplate={vi.fn()} />);

    await openMenuFor('notes.md');
    // The menu is open (Rename is always present); the letterhead item is not.
    await waitFor(() => expect(screen.getByText('Rename')).toBeInTheDocument());
    expect(screen.queryByTestId('use-as-letterhead')).not.toBeInTheDocument();
  });

  it('does not show the action when no handler is wired (browser/test callers)', async () => {
    render(<FileTree onFileOpen={vi.fn()} />);

    await openMenuFor('letterhead.docx');
    await waitFor(() => expect(screen.getByText('Rename')).toBeInTheDocument());
    expect(screen.queryByTestId('use-as-letterhead')).not.toBeInTheDocument();
  });
});

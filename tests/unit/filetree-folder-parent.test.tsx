// Fix: toolbar "Folder" button should create inside the currently-selected
// folder (or the parent of the selected file) rather than always at root.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { FileTree } from '@/platform/fs/ui/FileTree';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { FileNode } from '@/types/workspace';

// Tree shape: Client > Matter (folder) > brief.docx
const matterFolder: FileNode = {
  id: 'n-matter',
  name: 'Matter',
  path: '/ws/Client/Matter',
  type: 'folder',
  children: [
    {
      id: 'n-brief',
      name: 'brief.docx',
      path: '/ws/Client/Matter/brief.docx',
      type: 'file',
    },
  ],
};
const clientFolder: FileNode = {
  id: 'n-client',
  name: 'Client',
  path: '/ws/Client',
  type: 'folder',
  children: [matterFolder],
};

function seedStore(selectedPath: string | null = null) {
  useWorkspaceStore.setState({
    rootPath: '/ws',
    fileTree: [clientFolder],
    selectedPath,
    expandedPaths: new Set<string>(['/ws/Client', '/ws/Client/Matter']),
    selectedPaths: new Set<string>(),
    lastSelectedPath: null,
  } as Partial<ReturnType<typeof useWorkspaceStore.getState>> as never);
}

describe('FileTree toolbar — Folder button parent resolution', () => {
  afterEach(() => cleanup());

  it('creates at root when nothing is selected (fall-back)', () => {
    seedStore(null);
    const onCreateFolderAtRoot = vi.fn();
    const onCreateFolder = vi.fn();
    render(
      <FileTree
        onFileOpen={vi.fn()}
        onCreateFolder={onCreateFolder}
        onCreateFolderAtRoot={onCreateFolderAtRoot}
      />,
    );
    const btn = screen.getByTestId('new-folder-button');
    fireEvent.click(btn);
    expect(onCreateFolderAtRoot).toHaveBeenCalledTimes(1);
    expect(onCreateFolder).not.toHaveBeenCalled();
  });

  it('creates inside the selected folder when a folder is selected', () => {
    seedStore('/ws/Client/Matter');
    const onCreateFolderAtRoot = vi.fn();
    const onCreateFolder = vi.fn();
    render(
      <FileTree
        onFileOpen={vi.fn()}
        onCreateFolder={onCreateFolder}
        onCreateFolderAtRoot={onCreateFolderAtRoot}
      />,
    );
    const btn = screen.getByTestId('new-folder-button');
    fireEvent.click(btn);
    // Must call onCreateFolder with the selected folder's path, not root
    expect(onCreateFolder).toHaveBeenCalledWith('/ws/Client/Matter');
    expect(onCreateFolderAtRoot).not.toHaveBeenCalled();
  });

  it('creates inside the parent directory when a file is selected', () => {
    seedStore('/ws/Client/Matter/brief.docx');
    const onCreateFolderAtRoot = vi.fn();
    const onCreateFolder = vi.fn();
    render(
      <FileTree
        onFileOpen={vi.fn()}
        onCreateFolder={onCreateFolder}
        onCreateFolderAtRoot={onCreateFolderAtRoot}
      />,
    );
    const btn = screen.getByTestId('new-folder-button');
    fireEvent.click(btn);
    // brief.docx is inside /ws/Client/Matter — should target that folder
    expect(onCreateFolder).toHaveBeenCalledWith('/ws/Client/Matter');
    expect(onCreateFolderAtRoot).not.toHaveBeenCalled();
  });

  it('falls back to onCreateFolderAtRoot when onCreateFolder is not wired but folder is selected', () => {
    seedStore('/ws/Client/Matter');
    const onCreateFolderAtRoot = vi.fn();
    render(
      <FileTree
        onFileOpen={vi.fn()}
        onCreateFolderAtRoot={onCreateFolderAtRoot}
        // onCreateFolder intentionally not provided
      />,
    );
    const btn = screen.getByTestId('new-folder-button');
    fireEvent.click(btn);
    expect(onCreateFolderAtRoot).toHaveBeenCalledTimes(1);
  });
});

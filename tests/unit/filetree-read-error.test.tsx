// F2.4: a folder whose contents couldn't be read (permission denied, an
// offline network/OneDrive location) used to render as an ordinary,
// indistinguishable empty folder. It must now show a visible warning.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { FileTree } from '@/features/documents/workspace/FileTree';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { FileNode } from '@/platform/types/workspace';

function seedStore(fileTree: FileNode[]) {
  useWorkspaceStore.setState({
    rootPath: '/ws',
    fileTree,
    selectedPath: null,
    expandedPaths: new Set<string>(['/ws/Clients']),
    selectedPaths: new Set<string>(),
    lastSelectedPath: null,
  } as Partial<ReturnType<typeof useWorkspaceStore.getState>> as never);
}

describe('FileTree — folder read-error indicator', () => {
  afterEach(() => cleanup());

  it('shows a warning on a folder flagged readError', () => {
    seedStore([
      {
        id: 'n-clients',
        name: 'Clients',
        path: '/ws/Clients',
        type: 'folder',
        children: [],
        readError: true,
      },
    ]);
    render(<FileTree onFileOpen={vi.fn()} />);
    expect(screen.getByTestId('folder-read-error')).toBeInTheDocument();
  });

  it('does not show a warning on an ordinary empty folder', () => {
    seedStore([
      {
        id: 'n-empty',
        name: 'Empty',
        path: '/ws/Empty',
        type: 'folder',
        children: [],
      },
    ]);
    render(<FileTree onFileOpen={vi.fn()} />);
    expect(screen.queryByTestId('folder-read-error')).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { useState } from 'react';

import { FileTree } from '@/features/documents/workspace/FileTree';
import { VersionHistoryPanel } from '@/features/documents/versioning';
import { getVersionService } from '@/features/documents/versioning/VersionService';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { FileNode } from '@/platform/types/workspace';

const fileOne: FileNode = {
  id: 'file-alpha',
  name: 'alpha.txt',
  path: '/ws/alpha.txt',
  type: 'file',
};

const fileTwo: FileNode = {
  id: 'file-beta',
  name: 'beta.txt',
  path: '/ws/beta.txt',
  type: 'file',
};

function seedFileTree(selectedPaths = new Set<string>()) {
  useWorkspaceStore.setState({
    rootPath: '/ws',
    fileTree: [fileOne, fileTwo],
    selectedPath: null,
    expandedPaths: new Set<string>(),
    selectedPaths,
    lastSelectedPath: null,
  } as Partial<ReturnType<typeof useWorkspaceStore.getState>> as never);
}

function BatchDeleteHarness() {
  const [trash, setTrash] = useState<string[]>([]);

  const handleDelete = async (path: string) => {
    setTrash((items) => [...items, path]);
    useWorkspaceStore.setState((state) => ({
      fileTree: state.fileTree.filter((node) => node.path !== path),
    }));
  };

  return (
    <div>
      <FileTree
        onFileOpen={vi.fn()}
        onDelete={(path) => {
          void handleDelete(path);
        }}
        onConfirm={async () => true}
      />
      <section aria-label="Trash">
        {trash.map((path) => (
          <div key={path}>{path.split('/').pop()}</div>
        ))}
      </section>
    </div>
  );
}

function VersionRestoreHarness() {
  const [content, setContent] = useState('Current filing position');
  const [closed, setClosed] = useState(false);

  return (
    <div>
      <textarea aria-label="File content" readOnly value={content} />
      {!closed && (
        <VersionHistoryPanel
          filePath="/ws/memo.txt"
          fileName="memo.txt"
          currentContent={content}
          onRestore={setContent}
          onClose={() => {
            setClosed(true);
          }}
        />
      )}
    </div>
  );
}

describe('High-risk files coverage', () => {
  beforeEach(() => {
    localStorage.clear();
    getVersionService().clearAllVersions();
    seedFileTree(new Set<string>());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('FT-17 batch-deletes selected files into Trash and clears the selection bar', async () => {
    seedFileTree(new Set(['/ws/alpha.txt', '/ws/beta.txt']));

    render(<BatchDeleteHarness />);

    expect(screen.getByText('2 items selected')).toBeInTheDocument();
    expect(screen.getByText('alpha.txt')).toBeInTheDocument();
    expect(screen.getByText('beta.txt')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('batch-delete'));

    await waitFor(() => {
      expect(screen.queryByText('2 items selected')).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId('batch-delete')).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().selectedPaths.size).toBe(0);
    expect(useWorkspaceStore.getState().fileTree.map((node) => node.path)).toEqual([]);
    expect(screen.getByRole('region', { name: 'Trash' })).toHaveTextContent('alpha.txt');
    expect(screen.getByRole('region', { name: 'Trash' })).toHaveTextContent('beta.txt');
  });

  it('VH-05 restores an older text version so the visible file content reverts', async () => {
    await getVersionService().saveVersion(
      '/ws/memo.txt',
      'Original client-safe language',
      'Initial draft',
    );
    await getVersionService().saveVersion(
      '/ws/memo.txt',
      'Current filing position',
      'Current draft',
    );

    render(<VersionRestoreHarness />);

    expect(screen.getByLabelText('File content')).toHaveValue('Current filing position');
    expect(screen.getByText('Initial draft')).toBeInTheDocument();

    const restoreButtons = screen.getAllByTitle('Restore this version');
    fireEvent.click(restoreButtons[1]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(screen.getByLabelText('File content')).toHaveValue('Original client-safe language');
    });
    expect(screen.queryByText('Version History')).not.toBeInTheDocument();
  });
});

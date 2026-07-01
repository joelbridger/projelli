// WebView2 dialog fix: native window.confirm is dead in the Tauri Windows build
// (renders nothing AND returns a truthy object), so the FileTree bulk-delete
// guard used to proceed WITHOUT the user ever confirming — a data-loss risk,
// since the real app (DocumentsHome) does not pass an `onConfirm` prop.
//
// These tests drive the REAL wired path: FileTree with NO onConfirm prop must
// fall back to its OWN in-app ConfirmDialog (not window.confirm), and must NOT
// delete anything when the user cancels.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { FileTree } from '@/features/documents/workspace/FileTree';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import type { FileNode } from '@/platform/types/workspace';

const fileA: FileNode = { id: 'a', name: 'a.docx', path: '/ws/a.docx', type: 'file' };
const fileB: FileNode = { id: 'b', name: 'b.docx', path: '/ws/b.docx', type: 'file' };

function seedSelected(paths: string[]) {
  useWorkspaceStore.setState({
    rootPath: '/ws',
    fileTree: [fileA, fileB],
    selectedPath: null,
    expandedPaths: new Set<string>(),
    selectedPaths: new Set<string>(paths),
    lastSelectedPath: paths[paths.length - 1] ?? null,
  } as Partial<ReturnType<typeof useWorkspaceStore.getState>> as never);
}

describe('FileTree bulk delete — in-app confirm fallback (WebView2 fix)', () => {
  afterEach(() => cleanup());

  it('opens the in-app ConfirmDialog (not window.confirm) and does NOT delete when cancelled', async () => {
    // Guard: if the real code ever called window.confirm again, this spy would
    // catch it. It must NOT be called — the fix routes to the in-DOM dialog.
    const nativeConfirm = vi.spyOn(window, 'confirm');
    seedSelected(['/ws/a.docx', '/ws/b.docx']);
    const onDelete = vi.fn(async () => undefined);

    // NOTE: no onConfirm prop — this is exactly how DocumentsHome renders it.
    render(<FileTree onFileOpen={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByTestId('batch-delete'));

    // The in-app dialog appears in the DOM (this is what was broken on Windows).
    const dialog = await screen.findByText('Delete selected files');
    expect(dialog).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();

    // User cancels → nothing is deleted.
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => {
      expect(screen.queryByText('Delete selected files')).not.toBeInTheDocument();
    });
    expect(onDelete).not.toHaveBeenCalled();

    nativeConfirm.mockRestore();
  });

  it('deletes each selected file only after the user confirms', async () => {
    seedSelected(['/ws/a.docx', '/ws/b.docx']);
    const onDelete = vi.fn(async () => undefined);

    render(<FileTree onFileOpen={vi.fn()} onDelete={onDelete} />);

    fireEvent.click(screen.getByTestId('batch-delete'));
    await screen.findByText('Delete selected files');

    // Confirm label reflects the count ("Move 2 to Trash").
    fireEvent.click(screen.getByText('Move 2 to Trash'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledTimes(2);
    });
    expect(onDelete).toHaveBeenCalledWith('/ws/a.docx');
    expect(onDelete).toHaveBeenCalledWith('/ws/b.docx');
  });
});

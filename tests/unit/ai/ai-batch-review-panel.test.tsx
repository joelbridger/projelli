/**
 * BUG-060 (layer 3, batch mode) — the end-of-turn review panel. Verifies it
 * lists every captured change, that "Keep all" dismisses without touching the
 * disk, and that selecting a change + "Undo selected" reverses it via the store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AiBatchReviewPanel } from '@/features/ask/AiBatchReviewPanel';
import { useAiBatchReviewStore } from '@/platform/ai/aiBatchReviewStore';
import type { UndoFs } from '@/platform/ai/aiBatchReview';

function recordingFs(): UndoFs & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async writeFileBinary(path) { calls.push(`write:${path}`); },
    async delete(path) { calls.push(`delete:${path}`); },
    async move(from, to) { calls.push(`move:${from}->${to}`); },
    async exists() { return false; },
  };
}

describe('AiBatchReviewPanel', () => {
  beforeEach(() => {
    useAiBatchReviewStore.getState().reset();
    useAiBatchReviewStore.getState().setUndoFs(null);
  });
  afterEach(() => {
    useAiBatchReviewStore.getState().reset();
    cleanup();
  });

  it('renders nothing when the review is closed', () => {
    render(<AiBatchReviewPanel />);
    expect(screen.queryByTestId('ai-batch-review-panel')).toBeNull();
  });

  it('lists each captured change with its path when the review is open', () => {
    const s = useAiBatchReviewStore.getState();
    s.record({ kind: 'create_file', path: 'Acme/draft.md', fullPath: '/ws/Acme/draft.md', binary: false, undoable: true, afterText: 'hello' });
    s.record({ kind: 'move_file', from: 'a.md', to: 'b.md', fullFrom: '/ws/a.md', fullTo: '/ws/b.md', destExisted: false, undoable: true });
    s.openReview();
    render(<AiBatchReviewPanel />);

    expect(screen.getByTestId('ai-batch-review-panel')).toBeTruthy();
    const rows = screen.getAllByTestId('ai-batch-change');
    expect(rows).toHaveLength(2);
    expect(screen.getByText(/Acme\/draft\.md/)).toBeTruthy();
    expect(screen.getByText(/a\.md.*b\.md/)).toBeTruthy();
  });

  it('"Keep all" dismisses the review without touching the disk', () => {
    const fs = recordingFs();
    const s = useAiBatchReviewStore.getState();
    s.setUndoFs(fs);
    s.record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    s.openReview();
    render(<AiBatchReviewPanel />);

    fireEvent.click(screen.getByTestId('ai-batch-keep-all'));

    expect(fs.calls).toEqual([]); // nothing undone
    expect(useAiBatchReviewStore.getState().reviewOpen).toBe(false);
    expect(useAiBatchReviewStore.getState().changes).toEqual([]);
  });

  it('selecting a change and clicking "Undo selected" reverses it', async () => {
    const fs = recordingFs();
    const s = useAiBatchReviewStore.getState();
    s.setUndoFs(fs);
    s.record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    s.openReview();
    const id = useAiBatchReviewStore.getState().changes[0]!.id;
    render(<AiBatchReviewPanel />);

    fireEvent.click(screen.getByTestId(`ai-batch-select-${id}`));
    fireEvent.click(screen.getByTestId('ai-batch-undo-selected'));

    await waitFor(() => {
      expect(fs.calls).toEqual(['delete:/ws/a.md']);
    });
    expect(useAiBatchReviewStore.getState().changes).toEqual([]);
  });

  it('undoes selected changes in REVERSE applied order (so dependent changes reverse correctly)', async () => {
    const fs = recordingFs();
    const s = useAiBatchReviewStore.getState();
    s.setUndoFs(fs);
    // Applied order: overwrite a.md, THEN move a.md → b.md.
    s.record({ kind: 'overwrite_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true, beforeBytes: (() => { const u = new TextEncoder().encode('old'); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); })() });
    s.record({ kind: 'move_file', from: 'a.md', to: 'b.md', fullFrom: '/ws/a.md', fullTo: '/ws/b.md', destExisted: false, undoable: true });
    s.openReview();
    const ids = useAiBatchReviewStore.getState().changes.map((c) => c.id);
    render(<AiBatchReviewPanel />);

    ids.forEach((id) => fireEvent.click(screen.getByTestId(`ai-batch-select-${id}`)));
    fireEvent.click(screen.getByTestId('ai-batch-undo-selected'));

    await waitFor(() => {
      // Move is undone FIRST (b.md → a.md), THEN a.md's bytes are restored.
      expect(fs.calls).toEqual(['move:/ws/b.md->/ws/a.md', 'write:/ws/a.md']);
    });
  });

  it('refuses an unsafe partial undo (keeps the disk untouched, shows a warning)', async () => {
    const fs = recordingFs();
    const s = useAiBatchReviewStore.getState();
    s.setUndoFs(fs);
    // AI creates a folder, then a file inside it.
    s.record({ kind: 'create_folder', path: 'Archive', fullPath: '/ws/Archive', undoable: true });
    s.record({ kind: 'create_file', path: 'Archive/note.md', fullPath: '/ws/Archive/note.md', binary: false, undoable: true });
    s.openReview();
    const folderId = useAiBatchReviewStore.getState().changes[0]!.id;
    render(<AiBatchReviewPanel />);

    // Select ONLY the folder (whose undo would recursively delete the kept file).
    fireEvent.click(screen.getByTestId(`ai-batch-select-${folderId}`));
    fireEvent.click(screen.getByTestId('ai-batch-undo-selected'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-batch-block-msg')).toBeTruthy();
    });
    expect(fs.calls).toEqual([]); // nothing was undone
    expect(useAiBatchReviewStore.getState().changes).toHaveLength(2); // both kept
  });

  it('a change that cannot be undone is not selectable', () => {
    const s = useAiBatchReviewStore.getState();
    s.record({ kind: 'overwrite_file', path: 'big.bin', fullPath: '/ws/big.bin', binary: true, undoable: false });
    s.openReview();
    render(<AiBatchReviewPanel />);

    const checkbox = screen.getByTestId(`ai-batch-select-${useAiBatchReviewStore.getState().changes[0]!.id}`) as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByTestId('ai-batch-not-undoable')).toBeTruthy();
  });
});

/**
 * BUG-060 (layer 3, batch mode) — the batch-review store.
 *
 * Collects every change the AI applied during a `batch`-mode turn, opens a
 * single end-of-turn review, and undoes any change via the registered UndoFs.
 * A failed undo keeps the change and surfaces an honest error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAiBatchReviewStore } from '@/platform/ai/aiBatchReviewStore';
import { useEditorStore } from '@/platform/state/editorStore';
import type { UndoFs } from '@/platform/ai/aiBatchReview';

const bytes = (s: string): ArrayBuffer => {
  const u8 = new TextEncoder().encode(s);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
};

function recordingFs(opts: { failOn?: 'delete' | 'write' } = {}): UndoFs & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async writeFileBinary(path) {
      if (opts.failOn === 'write') throw new Error('disk full');
      calls.push(`write:${path}`);
    },
    async delete(path) {
      if (opts.failOn === 'delete') throw new Error('permission denied');
      calls.push(`delete:${path}`);
    },
    async move(from, to) {
      calls.push(`move:${from}->${to}`);
    },
    async exists() {
      return false;
    },
  };
}

describe('aiBatchReviewStore', () => {
  beforeEach(() => {
    useAiBatchReviewStore.getState().reset();
    useAiBatchReviewStore.getState().setUndoFs(null);
    useEditorStore.setState({ openTabs: [] });
  });

  it('record assigns unique ids and accumulates changes in order', () => {
    const s = useAiBatchReviewStore.getState();
    s.record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    s.record({ kind: 'delete_file', path: 'b.md', fullPath: '/ws/b.md', binary: false, undoable: true, trashPath: '/ws/.trash/1_b.md' });
    const { changes } = useAiBatchReviewStore.getState();
    expect(changes).toHaveLength(2);
    expect(changes[0]?.kind).toBe('create_file');
    expect(changes[1]?.kind).toBe('delete_file');
    expect(changes[0]?.id).toBeTruthy();
    expect(changes[0]?.id).not.toBe(changes[1]?.id);
  });

  it('openReview only opens when there is at least one change', () => {
    useAiBatchReviewStore.getState().openReview();
    expect(useAiBatchReviewStore.getState().reviewOpen).toBe(false);

    useAiBatchReviewStore.getState().record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    useAiBatchReviewStore.getState().openReview();
    expect(useAiBatchReviewStore.getState().reviewOpen).toBe(true);
  });

  it('reset clears changes + errors and closes the review', () => {
    const s = useAiBatchReviewStore.getState();
    s.record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    s.openReview();
    s.reset();
    const after = useAiBatchReviewStore.getState();
    expect(after.changes).toEqual([]);
    expect(after.reviewOpen).toBe(false);
    expect(after.undoErrors).toEqual({});
  });

  it('undo runs executeUndo via the registered fs and removes the change', async () => {
    const fs = recordingFs();
    useAiBatchReviewStore.getState().setUndoFs(fs);
    useAiBatchReviewStore.getState().record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    const id = useAiBatchReviewStore.getState().changes[0]!.id;

    await useAiBatchReviewStore.getState().undo(id);

    expect(fs.calls).toEqual(['delete:/ws/a.md']);
    expect(useAiBatchReviewStore.getState().changes).toEqual([]);
  });

  it('undoing the last change closes the review', async () => {
    const fs = recordingFs();
    const s = useAiBatchReviewStore.getState();
    s.setUndoFs(fs);
    s.record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    s.openReview();
    const id = useAiBatchReviewStore.getState().changes[0]!.id;

    await useAiBatchReviewStore.getState().undo(id);

    expect(useAiBatchReviewStore.getState().reviewOpen).toBe(false);
  });

  it('fires the onChanged callback after a successful undo', async () => {
    const fs = recordingFs();
    const onChanged = vi.fn();
    useAiBatchReviewStore.getState().setUndoFs(fs, onChanged);
    useAiBatchReviewStore.getState().record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    const id = useAiBatchReviewStore.getState().changes[0]!.id;

    await useAiBatchReviewStore.getState().undo(id);

    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a failed undo keeps the change and records an honest error', async () => {
    const fs = recordingFs({ failOn: 'delete' });
    useAiBatchReviewStore.getState().setUndoFs(fs);
    useAiBatchReviewStore.getState().record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    const id = useAiBatchReviewStore.getState().changes[0]!.id;

    await useAiBatchReviewStore.getState().undo(id);

    const after = useAiBatchReviewStore.getState();
    expect(after.changes).toHaveLength(1); // not removed
    expect(after.undoErrors[id]).toMatch(/permission denied/i);
  });

  it('refuses to undo a change whose file is open with unsaved edits (BUG-047 guard)', async () => {
    const fs = recordingFs();
    useAiBatchReviewStore.getState().setUndoFs(fs);
    useAiBatchReviewStore.getState().record({ kind: 'overwrite_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true, beforeBytes: bytes('old') });
    const id = useAiBatchReviewStore.getState().changes[0]!.id;
    // The user has that file open with unsaved edits.
    useEditorStore.setState({ openTabs: [{ path: '/ws/a.md', name: 'a.md', content: 'edited', isDirty: true }] });

    await useAiBatchReviewStore.getState().undo(id);

    const after = useAiBatchReviewStore.getState();
    expect(fs.calls).toEqual([]); // nothing written
    expect(after.changes).toHaveLength(1); // change kept
    expect(after.undoErrors[id]).toMatch(/unsaved/i);
  });

  it('undo with no registered fs records an error and keeps the change', async () => {
    useAiBatchReviewStore.getState().setUndoFs(null);
    useAiBatchReviewStore.getState().record({ kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true });
    const id = useAiBatchReviewStore.getState().changes[0]!.id;

    await useAiBatchReviewStore.getState().undo(id);

    const after = useAiBatchReviewStore.getState();
    expect(after.changes).toHaveLength(1);
    expect(after.undoErrors[id]).toBeTruthy();
  });
});

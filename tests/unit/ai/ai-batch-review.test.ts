/**
 * BUG-060 (layer 3, batch mode) — the PURE undo executor.
 *
 * In `batch` mode the AI's file tools apply immediately but each change is
 * captured so the whole turn can be reviewed and any change undone. This tests
 * that `executeUndo` reverses each op kind correctly against a fake fs:
 *   create_file   → delete the created file
 *   create_folder → delete the created folder
 *   overwrite_file→ restore the captured before-bytes
 *   delete_file   → restore the captured before-bytes
 *   move_file     → move it back (and restore an overwritten destination)
 */
import { describe, it, expect } from 'vitest';
import { executeUndo, unsafePartialUndos, type BatchChange, type UndoFs } from '@/platform/ai/aiBatchReview';

const bytes = (s: string): ArrayBuffer => {
  const u8 = new TextEncoder().encode(s);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
};
const decode = (b: ArrayBuffer): string => new TextDecoder().decode(new Uint8Array(b));

function makeFs() {
  const calls: string[] = [];
  const writes: Array<{ path: string; text: string }> = [];
  const fs: UndoFs = {
    async writeFileBinary(path, content) {
      calls.push(`write:${path}`);
      writes.push({ path, text: decode(content) });
    },
    async delete(path) {
      calls.push(`delete:${path}`);
    },
    async move(from, to) {
      calls.push(`move:${from}->${to}`);
    },
    async exists() {
      return false;
    },
  };
  return { fs, calls, writes };
}

describe('executeUndo', () => {
  it('undoes a create_file by deleting the created file', async () => {
    const { fs, calls } = makeFs();
    const change: BatchChange = {
      id: '1', kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true,
    };
    await executeUndo(change, fs);
    expect(calls).toEqual(['delete:/ws/a.md']);
  });

  it('undoes a create_folder by deleting the created folder', async () => {
    const { fs, calls } = makeFs();
    const change: BatchChange = {
      id: '2', kind: 'create_folder', path: 'sub', fullPath: '/ws/sub', undoable: true,
    };
    await executeUndo(change, fs);
    expect(calls).toEqual(['delete:/ws/sub']);
  });

  it('undoes an overwrite_file by restoring the captured before-bytes', async () => {
    const { fs, calls, writes } = makeFs();
    const change: BatchChange = {
      id: '3', kind: 'overwrite_file', path: 'a.md', fullPath: '/ws/a.md',
      binary: false, undoable: true, beforeBytes: bytes('OLD'), beforeText: 'OLD', afterText: 'NEW',
    };
    await executeUndo(change, fs);
    expect(calls).toEqual(['write:/ws/a.md']);
    expect(writes[0]?.text).toBe('OLD');
  });

  it('undoes a delete_file by restoring the captured before-bytes', async () => {
    const { fs, calls, writes } = makeFs();
    const change: BatchChange = {
      id: '4', kind: 'delete_file', path: 'gone.md', fullPath: '/ws/gone.md',
      binary: false, undoable: true, beforeBytes: bytes('CONTENT'), beforeText: 'CONTENT',
    };
    await executeUndo(change, fs);
    expect(calls).toEqual(['write:/ws/gone.md']);
    expect(writes[0]?.text).toBe('CONTENT');
  });

  it('undoes a move_file (empty destination) by moving it back', async () => {
    const { fs, calls } = makeFs();
    const change: BatchChange = {
      id: '5', kind: 'move_file', from: 'a.md', to: 'b.md',
      fullFrom: '/ws/a.md', fullTo: '/ws/b.md', destExisted: false, undoable: true,
    };
    await executeUndo(change, fs);
    expect(calls).toEqual(['move:/ws/b.md->/ws/a.md']);
  });

  it('undoes a move onto an existing file by moving back AND restoring the replaced file', async () => {
    const { fs, calls, writes } = makeFs();
    const change: BatchChange = {
      id: '6', kind: 'move_file', from: 'a.md', to: 'b.md',
      fullFrom: '/ws/a.md', fullTo: '/ws/b.md', destExisted: true, undoable: true,
      destBeforeBytes: bytes('ORIGINAL-B'),
    };
    await executeUndo(change, fs);
    // First move the file back, then restore what used to live at the destination.
    expect(calls).toEqual(['move:/ws/b.md->/ws/a.md', 'write:/ws/b.md']);
    expect(writes[0]?.text).toBe('ORIGINAL-B');
  });

  it('throws when an overwrite is not undoable (before-bytes were not captured)', async () => {
    const { fs } = makeFs();
    const change: BatchChange = {
      id: '7', kind: 'overwrite_file', path: 'big.bin', fullPath: '/ws/big.bin',
      binary: true, undoable: false,
    };
    await expect(executeUndo(change, fs)).rejects.toThrow(/can.?t be undone|not.*captured/i);
  });

  it('an un-undoable move (dest snapshot missing) makes ZERO fs changes (no half-undo)', async () => {
    const { fs, calls } = makeFs();
    const change: BatchChange = {
      id: '8', kind: 'move_file', from: 'a.md', to: 'b.md',
      fullFrom: '/ws/a.md', fullTo: '/ws/b.md', destExisted: true, undoable: false,
      // destBeforeBytes intentionally absent (was too large to snapshot).
    };
    await expect(executeUndo(change, fs)).rejects.toThrow(/can.?t be undone|wasn.t captured/i);
    expect(calls).toEqual([]); // critically: it did NOT move the file back first
  });
});

describe('unsafePartialUndos', () => {
  const folder = (id: string, path: string): BatchChange => ({ id, kind: 'create_folder', path, fullPath: `/ws/${path}`, undoable: true });
  const create = (id: string, path: string): BatchChange => ({ id, kind: 'create_file', path, fullPath: `/ws/${path}`, binary: false, undoable: true });

  it('flags a folder-create whose undo would delete a KEPT file the AI later put inside it', () => {
    const changes = [folder('f1', 'Archive'), create('c1', 'Archive/note.md')];
    // User selects only the folder (f1), keeping the file (c1).
    expect(unsafePartialUndos(['f1'], changes)).toEqual(['f1']);
  });

  it('does NOT flag when the whole dependent chain is selected', () => {
    const changes = [folder('f1', 'Archive'), create('c1', 'Archive/note.md')];
    expect(unsafePartialUndos(['f1', 'c1'], changes)).toEqual([]);
  });

  it('does NOT flag independent changes in different folders', () => {
    const changes = [create('c1', 'A/x.md'), create('c2', 'B/y.md')];
    expect(unsafePartialUndos(['c1'], changes)).toEqual([]);
  });

  it('flags restoring an overwrite when a KEPT later change recreated the same path', () => {
    const changes: BatchChange[] = [
      { id: 'o1', kind: 'overwrite_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true, beforeBytes: new ArrayBuffer(1) },
      { id: 'm1', kind: 'move_file', from: 'a.md', to: 'b.md', fullFrom: '/ws/a.md', fullTo: '/ws/b.md', destExisted: false, undoable: true },
      { id: 'c1', kind: 'create_file', path: 'a.md', fullPath: '/ws/a.md', binary: false, undoable: true },
    ];
    // Undoing only the overwrite would write old bytes over the KEPT new a.md.
    expect(unsafePartialUndos(['o1'], changes)).toEqual(['o1']);
  });
});

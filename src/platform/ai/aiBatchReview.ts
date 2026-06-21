/**
 * AI file-tool BATCH review + undo (BUG-060, layer 3).
 *
 * In `batch` approval mode the AI's chat file tools (`write_file`,
 * `create_folder`, `move_file`, `delete_file`) apply IMMEDIATELY — the model is
 * not paused per action. To keep the user in control, every applied change is
 * captured for a single end-of-turn review where the user can keep everything
 * or undo any subset. This module holds the data shape of a captured change and
 * the PURE logic that reverses one against a small fs interface.
 *
 * Reversibility is achieved by capturing the BEFORE state up front:
 *   - overwrite / delete  → snapshot the file's bytes before the op, then undo
 *     by writing those bytes back (uniform for text and binary; independent of
 *     any Trash implementation).
 *   - create file/folder  → undo by deleting what was created.
 *   - move                → undo by moving back; if it overwrote an existing
 *     destination, that destination's bytes are also snapshotted and restored.
 *
 * `undoable` is false when the before-bytes could not be captured (e.g. the file
 * was larger than the snapshot cap, or unreadable) — the review still lists the
 * change, but its undo is disabled with an honest reason.
 *
 * Keeping the undo logic pure (an injected `UndoFs`) makes the data-loss-
 * sensitive reversal unit-testable without a real workspace.
 */

/**
 * Paths whose on-disk CONTENT is destroyed or replaced by undoing this change
 * (a create's undo deletes; a folder-create's undo deletes recursively; an
 * overwrite/delete's undo writes back; a move's undo reoccupies both ends).
 */
function undoDestroysPaths(c: BatchChange): string[] {
  switch (c.kind) {
    case 'create_file':
    case 'create_folder':
    case 'overwrite_file':
    case 'delete_file':
      return [c.fullPath];
    case 'move_file':
      return [c.fullFrom, c.fullTo];
  }
}

/** The path this change's result currently occupies on disk, or null (a delete). */
function liveResultPath(c: BatchChange): string | null {
  switch (c.kind) {
    case 'create_file':
    case 'overwrite_file':
    case 'create_folder':
      return c.fullPath;
    case 'move_file':
      return c.fullTo;
    case 'delete_file':
      return null; // its result is "absent", so nothing of it can be clobbered
  }
}

/** True if `p` is `ancestor` itself or lives under it (folder-recursive aware). */
function isUnderOrEqual(p: string, ancestor: string): boolean {
  if (p === ancestor) return true;
  const prefix = ancestor.endsWith('/') ? ancestor : `${ancestor}/`;
  return p.startsWith(prefix);
}

/**
 * Of the SELECTED changes, which can't be safely undone on their own because
 * undoing them would destroy a NON-selected change's live result (a later
 * change the user is keeping). Used to refuse an unsafe partial undo instead of
 * silently clobbering kept work. Returns the offending selected ids.
 *
 * Undoing the FULL set (or a clean suffix) is always safe — the panel undoes in
 * reverse order — so a change only conflicts with a kept (non-selected) other.
 */
export function unsafePartialUndos(selectedIds: readonly string[], changes: readonly BatchChange[]): string[] {
  const selected = new Set(selectedIds);
  const unsafe: string[] = [];
  for (const c of changes) {
    if (!selected.has(c.id)) continue;
    const destroys = undoDestroysPaths(c);
    const conflicts = changes.some((d) => {
      if (d.id === c.id || selected.has(d.id)) return false; // only KEPT others
      const live = liveResultPath(d);
      return live !== null && destroys.some((p) => isUnderOrEqual(live, p));
    });
    if (conflicts) unsafe.push(c.id);
  }
  return unsafe;
}

/** The minimal filesystem surface the undo needs (a subset of WorkspaceService). */
export interface UndoFs {
  writeFileBinary(path: string, content: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** A single AI file change captured in batch mode, enough to display + reverse it. */
export type BatchChange =
  | {
      id: string;
      kind: 'create_file';
      path: string;
      fullPath: string;
      binary: boolean;
      /** The created content (for a text preview in the review). */
      afterText?: string | undefined;
      /** Creates are always reversible (undo = delete). */
      undoable: true;
    }
  | {
      id: string;
      kind: 'overwrite_file';
      path: string;
      fullPath: string;
      binary: boolean;
      /** Snapshot of the file's bytes BEFORE the overwrite (for undo). */
      beforeBytes?: ArrayBuffer | undefined;
      /** Text before/after (for the diff; absent for binary). */
      beforeText?: string | undefined;
      afterText?: string | undefined;
      undoable: boolean;
    }
  | {
      id: string;
      kind: 'create_folder';
      path: string;
      fullPath: string;
      undoable: true;
    }
  | {
      id: string;
      kind: 'move_file';
      from: string;
      to: string;
      fullFrom: string;
      fullTo: string;
      /** Whether the move overwrote an existing file at the destination. */
      destExisted: boolean;
      /** Snapshot of the overwritten destination's bytes (only when destExisted). */
      destBeforeBytes?: ArrayBuffer | undefined;
      undoable: boolean;
    }
  | {
      id: string;
      kind: 'delete_file';
      path: string;
      fullPath: string;
      binary: boolean;
      /** Where the file now lives in .trash — undo moves it back here. The AI
       *  delete moves to Trash (recoverable) rather than hard-deleting, so undo
       *  is a move-back, not a byte-restore. */
      trashPath: string;
      beforeText?: string | undefined;
      undoable: boolean;
    };

/** The change shape the executor records (the store assigns the id). */
export type BatchChangeInput = BatchChange extends infer T
  ? T extends { id: string }
    ? Omit<T, 'id'>
    : never
  : never;

const NOT_UNDOABLE_MSG =
  "This change can’t be undone — its previous contents weren’t captured (the file may have been too large to snapshot).";

const OCCUPIED_MSG =
  "This change can’t be undone automatically — something else now sits at the original location. Restore it from the Trash panel or resolve it by hand.";

/**
 * Reverse a single captured change. Throws (so the caller can surface it) when
 * the change isn't undoable or the needed snapshot is missing.
 */
export async function executeUndo(change: BatchChange, fs: UndoFs): Promise<void> {
  switch (change.kind) {
    case 'create_file':
    case 'create_folder':
      // Undo a creation by removing it.
      await fs.delete(change.fullPath);
      return;

    case 'overwrite_file':
      if (!change.undoable || !change.beforeBytes) {
        throw new Error(NOT_UNDOABLE_MSG);
      }
      await fs.writeFileBinary(change.fullPath, change.beforeBytes);
      return;

    case 'delete_file':
      // The file was moved to Trash, not destroyed — undo moves it back. Refuse
      // (rather than clobber) if something now occupies the original path; the
      // file stays safely in Trash, restorable from the Trash panel.
      if (!change.undoable || !change.trashPath) {
        throw new Error(NOT_UNDOABLE_MSG);
      }
      if (await fs.exists(change.fullPath)) {
        throw new Error(OCCUPIED_MSG);
      }
      await fs.move(change.trashPath, change.fullPath);
      return;

    case 'move_file': {
      if (change.destExisted) {
        // Validate BEFORE touching the disk so an un-undoable move makes ZERO
        // changes (never a half-undo that moves the file back but leaves the
        // overwritten destination gone).
        if (!change.undoable || !change.destBeforeBytes) {
          throw new Error(
            "This move can’t be undone — the file it replaced wasn’t captured (it may have been too large to snapshot).",
          );
        }
        // Don't clobber something that now sits where the file came from.
        if (await fs.exists(change.fullFrom)) {
          throw new Error(OCCUPIED_MSG);
        }
        const destBytes = change.destBeforeBytes;
        await fs.move(change.fullTo, change.fullFrom);
        await fs.writeFileBinary(change.fullTo, destBytes);
      } else {
        if (await fs.exists(change.fullFrom)) {
          throw new Error(OCCUPIED_MSG);
        }
        await fs.move(change.fullTo, change.fullFrom);
      }
      return;
    }
  }
}

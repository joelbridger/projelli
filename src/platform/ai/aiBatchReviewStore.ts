/**
 * AI batch-review store (BUG-060, layer 3).
 *
 * In `batch` approval mode the AI's file tools apply immediately; each applied
 * change is `record`ed here. At the end of the turn the chat hook calls
 * `openReview()` to show the single review panel. The user can keep everything
 * (`reset`) or undo individual changes (`undo`), which reverses them via the
 * registered `UndoFs` (wired once from App, where the live WorkspaceService is).
 *
 * Tool calls within one turn run sequentially and only one turn runs at a time,
 * so a single global collection is correct: the hook `reset`s at the start of a
 * turn and `openReview`s at the end.
 */

import { create } from 'zustand';
import { executeUndo, type BatchChange, type BatchChangeInput, type UndoFs } from '@/platform/ai/aiBatchReview';
import { useEditorStore, isFileOpenInEditor, hasOpenDescendant } from '@/platform/state/editorStore';

/** The absolute path(s) that undoing this change would write to / delete. */
function pathsTouchedByUndo(change: BatchChange): string[] {
  return change.kind === 'move_file' ? [change.fullFrom, change.fullTo] : [change.fullPath];
}

interface AiBatchReviewState {
  /** Changes applied during the current/last batch-mode turn, in order. */
  changes: BatchChange[];
  /** Whether the end-of-turn review panel is showing. */
  reviewOpen: boolean;
  /** Per-change undo error (id → message), shown inline in the panel. */
  undoErrors: Record<string, string>;
  /** Live fs for undo (set from App). Null until a workspace is open. */
  undoFs: UndoFs | null;
  /** Called after a successful undo (e.g. refresh the file tree). */
  onChanged: (() => void) | null;

  /** Record an applied change (assigns a stable id). */
  record: (input: BatchChangeInput) => void;
  /** Register the live fs + an optional post-undo refresh hook. */
  setUndoFs: (fs: UndoFs | null, onChanged?: () => void) => void;
  /** Open the review — but only if there is anything to review. */
  openReview: () => void;
  /** Clear everything and close (the changes are already on disk). */
  reset: () => void;
  /** Reverse one change; on failure keep it and record an honest error. */
  undo: (id: string) => Promise<void>;
}

let counter = 0;

export const useAiBatchReviewStore = create<AiBatchReviewState>((set, get) => ({
  changes: [],
  reviewOpen: false,
  undoErrors: {},
  undoFs: null,
  onChanged: null,

  record: (input) => {
    counter += 1;
    const change = { ...input, id: `bchg-${String(counter)}` } as BatchChange;
    set((s) => ({ changes: [...s.changes, change] }));
  },

  setUndoFs: (fs, onChanged) => {
    set({ undoFs: fs, onChanged: onChanged ?? null });
  },

  openReview: () => {
    if (get().changes.length === 0) return;
    set({ reviewOpen: true });
  },

  reset: () => {
    set({ changes: [], reviewOpen: false, undoErrors: {} });
  },

  undo: async (id) => {
    const { changes, undoFs, onChanged } = get();
    const change = changes.find((c) => c.id === id);
    if (!change) return;

    if (!undoFs) {
      set((s) => ({ undoErrors: { ...s.undoErrors, [id]: 'No workspace is open, so this change can’t be undone right now.' } }));
      return;
    }

    // Don't act on a file (or a folder with a file inside it) that's open in the
    // editor — the editor would show stale content and the autosave could clobber
    // the undo. Same any-open rule as the AI write path (BUG-047 + BUG-063 sibling).
    const openTabs = useEditorStore.getState().openTabs;
    const blocked = pathsTouchedByUndo(change).find(
      (p) => isFileOpenInEditor(p, openTabs) || hasOpenDescendant(p, openTabs),
    );
    if (blocked) {
      set((s) => ({ undoErrors: { ...s.undoErrors, [id]: 'This file (or a file inside it) is open in the editor — close it first, then undo.' } }));
      return;
    }

    try {
      await executeUndo(change, undoFs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Undo failed.';
      set((s) => ({ undoErrors: { ...s.undoErrors, [id]: message } }));
      return;
    }

    // Success: drop the change + any stale error; close the panel if nothing's left.
    set((s) => {
      const remaining = s.changes.filter((c) => c.id !== id);
      const { [id]: _removed, ...restErrors } = s.undoErrors;
      return {
        changes: remaining,
        undoErrors: restErrors,
        reviewOpen: remaining.length > 0 ? s.reviewOpen : false,
      };
    });
    onChanged?.();
  },
}));

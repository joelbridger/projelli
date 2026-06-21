/**
 * AI file-change approval gate (BUG-060).
 *
 * The AI's chat tool executor runs inside an async loop driven by the provider
 * SDK. To pause a write/move/delete for the user's OK, the executor calls
 * `request(...)` and AWAITS the returned promise; a modal subscribed to
 * `pending` shows the before/after and calls `resolve(decision)` when the user
 * clicks Approve or Skip, which settles that promise.
 *
 * Tool calls within one AI turn run sequentially, so there is at most one
 * pending approval at a time. If a new request arrives while one is pending
 * (defensive), the older one is auto-skipped so the gate never deadlocks.
 */

import { create } from 'zustand';
import type { AiWriteOp } from '@/platform/ai/aiWriteApproval';

export type ApprovalDecision = 'approve' | 'skip';

export interface PendingApproval {
  /** Stable id for the modal's React key / dedupe. */
  id: string;
  /** What the AI wants to do (drives the modal's title + summary). */
  op: AiWriteOp;
  /** Current on-disk text (overwrite/delete of a text file). Undefined when the
   *  target is new, binary, or unreadable — the modal then shows a summary. */
  beforeText?: string | undefined;
  /** The AI's proposed text (create/overwrite). Undefined for move/delete. */
  afterText?: string | undefined;
  /** True when the target is a binary file (no text diff — show a summary). */
  binary: boolean;
  /** Settles the awaiting tool executor. */
  resolve: (decision: ApprovalDecision) => void;
}

/** What the executor passes to `request` (everything but the id + resolver). */
export type ApprovalRequest = Omit<PendingApproval, 'id' | 'resolve'>;

interface AiApprovalState {
  pending: PendingApproval | null;
  /** Request approval; resolves to the user's decision (or 'skip' if superseded). */
  request: (req: ApprovalRequest) => Promise<ApprovalDecision>;
  /** Called by the modal when the user decides. No-op if nothing is pending. */
  resolvePending: (decision: ApprovalDecision) => void;
}

let counter = 0;

export const useAiApprovalStore = create<AiApprovalState>((set, get) => ({
  pending: null,
  request: (req) =>
    new Promise<ApprovalDecision>((resolve) => {
      // Defensive: if something is still pending, auto-skip it so its awaiter
      // doesn't hang forever behind the new request.
      const prev = get().pending;
      if (prev) {
        prev.resolve('skip');
      }
      counter += 1;
      set({ pending: { ...req, id: `appr-${String(counter)}`, resolve } });
    }),
  resolvePending: (decision) => {
    const p = get().pending;
    if (!p) return;
    set({ pending: null });
    p.resolve(decision);
  },
}));

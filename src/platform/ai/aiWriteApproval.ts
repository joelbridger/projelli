/**
 * AI file-tool approval rules (BUG-060).
 *
 * The AI's chat file tools (`write_file`, `create_folder`, `move_file`,
 * `delete_file`) used to run with no per-action approval. Combined with prompt
 * injection, a hostile in-matter document could drive an in-matter overwrite or
 * delete. This module holds the PURE decision of when the AI must pause for the
 * user's OK, driven by the `aiFileApprovalMode` setting:
 *
 *   - `risky`  (default) — pause + show a before/after only when the AI would
 *     OVERWRITE or DELETE something that already exists (incl. a move onto an
 *     existing file). Creating brand-new files/folders runs freely.
 *   - `always` — pause for EVERY file change, even a create.
 *   - `batch`  — apply immediately, then collect every change for a single
 *     end-of-turn review where the user can approve/undo as a batch.
 *
 * Read/list/search tools never gate — they don't change anything.
 *
 * Keeping this logic pure (no UI, no async) makes the security-critical "does
 * this need approval?" decision unit-testable. The async approval gate and the
 * UI consume these functions.
 */

export type AiFileApprovalMode = 'risky' | 'always' | 'batch';

/**
 * Coerce a stored/raw setting value to a valid mode, FAILING CLOSED to the safe
 * default (`risky`) for anything unrecognized (missing, corrupt localStorage, an
 * old/renamed value). Security-sensitive code must never treat an unknown mode
 * as "no approval needed".
 */
export function coerceApprovalMode(raw: unknown): AiFileApprovalMode {
  return raw === 'always' || raw === 'batch' || raw === 'risky' ? raw : 'risky';
}

/** A normalized description of a mutating AI file operation. */
export type AiWriteOp =
  | { kind: 'create_file'; path: string }
  | { kind: 'overwrite_file'; path: string }
  | { kind: 'create_folder'; path: string }
  | { kind: 'move_file'; from: string; to: string; destExists: boolean }
  | { kind: 'delete_file'; path: string };

/** Raw tool-call shape (what the executor knows before it acts), plus whether
 *  the relevant target already exists on disk. */
export type RawWriteToolCall =
  | { tool: 'write_file'; path: string; destExists: boolean }
  | { tool: 'create_folder'; path: string; destExists: boolean }
  | { tool: 'move_file'; from: string; to: string; destExists: boolean }
  | { tool: 'delete_file'; path: string; destExists: boolean };

/**
 * Turn a raw tool call (+ existence of its target) into a normalized `AiWriteOp`.
 * A `write_file` is a CREATE when the path doesn't exist yet and an OVERWRITE
 * when it does — that distinction is what makes `risky` mode useful.
 */
export function classifyWriteOp(call: RawWriteToolCall): AiWriteOp {
  switch (call.tool) {
    case 'write_file':
      return call.destExists
        ? { kind: 'overwrite_file', path: call.path }
        : { kind: 'create_file', path: call.path };
    case 'create_folder':
      return { kind: 'create_folder', path: call.path };
    case 'move_file':
      return { kind: 'move_file', from: call.from, to: call.to, destExists: call.destExists };
    case 'delete_file':
      return { kind: 'delete_file', path: call.path };
  }
}

/**
 * "Risky" = the operation changes or removes something that ALREADY EXISTS, so
 * the user's existing work is at stake (and it's the prompt-injection target).
 * Creating new files/folders, and a plain move/rename onto an empty path, are
 * not risky — nothing of the user's is destroyed.
 */
export function isRiskyOp(op: AiWriteOp): boolean {
  switch (op.kind) {
    case 'overwrite_file':
    case 'delete_file':
      return true;
    case 'move_file':
      return op.destExists; // only risky if it overwrites an existing destination
    case 'create_file':
    case 'create_folder':
      return false;
  }
}

/** Does the AI need to pause for approval BEFORE applying this op, in this mode? */
export function needsPreApproval(mode: AiFileApprovalMode, op: AiWriteOp): boolean {
  switch (mode) {
    case 'always':
      return true;
    case 'risky':
      return isRiskyOp(op);
    case 'batch':
      return false; // batch applies immediately and reviews at the end
  }
}

/** In batch mode, every applied change is recorded for the end-of-turn review. */
export function collectsForBatchReview(mode: AiFileApprovalMode, _op: AiWriteOp): boolean {
  return mode === 'batch';
}

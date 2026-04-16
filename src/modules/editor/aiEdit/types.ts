// Types for M5 — side-by-side AI editing with streaming diff + hunk accept/reject.
//
// An "inline AI edit" session has three phases:
//   (1) anchored — user has text selected, chat input is open, waiting for prompt
//   (2) streaming — provider is emitting tokens, diff recomputed after each chunk
//   (3) review — stream done, hunks split out, user accepts / rejects each
//
// The shapes below are shared between the engine (`streamingDiff.ts`),
// the orchestrating hook (`useInlineAiEdit.ts`), and the overlay UI
// (`StreamingDiffOverlay.tsx`).

/** One contiguous region of changed lines in the rolling diff. */
export interface DiffHunk {
  /** Zero-based hunk index (stable across accept/reject so tests can target by index). */
  index: number;
  /** Inclusive start line (0-based) in the ORIGINAL selection text. */
  originalStart: number;
  /** Exclusive end line in the ORIGINAL selection text. */
  originalEnd: number;
  /** Inclusive start line (0-based) in the PROPOSED replacement text. */
  proposedStart: number;
  /** Exclusive end line in the PROPOSED replacement text. */
  proposedEnd: number;
  /** Lines removed from the original (may be empty for pure insertions). */
  removedLines: string[];
  /** Lines added in the proposed replacement (may be empty for pure deletions). */
  addedLines: string[];
}

/** State of a single hunk's resolution during review. */
export type HunkResolution = 'pending' | 'accepted' | 'rejected';

/** Who authored a change. Recorded on version history entries. */
export type ChangeAuthor = 'user' | 'ai';

/** Metadata attached to an AI-authored version history entry. */
export interface AiAuthorshipMetadata {
  author: 'ai';
  /** The user's original instruction, verbatim. */
  prompt: string;
  /** Provider id + model identifier, formatted `${provider}/${model}`. */
  model: string;
  /** Which hunk (by index) this record corresponds to. */
  hunkIndex: number;
  /** Inclusive start / exclusive end offsets in the full document at the moment of acceptance. */
  hunkRange: { start: number; end: number };
}

/** Session-scoped state handed to the overlay. */
export interface InlineEditSession {
  /** The original selected text, verbatim. */
  originalText: string;
  /** The current streamed proposal (may be partial). */
  proposedText: string;
  /** True while the stream is still open. */
  streaming: boolean;
  /** Hunks computed at the current snapshot. */
  hunks: DiffHunk[];
  /** Per-hunk resolution state, keyed by hunk index. */
  resolutions: Record<number, HunkResolution>;
  /** User's original instruction. */
  prompt: string;
  /** Provider / model identifier for attribution. */
  model: string;
}

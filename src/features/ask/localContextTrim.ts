/**
 * Local-AI context trimming.
 *
 * The embedded on-device model (AppLocalProvider) runs with a small, fixed
 * context window (LANTERN_LOCAL_CONTEXT_WINDOW, currently 16384 tokens) —
 * unlike cloud providers, which tolerate an oversized prompt gracefully. Ask
 * always retrieves up to DEFAULT_WORKSPACE_TOP_K chunks plus conversation
 * history with no size check, so a long question on a well-indexed workspace
 * can overflow the local window and come back truncated or garbled (step-4
 * adversarial review, finding 6).
 *
 * This module estimates the assembled prompt size with the same conservative
 * chars-per-token heuristic used elsewhere for token meters (see
 * `estimateTokens` in ./compression — ~4 chars/token) and, when the estimate
 * is over budget, trims deterministically in priority order:
 *   1. The system prompt and the user's question are never touched.
 *   2. Retrieved chunks are dropped lowest-relevance first, one whole chunk at
 *      a time — never a partial chunk, so a surviving citation can never
 *      point at truncated text.
 *   3. Once only the single highest-relevance chunk remains, oldest history
 *      turns are dropped next.
 * If even the question plus that one top chunk (no history) still doesn't
 * fit, `fits` comes back false — the caller should show an honest "too long"
 * message instead of sending a prompt doomed to overflow.
 *
 * Only used for the local provider; cloud providers never call this.
 */

import { estimateTokens } from './compression';
import type { RagHit } from '@/platform/utils/tauri-commands';
import type { AskTurn } from './askHelpers';

/** Tokens reserved out of the model's reported window for its own reply, so a
 *  maximally-packed prompt still leaves room for the model to answer. */
export const LOCAL_TRIM_OUTPUT_RESERVE_TOKENS = 512;

/** Shown instead of sending a prompt that can't fit even at the minimum
 *  (question + top-1 chunk, no history). */
export const LOCAL_CONTEXT_TOO_LONG_MESSAGE =
  'This question is too long for the on-device AI — shorten it or switch to a cloud model.';

export interface LocalTrimInput {
  /** Text that is never cut: the scope hint + instruction contract + the
   *  user's question. Estimated once, whole. */
  fixedText: string;
  /** Retrieved chunks, any order — re-sorted here by relevance (highest first). */
  hits: RagHit[];
  /** Conversation history turns available for the prompt, oldest first. */
  historyTurns: AskTurn[];
  /** Builds the `<workspace_context>` block from a hit subset — pass the real
   *  app builder so the estimate matches exactly what would be sent. */
  buildWorkspaceBlock: (hits: RagHit[]) => string;
  /** Builds the history block from a turn subset — pass the real app builder. */
  buildHistoryBlock: (turns: AskTurn[]) => string;
}

export interface LocalTrimResult {
  /** Hits to actually use, relevance-sorted (highest first). A subset of the input. */
  hits: RagHit[];
  /** History turns to actually use — a suffix (most-recent) of the input, oldest-first order. */
  historyTurns: AskTurn[];
  /** True when anything was cut relative to the input. */
  trimmed: boolean;
  /** False when even the question plus the single top-relevance chunk (no
   *  history) can't fit — the caller should decline with
   *  LOCAL_CONTEXT_TOO_LONG_MESSAGE instead of sending. */
  fits: boolean;
}

/**
 * Trim retrieved chunks and history to fit the local model's reported context
 * window. Pure and side-effect free — safe to unit test directly.
 */
export function trimForLocalContext(
  input: LocalTrimInput,
  maxContextTokens: number,
): LocalTrimResult {
  const budget = Math.max(0, maxContextTokens - LOCAL_TRIM_OUTPUT_RESERVE_TOKENS);
  const fixedTokens = estimateTokens(input.fixedText);

  let hits = [...input.hits].sort((a, b) => b.score - a.score);
  let history = [...input.historyTurns];
  const originalHitCount = hits.length;
  const originalHistoryCount = history.length;

  const currentTokens = (): number =>
    fixedTokens +
    estimateTokens(input.buildWorkspaceBlock(hits)) +
    estimateTokens(input.buildHistoryBlock(history));

  while (currentTokens() > budget) {
    if (hits.length > 1) {
      // Drop the lowest-relevance remaining chunk (the array is sorted
      // highest-first, so this is always the last element) — whole, never
      // partial, so a surviving citation can never point at truncated text.
      hits = hits.slice(0, -1);
      continue;
    }
    if (history.length > 0) {
      history = history.slice(1); // drop the oldest remaining turn
      continue;
    }
    break; // down to at most the single top chunk and no history
  }

  const fits = currentTokens() <= budget;
  const trimmed = hits.length !== originalHitCount || history.length !== originalHistoryCount;
  return { hits, historyTurns: history, trimmed, fits };
}

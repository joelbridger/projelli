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
 *   2. A chunk that busts the budget all by itself (question + that one chunk,
 *      no history) can never be sent whole, so it is excluded up front — no
 *      matter how highly it ranks. Otherwise an oversized #1 would drag every
 *      lower-ranked (but fitting) chunk down with it before failing anyway
 *      (round-3 finding); both modes end at the best-ranked SUBSET of chunks
 *      that can actually fit.
 *   3. Remaining chunks are dropped lowest-relevance first, one whole chunk at
 *      a time — never a partial chunk, so a surviving citation can never
 *      point at truncated text.
 *   4. Once only the single highest-relevance chunk remains, oldest history
 *      turns are dropped next.
 * When NO chunk can fit even alone, the two Ask modes diverge (round-2
 * review, F2):
 *   - 'files-only' answers ONLY from file evidence, so it reports fits=false
 *     and the caller declines honestly instead of sending a prompt doomed to
 *     overflow — it must never answer a files question without the files.
 *   - 'smart' can answer honestly with zero file evidence (its no-evidence
 *     prompt leads with a nothing-found block), so all chunks are excluded
 *     and history is kept, newest-first as much as fits — a follow-up like
 *     "summarize what you just said" answers from history instead of being
 *     refused because one oversized chunk erased it.
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
  /** Which Ask mode this send is for — decides what happens when NO chunk
   *  can fit even alone (see the module comment):
   *  'files-only' keeps the top-relevance chunk and reports fits=false
   *  (honest decline); 'smart' excludes every chunk and keeps as much history
   *  as fits (zero fresh evidence — the caller's no-evidence prompt handles
   *  honest wording). */
  mode: 'files-only' | 'smart';
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
  /** False when nothing sendable fits the budget — the caller should decline
   *  with LOCAL_CONTEXT_TOO_LONG_MESSAGE instead of sending. In 'files-only'
   *  mode that means NO retrieved chunk fits alongside the question even by
   *  itself (with no history); in 'smart' mode only the fixed text alone
   *  (question + system prompt) exceeding the budget can make this false. */
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

  const ranked = [...input.hits].sort((a, b) => b.score - a.score);
  const emptyHistoryTokens = estimateTokens(input.buildHistoryBlock([]));
  // A chunk that busts the budget even alone (question + that one chunk, no
  // history) has no sendable form — whole chunks only, partial never allowed.
  // Exclude those up front so the relevance-first loop below trims among
  // sendable chunks only; otherwise an oversized #1 would drag every
  // lower-ranked (but fitting) chunk down with it before failing anyway
  // (round-3 finding). Both modes end at the best-ranked subset that fits.
  const sendable = ranked.filter(
    (hit) =>
      fixedTokens + estimateTokens(input.buildWorkspaceBlock([hit])) + emptyHistoryTokens <=
      budget,
  );

  const [topRanked] = ranked;
  if (input.mode === 'files-only' && topRanked !== undefined && sendable.length === 0) {
    // Chunks were retrieved but none can ever fit. Files-only answers ONLY
    // from file evidence, so decline honestly (fits=false) — the top chunk is
    // kept for the caller's benefit but is never sent.
    return {
      hits: [topRanked],
      historyTurns: [],
      trimmed: ranked.length !== 1 || input.historyTurns.length > 0,
      fits: false,
    };
  }

  let hits = sendable;
  let history = [...input.historyTurns];

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
    // A sendable chunk fits alone by construction, so reaching here with no
    // history left means zero chunks survived AND the fixed text alone busts
    // the budget — nothing left to cut in either mode.
    break;
  }

  const fits = currentTokens() <= budget;
  const trimmed =
    hits.length !== input.hits.length || history.length !== input.historyTurns.length;
  return { hits, historyTurns: history, trimmed, fits };
}

/**
 * askPrompt — the Ask-my-workspace answer prompt, as a single source of truth.
 *
 * Extracted from `useAsk.ts` so the answer-quality eval harness
 * (`tests/eval/ask`) exercises the EXACT system prompt the app ships, and the
 * two can never silently drift apart. The harness imports `buildAskSystemPrompt`
 * and the same `<workspace_context>` builder the app uses, so a change to how we
 * tell the model to answer/cite/decline is automatically reflected in the eval.
 *
 * Pure: no React, no side effects, no heavy imports — safe to import anywhere
 * (the app, unit tests, and the eval runner alike).
 */

/**
 * The verbatim sentence the assistant must use when the retrieved workspace
 * context does not contain the answer.
 *
 * Two paths emit it so the user experience is identical whether the gate or the
 * model produces the decline:
 *   - the retrieval gate (no usable hits) emits it directly, with no model call;
 *   - the model is instructed (see `ASK_INSTRUCTIONS.decline`) to reply with
 *     EXACTLY this sentence when the context can't answer the question.
 */
export const NO_EVIDENCE_DECLINE =
  "I couldn't find anything about that in your documents.";

/**
 * BUG-016 grounding contract — the fixed instruction lines that harden the
 * answer against fabrication. Exported individually so tests (and the eval)
 * can assert the contract directly rather than string-matching the whole prompt.
 */
export const ASK_INSTRUCTIONS = {
  /** Answer only from the context; no outside knowledge. */
  role:
    "You are a private research assistant. Answer the user's question using ONLY the information in the context block below. Do not use outside knowledge.",
  /** Decline verbatim when the context can't answer; never invent specifics. */
  decline:
    `If the context block does not contain the answer, reply with exactly this sentence and nothing else: "${NO_EVIDENCE_DECLINE}" Do not guess, and never state a dollar amount, figure, date, deadline, or name that does not appear in the context block.`,
  /** Cite every factual claim, copying the source header exactly. */
  cite:
    'After every factual claim, cite the source in square brackets, copying the filename and its location EXACTLY as they appear in the matching source header in the context block — e.g. [agreement.docx paragraph 3] or [statement.pdf page 2]. Only cite filenames that appear in the context block, and only the paragraph/page actually shown there. Never invent a citation or a source.',
  /** Keep answers short. */
  length: 'Respond in 3-6 sentences maximum.',
} as const;

export interface AskSystemPromptParts {
  /**
   * One sentence telling the model the retrieval scope. Built from the SAME
   * retrievalScope the retrieval actually used (a single client/matter, or all
   * matters) so the prompt and the audited scope never disagree. Use
   * {@link scopeHintForMatter} to build the standard wording.
   */
  scopeHint: string;
  /**
   * The `<workspace_context>` block from `buildWorkspaceContextBlock(hits)`, or
   * `''` when nothing was retrieved.
   */
  workspaceBlock?: string;
  /** Recent-conversation history block, or `''` on the first turn. */
  historyBlock?: string;
}

/**
 * Build the standard scope-hint sentence. `matterLabel` is the human label of
 * the active client/matter when the turn is matter-scoped; pass `null` for an
 * all-matters turn.
 */
export function scopeHintForMatter(matterLabel: string | null): string {
  return matterLabel
    ? `You are answering a question scoped to this client or matter: "${matterLabel}".`
    : 'You are answering a question across all of your clients and matters.';
}

/**
 * Assemble the Ask answer system prompt. The order is fixed and the empty
 * sections are dropped, exactly as the app did inline before the extraction:
 *
 *   scope hint → role → decline contract → cite contract → length → context → history
 */
export function buildAskSystemPrompt(parts: AskSystemPromptParts): string {
  const { scopeHint, workspaceBlock, historyBlock } = parts;
  return [
    scopeHint,
    ASK_INSTRUCTIONS.role,
    ASK_INSTRUCTIONS.decline,
    ASK_INSTRUCTIONS.cite,
    ASK_INSTRUCTIONS.length,
    workspaceBlock,
    historyBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
}

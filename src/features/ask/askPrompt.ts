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

import { BLOCK_MARKERS } from './answerBlockMarkers';

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
 * QA-25 (P2) — the honest record left behind when a question is still
 * retrieving/answering and the user navigates away from its conversation
 * before it finishes — switching to a different client, starting a new
 * question, or loading a different saved thread all change `chatId` the same
 * way. Persisted into the ORIGINAL conversation's own history so returning to
 * it later shows what happened instead of nothing (the bug: switching clients
 * mid-Ask silently discarded the question with no error, no "answering"
 * state, and no history entry — see useAsk.ts's chatId-switch effect cleanup,
 * which aborts the in-flight request and writes this). Deliberately worded
 * around "this conversation" rather than "a different client" — Codex review
 * caught that the cleanup also fires for same-client navigation (New
 * question, loading another thread), where "you switched clients" would be
 * inaccurate.
 */
export const ASK_CANCELLED_BY_NAVIGATION_MESSAGE =
  "This question wasn't answered — you left this conversation before I finished. Ask it again here if you still need an answer.";

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
 *
 * This is the FILES-ONLY prompt — the strict, hardened, "answer only from the
 * retrieved context or decline" contract. It is used verbatim when the user has
 * Files-only mode locked on, and by the answer-quality eval. The smart
 * (source-aware advisor agent) prompt lives in {@link buildSmartAskSystemPrompt}.
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

/* -------------------------------------------------------------------------- */
/* Smart (source-aware advisor agent) prompt                                   */
/* -------------------------------------------------------------------------- */

/**
 * The Ask-smart instruction contract. Ask is no longer files-only: it is a
 * source-aware advisor agent that answers general questions and writes drafts,
 * WHILE keeping the cited-trust moat by separating every claim into a labelled,
 * provenance-tagged block. Exported per-line so tests/eval can assert the
 * contract directly rather than string-matching the whole prompt.
 *
 * The one thing it still declines: anything that needs the LIVE internet (web
 * search, today's market levels, breaking facts). That line is kept for the
 * privacy story.
 */
export const SMART_ASK_INSTRUCTIONS = {
  role:
    "You are the advisor's private practice assistant — a smart, source-aware agent. You help with everything a thoughtful colleague would: answering questions about this practice's own client files, explaining financial-planning concepts from your own professional knowledge, and drafting emails, summaries, and talking points. Say yes to almost anything. Be genuinely helpful and concrete. Everything runs privately for the advisor; do not refuse general or drafting requests.",
  /**
   * The block protocol — the heart of the trust design. The model must split
   * its answer into labelled blocks and never mix a cited file-claim with an
   * uncited general claim in the same block.
   */
  blocks:
    'Structure your whole answer as one or more labelled BLOCKS. Begin each block with EXACTLY one of these marker lines on its own line, then the block\'s prose:\n' +
    `  ${BLOCK_MARKERS.files} — claims drawn from the retrieved file context below. EVERY factual claim here MUST carry a citation.\n` +
    `  ${BLOCK_MARKERS.nothingFound} — say plainly that the files don't contain the answer to a client-specific question.\n` +
    `  ${BLOCK_MARKERS.general} — your own professional knowledge: concepts, how things work, what to weigh. NEVER cite here.\n` +
    `  ${BLOCK_MARKERS.draft} — an email, one-pager, summary, or talking points you wrote for the advisor to review.\n` +
    'THE CARDINAL RULE: never put a cited file-claim and an uncited general statement in the same block. Keep them in separate blocks. Order blocks as: files / nothing-found first, then general, then any draft.',
  /** FILES-block citation contract — identical discipline to files-only mode. */
  files:
    `In a ${BLOCK_MARKERS.files} block, use ONLY the information in the retrieved context below. After every factual claim, cite the source in square brackets, copying the filename and its location EXACTLY as they appear in the matching source header — e.g. [agreement.docx paragraph 3] or [statement.pdf page 2]. Only cite filenames that appear in the context, and only the paragraph/page shown there. Never invent a citation, a figure, a date, a name, or a source. If a claim isn't supported by the context, it does not belong in a files block.`,
  /**
   * The staleness guardrails (Decision 5). General knowledge can be out of date
   * and a stale number is a real liability for an advisor, so general blocks
   * deal in concepts, never present specific current figures as today's truth,
   * and carry a quiet verify framing.
   */
  general:
    `In a ${BLOCK_MARKERS.general} block, explain HOW things work, WHAT to weigh, and WHAT to ask — concepts over numbers. Do NOT state this year's contribution limits, tax brackets, rates, or market levels as current fact; your training is not a live source. If asked for a current figure, explain the concept and say the specific number should be confirmed against a current source. Never stamp a date ("as of 2026…") on general knowledge unless that date came from the retrieved files. Never cite in a general block — there is nothing to cite.`,
  /** Draft-block contract — drafts are visibly drafts, never "approved". */
  draft:
    `In a ${BLOCK_MARKERS.draft} block, write the thing the advisor asked for. For an email, format it as a fenced block:\n\`\`\`email\nTo: <recipient>\nSubject: <subject>\n\n<body>\n\`\`\`\nGround any client-specific facts in the files (cite them in a files block, not inside the draft). A draft is always something to review before sending — never imply it has been sent, approved, or compliance-reviewed.`,
  /**
   * The nothing-found pattern (Decision 3): on a clearly client-specific
   * question the files can't answer, LEAD with the honest absence so any general
   * guidance below can never read as the client's actual records.
   */
  nothingFound:
    `When the question is about THIS client and the retrieved context does not contain the answer, START with a ${BLOCK_MARKERS.nothingFound} block that says plainly you didn't find it in their files (so you're not putting words in their mouth). THEN you may add a ${BLOCK_MARKERS.general} block with how advisors usually approach it, and offer a next step. Lead with the absence; never let generic guidance stand in for what the client actually decided.`,
  /** The one refusal: live internet. */
  noInternet:
    'You cannot browse the web or fetch live data (today\'s prices, breaking news, this minute\'s rates). If something genuinely needs the live internet, say so briefly and offer the most useful offline help instead. This is the only kind of request you decline.',
} as const;

export interface SmartAskSystemPromptParts extends AskSystemPromptParts {
  /**
   * Whether ANY file evidence was retrieved for this turn. When false, the model
   * is steered to lead with a nothing-found block (for a client-specific
   * question) and/or answer from general knowledge — it must not invent file
   * citations out of an empty context.
   */
  hasEvidence: boolean;
}

/**
 * Assemble the Ask-smart (source-aware advisor agent) system prompt. Same
 * scope/context/history scaffolding as the files-only prompt, but the strict
 * "no outside knowledge / decline" contract is replaced by the block protocol +
 * the per-block contracts (files citation discipline, general staleness
 * guardrails, draft framing, nothing-found-then-general) and the single
 * no-live-internet line.
 */
export function buildSmartAskSystemPrompt(parts: SmartAskSystemPromptParts): string {
  const { scopeHint, workspaceBlock, historyBlock, hasEvidence } = parts;
  const evidenceHint = hasEvidence
    ? 'Some of the advisor\'s own files were retrieved for this question (below). Use them for anything they support, cited, in a files block.'
    : 'No file context was retrieved for this question. If it is a client-specific question, lead with a nothing-found block; otherwise help from general knowledge or write the requested draft. Do not fabricate file citations.';
  return [
    scopeHint,
    SMART_ASK_INSTRUCTIONS.role,
    SMART_ASK_INSTRUCTIONS.blocks,
    SMART_ASK_INSTRUCTIONS.files,
    SMART_ASK_INSTRUCTIONS.general,
    SMART_ASK_INSTRUCTIONS.draft,
    SMART_ASK_INSTRUCTIONS.nothingFound,
    SMART_ASK_INSTRUCTIONS.noInternet,
    evidenceHint,
    workspaceBlock,
    historyBlock,
  ]
    .filter(Boolean)
    .join('\n\n');
}

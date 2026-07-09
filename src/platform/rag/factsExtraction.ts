/**
 * Fact extraction — drives the "every 10 messages, propose 1-3 durable
 * facts" checkpoint for M3.
 *
 * Design:
 *   - The checkpoint fires when the chat's message count first crosses
 *     a multiple of `EXTRACTION_WINDOW` since the last extraction.
 *     Counting both user and assistant turns — a short exchange still
 *     produces the trigger at turn 10, not turn 20.
 *   - Throttling and giveup state live in a simple in-memory map
 *     keyed by chat id. This is intentionally NOT persisted — the
 *     throttle resets on reload, which is fine; worst case the user
 *     sees one extra proposal chip after a restart. Giving up is a
 *     per-session concern.
 *   - Provider call goes through `Provider.structuredOutput` with a
 *     small JSON schema. If the provider errors (rate limit, parse
 *     failure, etc.) we silently swallow and bump the next-checkpoint
 *     counter forward so we try again next window.
 *   - "Proposed" facts are NOT saved to the facts file here. The UI
 *     layer (`AIChatViewer`) owns the Accept/Reject/Edit chips and
 *     calls `FactsService.addFact` on acceptance. Auto-accept is the
 *     only exception and is routed through the singleton reader.
 */

import type { ChatMessage } from '@/platform/types/ai';
import type {
  OutputSchema,
  Provider,
  StructuredOutputOptions,
} from '@/platform/providers/Provider';
import { runWithEgressAudit, type EgressAuditLogger } from '@/platform/privacy/sendWithEgressAudit';
import type { AuditScope } from '@/platform/types/audit';

/** How many messages between checkpoints (both roles counted). */
export const EXTRACTION_WINDOW = 10;

/** Stop proposing for this chat after N consecutive rejects. Kinder to
 *  the user than hammering the chip on a noisy chat. */
export const MAX_CONSECUTIVE_REJECTS = 5;

/** Shape the model is asked to return. */
export interface ProposedFact {
  text: string;
}

/** Full extraction result. `facts` may be empty. */
export interface ExtractionResult {
  facts: ProposedFact[];
}

/** Per-chat runtime state used by `shouldRunExtraction`. */
export interface ChatExtractionState {
  /** Message index of the most recent extraction checkpoint (exclusive
   *  upper bound — i.e. "we already extracted from messages[0..=lastIdx]"). */
  lastCheckpointAt: number;
  /** Count of consecutive rejected proposals — when this hits
   *  `MAX_CONSECUTIVE_REJECTS` the chat is silenced. */
  consecutiveRejects: number;
  /** Whether extraction has been permanently muted for this chat
   *  (via repeated rejects). */
  mutedForSession: boolean;
}

/** Map holding per-chat state. Exposed for tests. */
export type ExtractionStateMap = Map<string, ChatExtractionState>;

/** Factory for a fresh per-chat state record. */
export function makeInitialState(): ChatExtractionState {
  return {
    lastCheckpointAt: 0,
    consecutiveRejects: 0,
    mutedForSession: false,
  };
}

/**
 * Decide whether the current message count warrants an extraction
 * pass. Pure function of counts + per-chat state, so unit tests don't
 * need a mocked clock.
 */
export function shouldRunExtraction(
  messageCount: number,
  state: ChatExtractionState,
): boolean {
  if (state.mutedForSession) return false;
  if (messageCount < EXTRACTION_WINDOW) return false;
  // Trigger every time the count crosses a new multiple of the
  // window. Using "at least one full window since the last checkpoint"
  // avoids firing twice on the same window boundary.
  return messageCount - state.lastCheckpointAt >= EXTRACTION_WINDOW;
}

/** Record that a checkpoint just ran (regardless of outcome). */
export function markCheckpointRan(
  state: ChatExtractionState,
  messageCount: number,
): ChatExtractionState {
  return { ...state, lastCheckpointAt: messageCount };
}

/** Record that the user rejected a proposal. */
export function markRejected(state: ChatExtractionState): ChatExtractionState {
  const next = state.consecutiveRejects + 1;
  return {
    ...state,
    consecutiveRejects: next,
    mutedForSession: next >= MAX_CONSECUTIVE_REJECTS,
  };
}

/** Record that the user accepted a proposal (resets the reject streak). */
export function markAccepted(state: ChatExtractionState): ChatExtractionState {
  return { ...state, consecutiveRejects: 0 };
}

// ---------------------------------------------------------------------------
// Prompt + schema
// ---------------------------------------------------------------------------

const EXTRACTION_SCHEMA: OutputSchema = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'A single durable fact about the user, in plain language.',
          },
        },
        required: ['text'],
      },
    },
  },
  required: ['facts'],
};

const EXTRACTION_SYSTEM_PROMPT =
  'You extract durable facts about the user from their chat conversation. ' +
  'Respond only with JSON.';

/**
 * Build the user prompt handed to `structuredOutput`. Kept as a pure
 * helper so tests can assert on its contents.
 */
export function buildExtractionPrompt(messages: ChatMessage[]): string {
  const transcript = messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  return (
    'From this conversation, extract 1-3 durable facts about the user or ' +
    'their work that would be useful to remember across future chats. ' +
    'Only propose facts that are factual and durable — not momentary ' +
    'preferences, not speculation, not one-off tasks, not information ' +
    'only relevant to this chat. If there are no such facts, return an ' +
    'empty array.\n\n' +
    'Conversation transcript:\n\n' +
    transcript +
    '\n\n' +
    'Return JSON of the form { "facts": [{ "text": "..." }, ...] }.'
  );
}

/**
 * Run extraction against the last `EXTRACTION_WINDOW` messages. Returns
 * proposed facts, or an empty array on any failure (API error, parse
 * failure, schema mismatch). Never throws.
 *
 * `maxTokens` is intentionally small — we're asking for 1-3 short
 * sentences plus JSON wrapper.
 */
export async function runExtraction(
  provider: Provider,
  messages: ChatMessage[],
  audit: {
    providerId: string;
    model?: string;
    scope?: AuditScope;
    onAuditLog?: EgressAuditLogger;
    chatId?: string;
  },
): Promise<ProposedFact[]> {
  // Slice to the last window so long chats don't blow up the token
  // budget. Always include at least the trigger-window size so there's
  // enough signal.
  const slice =
    messages.length > EXTRACTION_WINDOW
      ? messages.slice(-EXTRACTION_WINDOW)
      : messages;
  const prompt = buildExtractionPrompt(slice);
  const opts: StructuredOutputOptions = {
    schema: EXTRACTION_SCHEMA,
    systemPrompt: EXTRACTION_SYSTEM_PROMPT,
    temperature: 0,
    maxTokens: 512,
  };
  try {
    const result = await runWithEgressAudit<ExtractionResult>({
      provider,
      providerId: audit.providerId,
      ...(audit.model ? { model: audit.model } : {}),
      ...(audit.scope ? { scope: audit.scope } : {}),
      ...(audit.onAuditLog ? { onAuditLog: audit.onAuditLog } : {}),
      operation: () => provider.structuredOutput<ExtractionResult>(prompt, opts),
      modelCall: (output) => ({
        action: 'model_call',
        description: `Fact extraction to ${audit.model ?? provider.getMetadata().model}`,
        model: audit.model ?? provider.getMetadata().model,
        inputs: { promptLength: prompt.length },
        outputs: { factCount: Array.isArray(output.facts) ? output.facts.length : 0 },
        userDecision: 'auto',
        metadata: { feature: 'fact_extraction', ...(audit.chatId ? { chatId: audit.chatId } : {}) },
        provider: audit.providerId,
      }),
    });
    if (!result || !Array.isArray(result.facts)) return [];
    const proposed: ProposedFact[] = [];
    for (const f of result.facts) {
      if (!f || typeof f !== 'object') continue;
      const text = typeof f.text === 'string' ? f.text.trim() : '';
      if (text.length === 0) continue;
      // Soft cap — 3 facts max per checkpoint.
      proposed.push({ text });
      if (proposed.length >= 3) break;
    }
    return proposed;
  } catch {
    return [];
  }
}

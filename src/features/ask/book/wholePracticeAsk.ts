// Whole-practice Ask, layer 2: orchestrate digest -> provider -> parsed result.
// Uses the SAME provider front door as At-a-Glance (honors Local-only mode and
// the personal-install choice gate). Deliberately NEVER imports MemoryService
// or invokes rag_retrieve — matter isolation stays intact because raw
// cross-matter chunks are never read (see wholePracticeAsk.test.ts's guard).
import { getMatters } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildResolvedProviderForGlance } from '@/platform/matter/matterAtAGlance';
import { assertLocalOnlyAllowsSend } from '@/platform/privacy/localOnlyGuard';
import type { Provider } from '@/platform/providers/Provider';
import type { AuditEntry } from '@/platform/types/audit';
import { buildBookFactsDigest, buildBookAskPrompt, parseBookAskResponse, type BookAskResult } from './bookFacts';

export interface WholePracticeAskOptions {
  signal?: AbortSignal;
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}

export async function runWholePracticeAsk(
  question: string,
  options?: WholePracticeAskOptions,
): Promise<BookAskResult & { model: string }> {
  const digest = buildBookFactsDigest(getMatters(), useClientMapStore.getState().maps);
  if (digest.totalFacts === 0) {
    return { answer: '', matches: [], model: '' };
  }
  const { systemPrompt, userMessage } = buildBookAskPrompt(question, digest);
  const resolved = await buildResolvedProviderForGlance();
  const sendOpts: Parameters<Provider['sendMessage']>[1] = { systemPrompt, maxTokens: 600 };
  if (options?.signal !== undefined) sendOpts.signal = options.signal;
  // Race guard (same pattern as matterAtAGlance.ts): re-check Local-only AFTER
  // all awaits, immediately before the send.
  assertLocalOnlyAllowsSend(resolved.providerId);
  const response = await resolved.provider.sendMessage(userMessage, sendOpts);
  options?.onAuditLog?.({
    action: 'model_call',
    description: `Whole-practice question to ${resolved.model} (summaries only, ${String(digest.clients.length)} clients)`,
    model: resolved.model,
    inputs: { question, clients: digest.clients.length, facts: digest.totalFacts },
    outputs: { contentLength: response.content.length },
    userDecision: 'auto',
    metadata: { feature: 'whole_practice_ask', scope: 'summaries-only' },
    tokensIn: response.usage.inputTokens,
    tokensOut: response.usage.outputTokens,
    costUsd: response.cost,
    provider: resolved.providerId,
  });
  const parsed = parseBookAskResponse(response.content, digest);
  return { ...parsed, model: resolved.model };
}

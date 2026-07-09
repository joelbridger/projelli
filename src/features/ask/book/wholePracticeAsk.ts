// Whole-practice Ask, layer 2: orchestrate digest -> provider -> parsed result.
// Uses the SAME provider front door as At-a-Glance (honors Local-only mode and
// the personal-install choice gate). Deliberately NEVER imports MemoryService
// or invokes rag_retrieve — matter isolation stays intact because raw
// cross-matter chunks are never read (see wholePracticeAsk.test.ts's guard).
import { getMatters } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { buildResolvedProviderForGlance } from '@/platform/matter/matterAtAGlance';
import { assertLocalOnlyAllowsSend } from '@/platform/privacy/localOnlyGuard';
import { isLocalProvider } from '@/platform/privacy/egress';
import { sendWithEgressAudit } from '@/platform/privacy/sendWithEgressAudit';
import { getFileAccessConsent } from '@/platform/state/aiChatStore';
import { fileToolsAllowed } from '@/platform/ai/fileAccessConsent';
import type { Provider } from '@/platform/providers/Provider';
import type { AuditEntry } from '@/platform/types/audit';
import { buildBookFactsDigest, buildBookAskPrompt, parseBookAskResponse, type BookAskResult } from './bookFacts';

export interface WholePracticeAskOptions {
  signal?: AbortSignal;
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
}

/** Thrown when a cloud send would carry every client's summary and the
 *  advisor has not granted all-clients file access for this conversation
 *  (the same "reading is sending" gate normal Ask enforces, F2.5). */
export class WholePracticeConsentRequiredError extends Error {
  constructor() {
    super(
      'Whole-practice questions send a short summary from every client to your AI provider. ' +
        'Turn on file access for this conversation (or switch to a local model) to continue.',
    );
    this.name = 'WholePracticeConsentRequiredError';
  }
}

export async function runWholePracticeAsk(
  question: string,
  chatId: string,
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
  // Race guard (same pattern as matterAtAGlance.ts): re-check Local-only AND
  // file-access consent AFTER all awaits, immediately before the send — the
  // freshest, final decision, mirroring useAsk.ts's F2.5b re-check.
  assertLocalOnlyAllowsSend(resolved.providerId);
  if (!isLocalProvider(resolved.providerId)) {
    const consent = getFileAccessConsent(chatId);
    if (!fileToolsAllowed(consent, { kind: 'allMatters' })) {
      throw new WholePracticeConsentRequiredError();
    }
  }
  const response = await sendWithEgressAudit({
    provider: resolved.provider,
    providerId: resolved.providerId,
    model: resolved.model,
    prompt: userMessage,
    options: sendOpts,
    ...(options?.onAuditLog ? { onAuditLog: options.onAuditLog } : {}),
    scope: { kind: 'allMatters' },
    modelCall: {
      description: `Whole-practice question to ${resolved.model} (summaries only, ${String(digest.clients.length)} clients)`,
      inputs: { question, clients: digest.clients.length, facts: digest.totalFacts },
      outputs: (modelResponse) => ({ contentLength: modelResponse.content.length }),
      metadata: { feature: 'whole_practice_ask', scope: 'summaries-only' },
    },
  });
  const parsed = parseBookAskResponse(response.content, digest);
  return { ...parsed, model: resolved.model };
}

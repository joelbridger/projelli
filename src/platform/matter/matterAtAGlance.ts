/**
 * matterAtAGlance.ts
 *
 * AI at-a-glance generator for the Keepance matter hub. Given a matter id,
 * retrieves the matter's indexed content via MemoryService, builds a
 * workspace context block, and calls an AI provider for a structured summary
 * of open issues, deadlines, and next actions. Returns an empty result (no
 * error) when the matter has no indexed content yet.
 *
 * Provider choice mirrors Ask: prefer the user's configured default when that
 * provider has a usable key, skip providers already known invalid, then fall
 * back to stable key order. Local-only still forces Ollama.
 */

import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { KeychainService } from '@/platform/providers/KeychainService';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { resolveLocalGenerationProvider } from '@/platform/providers/resolveLocalProvider';
import type { Provider } from '@/platform/providers/Provider';
import { isLocalOnlyMode, assertCloudGenerationAllowed, assertLocalOnlyAllowsSend } from '@/platform/privacy/localOnlyGuard';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  cloudKeyPresenceFromValues,
  resolveCloudSettingsDefaults,
  resolvePreferredCloudProvider,
  type CloudProviderKeyValues,
} from '@/platform/providers/resolvePreferredCloudProvider';
import { getInvalidProviders, getVerifiedProviders } from '@/platform/providers/keyVerification';
import {
  PROFESSION_MODEL_STORAGE_KEY,
  PROFESSION_PROVIDER_STORAGE_KEY,
} from '@/platform/profile/professionModel';
import type { ClientMap } from '@/platform/clientMap/types';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { resolveEgress } from '@/platform/privacy/egress';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import type { AuditEntry } from '@/platform/types/audit';

// Re-export types consumed by callers so they don't need to reach into
// @/utils/tauri-commands directly.
export type { RagHit, RetrievalScope };

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface MatterAtAGlanceResult {
  openIssues: string[];
  deadlines: string[];
  /**
   * Upcoming dates/deadlines pulled directly from retrieved matter content.
   * Older cached entries may not have this field, so callers should tolerate
   * undefined.
   */
  upcomingDates?: string[];
  nextActions: string[];
  /** ISO 8601 timestamp of when the summary was generated. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Display normalization helpers
// ---------------------------------------------------------------------------

/**
 * Removes raw inline citation tokens that an AI may include in JSON strings.
 * Examples: "[2 page 6]", "[notes.docx paragraph 4]", "[3 p. 12]".
 */
export function stripAtAGlanceCitationMarkers(text: string): string {
  return text
    .replace(/\s*\[[^\]]*\b(?:p(?:age)?\.?|pages|paragraph|para\.?|pp\.?)\s*\d+[^\]]*\]/gi, '')
    .replace(/\s*\[\d+(?:\s*,\s*\d+)*(?:\s*-\s*\d+)?\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function cleanAtAGlanceItems(items: readonly string[] | undefined): string[] {
  if (!Array.isArray(items)) return [];
  const clean: string[] = [];
  for (const item of items as readonly string[]) {
    const text = stripAtAGlanceCitationMarkers(item);
    if (text !== '') clean.push(text);
    if (clean.length >= 3) break;
  }
  return clean;
}

export function normalizeMatterAtAGlanceResult(result: MatterAtAGlanceResult): MatterAtAGlanceResult {
  return {
    ...result,
    openIssues: cleanAtAGlanceItems(result.openIssues),
    deadlines: cleanAtAGlanceItems(result.deadlines),
    upcomingDates: cleanAtAGlanceItems(result.upcomingDates),
    nextActions: cleanAtAGlanceItems(result.nextActions),
  };
}

export function deriveMatterHubUpcomingItems(
  result: MatterAtAGlanceResult | null,
  clientMap?: ClientMap,
): string[] {
  // Dated "Coming up" events now live in the Follow-ups bucket (the old
  // 'upcoming' section was folded into 'followups' in the 4-category rename).
  const fromClientMap =
    clientMap?.sections
      .find((section) => section.key === 'followups')
      ?.items.map((item) => item.text) ?? [];
  const fromUpcomingDates = cleanAtAGlanceItems(result?.upcomingDates);
  const fromDeadlines = cleanAtAGlanceItems(result?.deadlines);
  const unique: string[] = [];
  for (const item of [...fromClientMap, ...fromUpcomingDates, ...fromDeadlines]) {
    const text = stripAtAGlanceCitationMarkers(item);
    if (text === '' || unique.includes(text)) continue;
    unique.push(text);
    if (unique.length >= 3) break;
  }
  return unique;
}

// ---------------------------------------------------------------------------
// Provider helpers (local copies -- do not import from Ask)
// ---------------------------------------------------------------------------

/**
 * Returns true when at least one cloud key (Anthropic, OpenAI, or Google) is
 * stored. Ollama is not a cloud key. Mirrors hasCloudKey() in Ask.
 */
export async function hasCloudKeyForGlance(): Promise<boolean> {
  const kc = new KeychainService();
  const anthropicKey = await kc.getKey('anthropic');
  if (anthropicKey?.trim()) return true;
  const openaiKey = await kc.getKey('openai');
  if (openaiKey?.trim()) return true;
  const googleKey = await kc.getKey('google');
  if (googleKey?.trim()) return true;
  return false;
}

export interface ResolvedGlanceProvider {
  provider: Provider;
  providerId: 'anthropic' | 'openai' | 'google' | 'ollama' | 'keepance-local';
  model: string;
}

/**
 * Build a Provider using the same cloud-provider resolution as Ask.
 *
 * BUG-021 (privacy): the at-a-glance summary auto-runs and sends matter context
 * to the AI, so it MUST honour Local-only mode — otherwise it would send to the
 * cloud whenever a cloud key exists, contradicting the "nothing leaves"
 * indicator. In Local-only, force the local model.
 *
 * F-503 — the local engine is the embedded Keepance Local AI when ready, else
 * Ollama (the same on-device resolution Ask / Chat / Client Map use), so the
 * auto-summary works on a machine with the embedded model but no Ollama.
 */
export async function buildResolvedProviderForGlance(): Promise<ResolvedGlanceProvider> {
  if (isLocalOnlyMode()) {
    return await resolveLocalGenerationProvider();
  }
  // Personal-install choice gate (Task 1.3): at-a-glance auto-runs and sends matter
  // context to a cloud AI, so block it until the user has made an explicit
  // confidentiality choice. Gate ONLY on the cloud branches, after confirming a cloud
  // key exists, so a personal install with no cloud key still falls back to local
  // Ollama (no egress, nothing to gate). Local-only mode already returned above; firm
  // installs are a no-op inside assertCloudGenerationAllowed (checks isFirm first).
  const kc = new KeychainService();
  const cloudKeys: CloudProviderKeyValues = {
    anthropic: (await kc.getKey('anthropic'))?.trim(),
    openai: (await kc.getKey('openai'))?.trim(),
    google: (await kc.getKey('google'))?.trim(),
  };
  const settings = useSettingsStore.getState();
  const resolved = resolvePreferredCloudProvider({
    availableKeys: cloudKeyPresenceFromValues(cloudKeys),
    settings: resolveCloudSettingsDefaults(
      settings.getSetting('defaultProvider'),
      settings.getSetting('defaultModel'),
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(PROFESSION_PROVIDER_STORAGE_KEY)
        : null,
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(PROFESSION_MODEL_STORAGE_KEY)
        : null,
    ),
    verifiedProviders: getVerifiedProviders(),
    invalidProviders: getInvalidProviders(),
  });

  if (resolved) {
    const apiKey = cloudKeys[resolved.provider];
    if (apiKey) {
      assertCloudGenerationAllowed();
      switch (resolved.provider) {
        case 'anthropic': {
          const provider = new ClaudeProvider({ apiKey, model: resolved.model });
          return { provider, providerId: 'anthropic', model: provider.getMetadata().model };
        }
        case 'openai': {
          const provider = new OpenAIProvider({ apiKey, model: resolved.model });
          return { provider, providerId: 'openai', model: provider.getMetadata().model };
        }
        case 'google': {
          const provider = new GeminiProvider({ apiKey, model: resolved.model });
          return { provider, providerId: 'google', model: provider.getMetadata().model };
        }
      }
    }
  }
  // No usable cloud key — fall back to the on-device engine (embedded model when
  // ready, else Ollama). No egress, nothing to gate.
  return await resolveLocalGenerationProvider();
}

export async function buildProviderForGlance(): Promise<Provider> {
  return (await buildResolvedProviderForGlance()).provider;
}

// ---------------------------------------------------------------------------
// Empty result helper
// ---------------------------------------------------------------------------

function emptyResult(): MatterAtAGlanceResult {
  return {
    openIssues: [],
    deadlines: [],
    upcomingDates: [],
    nextActions: [],
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Generate an at-a-glance summary for a matter. Returns structured arrays of
 * open issues, deadlines, and next actions derived from the matter's indexed
 * documents and email. Returns empty arrays when no content is indexed yet.
 *
 * Throws when memory is disabled -- callers should check isMemoryEnabled()
 * first or catch this error and surface it to the user.
 *
 * @param matterId - The matter to summarize.
 * @param options  - Optional AbortSignal for cancellation.
 */
export async function generateMatterAtAGlance(
  matterId: string,
  options?: {
    signal?: AbortSignal;
    onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  },
): Promise<MatterAtAGlanceResult> {
  if (!isMemoryEnabled()) {
    throw new Error('Memory is disabled');
  }

  const scope: RetrievalScope = { kind: 'matter', matterId };
  const hits = await MemoryService.retrieve(
    'open issues deadlines upcoming dates scheduled reviews meetings next actions',
    6,
    scope,
    false,
  );
  const topScore = hits.reduce<number | null>(
    (max, hit) => (max === null ? hit.score : Math.max(max, hit.score)),
    null,
  );
  options?.onAuditLog?.(auditEventToEntry({
    type: 'retrieval_executed',
    timestamp: new Date().toISOString(),
    payload: {
      query: 'At-a-glance summary',
      scope,
      hitCount: hits.length,
      topScore,
    },
  }));

  if (hits.length === 0) {
    return emptyResult();
  }

  if (options?.signal?.aborted) {
    return emptyResult();
  }

  const contextBlock = buildWorkspaceContextBlock(hits);

  const systemPrompt = `You are a private assistant. The advisor has asked for a brief at-a-glance summary of this client/household based on its indexed documents and email.

${contextBlock}

Return ONLY valid JSON (no markdown fences, no preamble) matching this schema:
{
  "openIssues": ["..."],
  "deadlines": ["..."],
  "upcomingDates": ["..."],
  "nextActions": ["..."]
}

Rules:
- Base every item ONLY on the workspace context. Never invent items.
- If nothing notable is found for a category, return an empty array.
- Each item is one concise sentence (under 15 words).
- Do NOT use em-dashes in any output.
- "openIssues": up to 3 short open issues found in the content; empty array if none found.
- "deadlines": up to 3 key dates or deadlines; empty array if none found.
- "upcomingDates": 1 to 3 upcoming dates, reviews, meetings, or deadlines found in the content; include an inline citation like "[filename paragraph N]" in each item; empty array if none found.
- "nextActions": up to 3 recommended next actions; empty array if none found.`;

  const resolvedProvider = await buildResolvedProviderForGlance();
  const provider = resolvedProvider.provider;
  const sendOpts: Parameters<Provider['sendMessage']>[1] = {
    systemPrompt,
    maxTokens: 300,
  };
  if (options?.signal !== undefined) {
    sendOpts.signal = options.signal;
  }
  // Race guard (Ask's gold pattern): buildResolvedProviderForGlance checks the
  // mode only at its START, then awaits keychain reads. Re-check the CURRENT mode
  // here — AFTER all awaits, immediately before the send — so a flip to Local-only
  // mid-resolve can never send this client's context to the cloud. Throws for a
  // cloud provider in Local-only; a resolved local provider (ollama) passes.
  assertLocalOnlyAllowsSend(resolvedProvider.providerId);
  const response = await provider.sendMessage(
    'Summarize this client for the advisor.',
    sendOpts,
  );
  const egress = resolveEgress({
    provider: resolvedProvider.providerId,
    mode: getConfidentialityMode(),
    isDemo: false,
    assuredAvailable: false,
  });
  options?.onAuditLog?.(auditEventToEntry({
    type: 'egress',
    timestamp: new Date().toISOString(),
    payload: {
      provider: egress.provider,
      model: resolvedProvider.model,
      mode: getConfidentialityMode(),
      destination: egress.destination,
      dataLeaves: egress.dataLeaves,
      scope,
    },
  }));
  options?.onAuditLog?.({
    action: 'model_call',
    description: `At-a-glance summary to ${resolvedProvider.model}`,
    model: resolvedProvider.model,
    inputs: { matterId },
    outputs: { contentLength: response.content.length },
    userDecision: 'auto',
    metadata: { feature: 'at_a_glance' },
    tokensIn: response.usage.inputTokens,
    tokensOut: response.usage.outputTokens,
    costUsd: response.cost,
    provider: resolvedProvider.providerId,
  });

  if (options?.signal?.aborted) {
    return emptyResult();
  }

  // Strip markdown fences if the model wrapped the JSON anyway.
  let raw = response.content.trim();
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...emptyResult(), generatedAt: new Date().toISOString() };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return emptyResult();
  }

  const obj = parsed as Record<string, unknown>;

  const toStringArray = (val: unknown): string[] => {
    if (!Array.isArray(val)) return [];
    return val
      .filter((item): item is string => typeof item === 'string')
      .map(stripAtAGlanceCitationMarkers)
      .filter((item) => item !== '')
      .slice(0, 3);
  };

  return {
    openIssues: toStringArray(obj['openIssues']),
    deadlines: toStringArray(obj['deadlines']),
    upcomingDates: toStringArray(obj['upcomingDates']),
    nextActions: toStringArray(obj['nextActions']),
    generatedAt: new Date().toISOString(),
  };
}

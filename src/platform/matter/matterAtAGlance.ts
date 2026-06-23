/**
 * matterAtAGlance.ts
 *
 * AI at-a-glance generator for the Keepance matter hub. Given a matter id,
 * retrieves the matter's indexed content via MemoryService, builds a
 * workspace context block, and calls an AI provider for a structured summary
 * of open issues, deadlines, and next actions. Returns an empty result (no
 * error) when the matter has no indexed content yet.
 *
 * Provider priority mirrors Ask: Anthropic -> OpenAI -> Google ->
 * Ollama fallback. The functions here are local copies -- do not import from
 * Ask.tsx.
 */

import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import { KeychainService } from '@/platform/providers/KeychainService';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { OllamaProvider } from '@/platform/providers/OllamaProvider';
import type { Provider } from '@/platform/providers/Provider';
import { isLocalOnlyMode, assertCloudGenerationAllowed } from '@/platform/privacy/localOnlyGuard';
import type { RagHit, RetrievalScope } from '@/platform/utils/tauri-commands';

// Re-export types consumed by callers so they don't need to reach into
// @/utils/tauri-commands directly.
export type { RagHit, RetrievalScope };

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface MatterAtAGlanceResult {
  openIssues: string[];
  deadlines: string[];
  nextActions: string[];
  /** ISO 8601 timestamp of when the summary was generated. */
  generatedAt: string;
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

/**
 * Build a Provider using the same priority order as Ask:
 * Anthropic -> OpenAI -> Google -> OllamaProvider fallback.
 *
 * BUG-021 (privacy): the at-a-glance summary auto-runs and sends matter context
 * to the AI, so it MUST honour Local-only mode — otherwise it would send to the
 * cloud whenever a cloud key exists, contradicting the "nothing leaves"
 * indicator. In Local-only, force the local model.
 */
export async function buildProviderForGlance(): Promise<Provider> {
  if (isLocalOnlyMode()) {
    return new OllamaProvider({});
  }
  // Personal-install choice gate (Task 1.3): at-a-glance auto-runs and sends matter
  // context to a cloud AI, so block it until the user has made an explicit
  // confidentiality choice. Gate ONLY on the cloud branches, after confirming a cloud
  // key exists, so a personal install with no cloud key still falls back to local
  // Ollama (no egress, nothing to gate). Local-only mode already returned above; firm
  // installs are a no-op inside assertCloudGenerationAllowed (checks isFirm first).
  const kc = new KeychainService();
  const anthropicKey = await kc.getKey('anthropic');
  if (anthropicKey?.trim()) {
    assertCloudGenerationAllowed();
    return new ClaudeProvider({ apiKey: anthropicKey.trim() });
  }
  const openaiKey = await kc.getKey('openai');
  if (openaiKey?.trim()) {
    assertCloudGenerationAllowed();
    return new OpenAIProvider({ apiKey: openaiKey.trim() });
  }
  const googleKey = await kc.getKey('google');
  if (googleKey?.trim()) {
    assertCloudGenerationAllowed();
    return new GeminiProvider({ apiKey: googleKey.trim() });
  }
  return new OllamaProvider({});
}

// ---------------------------------------------------------------------------
// Empty result helper
// ---------------------------------------------------------------------------

function emptyResult(): MatterAtAGlanceResult {
  return {
    openIssues: [],
    deadlines: [],
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
  options?: { signal?: AbortSignal },
): Promise<MatterAtAGlanceResult> {
  if (!isMemoryEnabled()) {
    throw new Error('Memory is disabled');
  }

  const scope: RetrievalScope = { kind: 'matter', matterId };
  const hits = await MemoryService.retrieve(
    'open issues deadlines next actions',
    6,
    scope,
    false,
  );

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
  "nextActions": ["..."]
}

Rules:
- Base every item ONLY on the workspace context. Never invent items.
- If nothing notable is found for a category, return an empty array.
- Each item is one concise sentence (under 15 words).
- Do NOT use em-dashes in any output.
- "openIssues": up to 3 short open issues found in the content; empty array if none found.
- "deadlines": up to 3 key dates or deadlines; empty array if none found.
- "nextActions": up to 3 recommended next actions; empty array if none found.`;

  const provider = await buildProviderForGlance();
  const sendOpts: Parameters<Provider['sendMessage']>[1] = {
    systemPrompt,
    maxTokens: 300,
  };
  if (options?.signal !== undefined) {
    sendOpts.signal = options.signal;
  }
  const response = await provider.sendMessage(
    'Summarize this client for the advisor.',
    sendOpts,
  );

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
      .slice(0, 3);
  };

  return {
    openIssues: toStringArray(obj['openIssues']),
    deadlines: toStringArray(obj['deadlines']),
    nextActions: toStringArray(obj['nextActions']),
    generatedAt: new Date().toISOString(),
  };
}

// Shared provider factory.
//
// The AI chat (AIChatViewer) and the AI redliner (DocxEditor) both need to
// instantiate the right Provider from a `(provider, model, apiKey)` triple.
// This centralizes that switch so the two surfaces can't drift on construction.
// BYOK is honored exactly as the rest of the app does it: the key is the user's
// own, and each provider talks DIRECTLY to its vendor API (no Keepance server).

import type { Provider } from './Provider';
import { ClaudeProvider } from './ClaudeProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';
import {
  getDefaultModelForTier,
  type Provider as ProviderId,
} from '@/utils/defaultModel';

/** The provider ids the BYOK chat surfaces use. */
export type ChatProviderId = ProviderId; // 'anthropic' | 'openai' | 'google'

export interface CreateProviderOptions {
  provider: ChatProviderId;
  apiKey: string;
  /** Model id; falls back to the free-tier default for the provider. */
  model?: string;
  /** Optional AI rules to prepend (chat surfaces pass workspace ai-rules.md). */
  aiRules?: string;
}

/**
 * Construct a Provider for the given BYOK triple. Mirrors the switch in
 * AIChatViewer so all surfaces build providers identically. Throws on an
 * unsupported provider id rather than silently defaulting, so a typo is loud.
 */
export function createProvider(opts: CreateProviderOptions): Provider {
  const model = opts.model ?? getDefaultModelForTier(opts.provider, 'free');
  const rulesOpt = opts.aiRules ? { aiRules: opts.aiRules } : {};
  switch (opts.provider) {
    case 'openai':
      return new OpenAIProvider({ apiKey: opts.apiKey, model, ...rulesOpt });
    case 'google':
      return new GeminiProvider({ apiKey: opts.apiKey, model, ...rulesOpt });
    case 'anthropic':
      return new ClaudeProvider({ apiKey: opts.apiKey, model, ...rulesOpt });
    default: {
      // Exhaustiveness guard — if a new provider id is added to the union,
      // TypeScript flags this as a compile error.
      const never: never = opts.provider;
      throw new Error(`Unsupported provider: ${String(never)}`);
    }
  }
}

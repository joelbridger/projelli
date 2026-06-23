// src/platform/clientMap/provider.ts
//
// Privacy-aware AI provider selection for the Client Map feature.
//
// Provider priority mirrors buildProviderForGlance in matterAtAGlance.ts:
// Anthropic -> OpenAI -> Google -> OllamaProvider fallback.
// These are local copies — do NOT import from matterAtAGlance.
//
// BUG-021 (privacy): the client map auto-runs and sends matter context to the
// AI, so it MUST honour Local-only mode — otherwise it would send to the cloud
// whenever a cloud key exists, contradicting the "nothing leaves" indicator.
// In Local-only, force the local model.

import { KeychainService } from '@/platform/providers/KeychainService';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { OllamaProvider } from '@/platform/providers/OllamaProvider';
import type { Provider } from '@/platform/providers/Provider';
import { isLocalOnlyMode, assertCloudGenerationAllowed } from '@/platform/privacy/localOnlyGuard';

/**
 * Returns true when at least one cloud key (Anthropic, OpenAI, or Google) is
 * stored. Ollama is not a cloud key. Mirrors hasCloudKeyForGlance().
 */
export async function hasCloudKeyForClientMap(): Promise<boolean> {
  const kc = new KeychainService();
  if ((await kc.getKey('anthropic'))?.trim()) return true;
  if ((await kc.getKey('openai'))?.trim()) return true;
  if ((await kc.getKey('google'))?.trim()) return true;
  return false;
}

/**
 * Build a Provider using the same priority order as buildProviderForGlance:
 * Anthropic -> OpenAI -> Google -> OllamaProvider fallback.
 *
 * Gate is placed ONLY on the cloud branches, after confirming a cloud key
 * exists, so a personal install with no cloud key still falls back to local
 * Ollama (no egress, nothing to gate). Local-only mode returns early before
 * any key check.
 */
export async function buildProviderForClientMap(): Promise<Provider> {
  if (isLocalOnlyMode()) {
    return new OllamaProvider({});
  }
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

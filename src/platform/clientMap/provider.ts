// src/platform/clientMap/provider.ts
//
// Privacy-aware AI provider selection for the Client Map feature.
//
// Provider choice mirrors Ask and matterAtAGlance:
// prefer the user's configured default when keyed, skip known-invalid
// providers, then fall back to stable key order. Local-only still forces
// OllamaProvider before any cloud choice is considered.
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
 * Build a Provider using the same cloud-provider resolution as Ask.
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
        case 'anthropic':
          return new ClaudeProvider({ apiKey, model: resolved.model });
        case 'openai':
          return new OpenAIProvider({ apiKey, model: resolved.model });
        case 'google':
          return new GeminiProvider({ apiKey, model: resolved.model });
      }
    }
  }
  return new OllamaProvider({});
}

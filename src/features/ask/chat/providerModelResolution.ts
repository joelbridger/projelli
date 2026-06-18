/**
 * Provider/model resolution for the AI chat.
 *
 * Two surfaces depend on this:
 *   1. AIChatViewer's mount-time seeding — a brand-new chat (no `provider`
 *      set yet) must default to a provider the user actually has a VALID key
 *      for, instead of the old hardcoded `'anthropic'`. A user whose only good
 *      key is OpenAI or Gemini could otherwise never send a message.
 *   2. ChatModelPicker — the in-header picker lists only providers with a
 *      valid key and the models available for each.
 *
 * All of this is pure (no React, no JSX) so it can be unit-tested in isolation
 * without mounting the heavyweight AIChatViewer.
 */

import type { APIKey } from '@/features/ask/AIChatViewer';
import { getDefaultModels, type ModelInfo } from '@/platform/providers/ModelListService';
import type { ProviderType } from '@/platform/providers/fetchUtils';

/** The provider ids the chat can target. Mirrors AIChatFile['provider']. */
export type ChatProvider = 'anthropic' | 'openai' | 'google' | 'ollama';

/** Cloud providers that have a hardcoded model list + a models cache. */
const CLOUD_PROVIDERS: ProviderType[] = ['anthropic', 'openai', 'google'];

/**
 * Last-resort model per provider when there is no cache AND no hardcoded list
 * (or, for cloud, when the hardcoded list is somehow empty). These mirror the
 * fallbacks the chat seeds with so a freshly-keyed provider is always
 * selectable. Ollama (local) intentionally has no fallback model — the user's
 * installed model is discovered elsewhere and an empty model lets the local
 * provider use its own default.
 */
export const FALLBACK_MODEL: Record<ChatProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  google: 'gemini-1.5-flash',
  ollama: '',
};

/** Type guard: is this id one of the three cloud providers? */
function isCloudProvider(provider: string): provider is ProviderType {
  return (CLOUD_PROVIDERS as string[]).includes(provider);
}

/**
 * Providers the user can actually use right now: those with a valid key in
 * `apiKeys`, in the order they appear there. Ollama is local + keyless, so it
 * only shows up when there's an explicit apiKeys entry for it (the app records
 * one when a local model is detected). De-duplicated by provider.
 */
export function resolveAvailableProviders(apiKeys: APIKey[]): ChatProvider[] {
  const seen = new Set<string>();
  const out: ChatProvider[] = [];
  for (const k of apiKeys) {
    if (!k.isValid) continue;
    if (seen.has(k.provider)) continue;
    seen.add(k.provider);
    out.push(k.provider as ChatProvider);
  }
  return out;
}

/**
 * Models to offer for a provider, best source first:
 *   1. the live cache the model-list service writes to
 *      `localStorage['keepance_models_<provider>']`,
 *   2. else the hardcoded default list (cloud providers only),
 *   3. else a single synthetic entry built from FALLBACK_MODEL,
 * so a provider is never shown empty (which would make it unselectable).
 *
 * Ollama has no cache and no default list; it returns an empty array so the
 * picker shows the provider as selectable with no specific model (the local
 * provider then uses its own default model).
 */
export function resolveModelsForProvider(provider: ChatProvider): ModelInfo[] {
  // 1) Live cache, if present and parseable.
  const cached = readModelsCache(provider);
  if (cached && cached.length > 0) return cached;

  // 2) Hardcoded default list for the three cloud providers.
  if (isCloudProvider(provider)) {
    const defaults = getDefaultModels(provider);
    if (defaults.length > 0) return defaults;
  }

  // 3) Synthetic single-entry fallback (skip for ollama / empty fallback).
  const fallback = FALLBACK_MODEL[provider];
  if (fallback) {
    return [{ id: fallback, displayName: fallback, provider: provider as ProviderType }];
  }
  return [];
}

/** Read + validate the `keepance_models_<provider>` cache. */
function readModelsCache(provider: ChatProvider): ModelInfo[] | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`keepance_models_${provider}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { models?: unknown };
    if (!parsed || !Array.isArray(parsed.models)) return null;
    // Keep only well-formed entries with an id.
    return (parsed.models as ModelInfo[]).filter(
      (m) => m && typeof m.id === 'string' && m.id.length > 0,
    );
  } catch {
    return null;
  }
}

/**
 * Pick the best model for a provider, preferring an explicit `preferredModel`
 * (e.g. the settings default model) when it belongs to this provider, then the
 * first available model, then the hardcoded fallback. Returns '' only when the
 * provider legitimately has no model (ollama) — the caller leaves it empty so
 * the local provider uses its own default.
 */
export function resolveModelForProvider(
  provider: ChatProvider,
  preferredModel?: string,
): string {
  const models = resolveModelsForProvider(provider);
  if (preferredModel && models.some((m) => m.id === preferredModel)) {
    return preferredModel;
  }
  const first = models[0];
  if (first) return first.id;
  return FALLBACK_MODEL[provider] ?? '';
}

export interface DefaultResolution {
  provider: ChatProvider;
  model: string;
}

export interface SettingsDefaults {
  /** The settings `defaultProvider` value, e.g. 'anthropic'. May be ''. */
  defaultProvider?: string;
  /** The settings `defaultModel` value, e.g. 'gpt-4o'. May be ''. */
  defaultModel?: string;
}

/**
 * Resolve the provider + model a NEW chat should default to.
 *
 * Priority for the provider:
 *   (a) the settings default provider IF it has a valid key in `apiKeys`;
 *   (b) else the first provider in `apiKeys` with `isValid === true`;
 *   (c) else null — leave the chat's provider unset so AIChatViewer's existing
 *       `?? 'anthropic'` fallback still drives the "add a key" experience.
 *
 * Model: the settings default model if it belongs to the chosen provider, else
 * the provider's first available model (cache → defaults), else the hardcoded
 * fallback. Ollama resolves to an empty model on purpose.
 */
export function resolveNewChatDefault(
  apiKeys: APIKey[],
  settings: SettingsDefaults = {},
): DefaultResolution | null {
  const available = resolveAvailableProviders(apiKeys);
  const firstAvailable = available[0];
  if (!firstAvailable) return null;

  const settingsProvider = settings.defaultProvider?.trim();
  const provider: ChatProvider =
    settingsProvider && available.includes(settingsProvider as ChatProvider)
      ? (settingsProvider as ChatProvider)
      : firstAvailable;

  // Only honor the settings default model when it lines up with the chosen
  // provider (the settings default could belong to a different provider).
  const preferred =
    settingsProvider && settingsProvider === provider
      ? settings.defaultModel?.trim() || undefined
      : undefined;

  const model = resolveModelForProvider(provider, preferred);
  return { provider, model };
}

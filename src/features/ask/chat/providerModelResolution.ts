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
 * Merge the settings-store defaults with the legacy `keepance_default_*`
 * localStorage keys (written by the older profession-model picker). The store
 * value wins; the legacy value is only consulted when the store is empty. Kept
 * pure (caller passes the raw values) so it can be unit-tested without a store
 * or localStorage.
 */
export function resolveSettingsDefaults(
  storeProvider: string | undefined,
  storeModel: string | undefined,
  legacyProvider: string | null | undefined,
  legacyModel: string | null | undefined,
): SettingsDefaults {
  return {
    defaultProvider: storeProvider?.trim() || legacyProvider?.trim() || '',
    defaultModel: storeModel?.trim() || legacyModel?.trim() || '',
  };
}

/**
 * Resolve the provider + model a NEW chat should default to.
 *
 * Priority for the provider:
 *   (a) the settings default provider IF it is in the candidate pool;
 *   (b) else the first provider in the candidate pool;
 *   (c) else null — leave the chat's provider unset so AIChatViewer's existing
 *       `?? 'anthropic'` fallback still drives the "add a key" experience.
 *
 * The candidate pool is normally every provider in `apiKeys` with
 * `isValid === true`. But `isValid` only means "a key is present", not "the key
 * works". Two refinements use live-check results when available:
 *   - providers in `invalidProviders` (rejected by a live check) are EXCLUDED,
 *     so a key we already know is bad is never chosen;
 *   - when at least one remaining provider is in `verifiedProviders`, the pool
 *     narrows to those verified providers, so a present-but-expired key (e.g. a
 *     stale Anthropic key) is no longer chosen ahead of a freshly verified one.
 * When nothing is known either way (a fresh install, or keys only loaded from
 * legacy storage), the pool stays the full available list so no one is ever
 * locked out. If every available provider is known-invalid, this returns null,
 * leaving the provider unset so the "add a key" experience takes over.
 *
 * Model: the settings default model if it belongs to the chosen provider, else
 * the provider's first available model (cache → defaults), else the hardcoded
 * fallback. Ollama resolves to an empty model on purpose.
 */
export function resolveNewChatDefault(
  apiKeys: APIKey[],
  settings: SettingsDefaults = {},
  verifiedProviders?: Set<string>,
  invalidProviders?: Set<string>,
): DefaultResolution | null {
  const available = resolveAvailableProviders(apiKeys);
  // Drop providers a live check already rejected (bad / expired key).
  const eligible =
    invalidProviders && invalidProviders.size > 0
      ? available.filter((p) => !invalidProviders.has(p))
      : available;
  if (eligible.length === 0) return null;

  // Prefer verified providers when we know of any among the eligible ones.
  const verifiedEligible =
    verifiedProviders && verifiedProviders.size > 0
      ? eligible.filter((p) => verifiedProviders.has(p))
      : [];
  const pool = verifiedEligible.length > 0 ? verifiedEligible : eligible;
  const firstAvailable = pool[0];
  if (!firstAvailable) return null;

  const settingsProvider = settings.defaultProvider?.trim();
  const provider: ChatProvider =
    settingsProvider && pool.includes(settingsProvider as ChatProvider)
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

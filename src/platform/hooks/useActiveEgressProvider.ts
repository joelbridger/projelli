/**
 * useActiveEgressProvider — derive the HONEST active AI provider for any egress
 * surface (the trust bar, Privacy Center, and any other display that lives
 * outside a specific chat, so there is no "active chat provider" to read).
 *
 * The egress badge is the product's #1 trust signal, so it must never name a
 * provider the user can't actually send to. Resolution, in priority order:
 *
 *   1. local-only mode => always 'ollama' (nothing leaves regardless of config).
 *   2. The user's saved default provider — but ONLY if a key for it actually
 *      exists. (The old bug: the badge honored the saved default even with no
 *      key, so the top bar could claim "Anthropic" while the chat used the
 *      OpenAI key the user really has.)
 *   3. Otherwise, the first cloud provider that has a saved key, in the same
 *      order the settings UI presents them: anthropic > openai > google.
 *   4. Otherwise the 'none' sentinel — rendered as a neutral "No AI connected"
 *      badge, never a guessed provider.
 *
 * Reactivity: API keys and the default provider live in localStorage, which is
 * not reactive on its own. Writers call `notifyEgressConfigChange()` (and the
 * `storage` event covers other tabs), so the badge updates the moment a key is
 * added or removed mid-session — no stale "where does my data go" answer.
 */

import { useEffect, useState } from 'react';
import { NO_AI_PROVIDER, type EgressProvider } from '@/platform/privacy/egress';

/** Same-tab pub/sub for egress config (keys / default provider) changes. */
export const EGRESS_CONFIG_CHANGE_EVENT = 'keepance:egress-config-change';

const CLOUD_ORDER: readonly EgressProvider[] = ['anthropic', 'openai', 'google'];

function hasKey(provider: string): boolean {
  try {
    return !!localStorage.getItem(`apiKey_${provider}`);
  } catch {
    return false;
  }
}

function readDefaultProvider(): string | null {
  try {
    return localStorage.getItem('keepance_default_provider');
  } catch {
    return null;
  }
}

/**
 * Pure, honest resolution of the active egress provider for `mode`. Exported so
 * it can be unit-tested and read outside React without subscribing.
 */
export function resolveActiveEgressProvider(mode: string): EgressProvider {
  if (mode === 'local-only') return 'ollama';

  // Honor the saved default only when it has a real key behind it.
  const def = readDefaultProvider();
  if ((def === 'anthropic' || def === 'openai' || def === 'google') && hasKey(def)) {
    return def;
  }

  // Otherwise the first provider with a saved key.
  for (const p of CLOUD_ORDER) {
    if (hasKey(p)) return p;
  }

  // Nothing configured — be honest, don't guess.
  return NO_AI_PROVIDER;
}

/**
 * Notify egress surfaces that the configured keys / default provider changed.
 * Call this from any code that writes an `apiKey_*` or `keepance_default_provider`
 * value so the trust badge re-resolves immediately (the `storage` event only
 * fires in OTHER tabs).
 */
export function notifyEgressConfigChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(EGRESS_CONFIG_CHANGE_EVENT));
  } catch {
    // No window (non-DOM env) — nothing to notify.
  }
}

export function useActiveEgressProvider(mode: string): EgressProvider {
  const [provider, setProvider] = useState<EgressProvider>(() =>
    resolveActiveEgressProvider(mode),
  );

  useEffect(() => {
    const update = () => setProvider(resolveActiveEgressProvider(mode));
    // Re-resolve immediately for the current mode, then on any config change.
    update();
    window.addEventListener(EGRESS_CONFIG_CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(EGRESS_CONFIG_CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [mode]);

  return provider;
}

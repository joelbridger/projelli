/**
 * useActiveEgressProvider — derive the HONEST active AI provider for any egress
 * surface (the trust bar, Privacy Center, and any other display that lives
 * outside a specific chat, so there is no "active chat provider" to read).
 *
 * The egress badge is the product's #1 trust signal, so it must never name a
 * provider the user can't actually send to, and it must agree with what Ask
 * actually does. Ask resolves the active provider from KEY PRESENCE via
 * `KeychainService.hasKey()` (askHelpers.ts) — on desktop the real keys live in
 * the OS keychain, and the legacy `apiKey_*` localStorage keys are migrated away.
 * So this hook reads key presence from the SAME source (KeychainService), NOT
 * from localStorage, or the badge would show "No AI connected" on desktop while
 * Ask happily sends with the keychain key. Resolution, in priority order:
 *
 *   1. local-only mode => always 'ollama' (nothing leaves regardless of config).
 *   2. The user's saved default provider — but ONLY if a key for it exists.
 *   3. Otherwise, the first cloud provider that has a key, in the same order the
 *      settings UI presents them: anthropic > openai > google.
 *   4. Otherwise the 'none' sentinel — rendered as a neutral "No AI connected"
 *      badge, never a guessed provider.
 *
 * Reactivity: keys change through KeychainService.setKey/deleteKey (which call
 * `notifyEgressConfigChange()`), and the cross-tab `storage` event covers other
 * tabs, so the badge updates the moment a key is added or removed mid-session.
 */

import { useEffect, useState } from 'react';
import { NO_AI_PROVIDER, type EgressProvider } from '@/platform/privacy/egress';
import { KeychainService } from '@/platform/providers/KeychainService';
import {
  EGRESS_CONFIG_CHANGE_EVENT,
  notifyEgressConfigChange,
} from '@/platform/privacy/egressConfigEvents';

// Re-export so existing importers keep working; the canonical home is
// egressConfigEvents (KeychainService imports it there to avoid a cycle).
export { EGRESS_CONFIG_CHANGE_EVENT, notifyEgressConfigChange };

const CLOUD_ORDER = ['anthropic', 'openai', 'google'] as const;

function readDefaultProvider(): string | null {
  try {
    return localStorage.getItem('keepance_default_provider');
  } catch {
    return null;
  }
}

/** Shared resolution given a key-presence predicate. */
function resolveFrom(mode: string, hasKey: (p: string) => boolean): EgressProvider {
  if (mode === 'local-only') return 'ollama';
  const def = readDefaultProvider();
  // Honor the saved default only when it actually has a key behind it.
  if ((def === 'anthropic' || def === 'openai' || def === 'google') && hasKey(def)) {
    return def;
  }
  for (const p of CLOUD_ORDER) {
    if (hasKey(p)) return p;
  }
  return NO_AI_PROVIDER;
}

/**
 * Synchronous best-effort resolution from the key METADATA mirror
 * (`getStoredKeys`), which is kept in localStorage on every platform — including
 * desktop, where the secret itself lives in the OS keychain. Used as the hook's
 * initial value so the badge does not flash "No AI connected" before the
 * authoritative async check resolves. Exported for non-React reads/tests.
 */
export function resolveActiveEgressProviderSync(mode: string): EgressProvider {
  if (mode === 'local-only') return 'ollama';
  let present = new Set<string>();
  try {
    present = new Set(new KeychainService().getStoredKeys().map((k) => k.provider));
  } catch {
    // KeychainService unavailable — fall through to "no provider".
  }
  return resolveFrom(mode, (p) => present.has(p));
}

/**
 * Authoritative resolution using the EXACT key source Ask sends with
 * (`KeychainService.hasKey`: backend — OS keychain on desktop — plus env keys),
 * so the badge and the actual send can never disagree.
 */
export async function resolveActiveEgressProvider(mode: string): Promise<EgressProvider> {
  if (mode === 'local-only') return 'ollama';
  const kc = new KeychainService();
  const present = new Set<string>();
  for (const p of CLOUD_ORDER) {
    try {
      if (await kc.hasKey(p)) present.add(p);
    } catch {
      // Probe failed for this provider — treat as absent.
    }
  }
  return resolveFrom(mode, (p) => present.has(p));
}

export function useActiveEgressProvider(mode: string): EgressProvider {
  const [provider, setProvider] = useState<EgressProvider>(() =>
    resolveActiveEgressProviderSync(mode),
  );

  useEffect(() => {
    let cancelled = false;
    const update = () => {
      // Instant, flicker-free best-effort from the metadata mirror...
      setProvider(resolveActiveEgressProviderSync(mode));
      // ...then correct it with the authoritative key-presence check (keychain
      // on desktop), so the badge matches exactly what Ask would send with.
      void resolveActiveEgressProvider(mode).then((p) => {
        if (!cancelled) setProvider(p);
      });
    };
    update();
    window.addEventListener(EGRESS_CONFIG_CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      cancelled = true;
      window.removeEventListener(EGRESS_CONFIG_CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [mode]);

  return provider;
}

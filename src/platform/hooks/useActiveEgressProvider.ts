/**
 * useActiveEgressProvider — derive the active AI provider for any egress surface.
 *
 * The trust bar, privacy center, and any other egress display live outside a
 * specific chat, so there is no "active chat provider" to read. This hook
 * derives the truthful provider value from what the user has actually configured,
 * in priority order:
 *
 *   1. local-only mode => always 'ollama' (nothing leaves regardless of config).
 *   2. First cloud provider for which the user has saved an API key in
 *      localStorage, checked in the same order the settings UI presents providers:
 *      anthropic > openai > google.
 *   3. Fallback: 'anthropic' (the most common default; resolveEgress labels it
 *      accurately, so this only fires when no key exists yet).
 *
 * Used by TrustBar, PrivacyCenterHome, and any future surface that needs the
 * honest resolved provider — single source of truth so all indicators agree.
 */

import { useMemo } from 'react';
import type { EgressProvider } from '@/platform/privacy/egress';

export function useActiveEgressProvider(mode: string): EgressProvider {
  return useMemo(() => {
    if (mode === 'local-only') return 'ollama';
    // Prefer the user's explicitly chosen default provider — the same value the
    // model picker and the Ask surface use — so every egress indicator agrees
    // (fixes the trust bar showing a different provider than the Ask).
    try {
      const def = localStorage.getItem('keepance_default_provider');
      if (def === 'anthropic' || def === 'openai' || def === 'google') return def;
    } catch {
      // localStorage may be unavailable in some environments; fall through.
    }
    const order: EgressProvider[] = ['anthropic', 'openai', 'google'];
    for (const p of order) {
      try {
        if (localStorage.getItem(`apiKey_${p}`)) return p;
      } catch {
        // localStorage may be unavailable in some environments; fall through.
      }
    }
    return 'anthropic';
  // Re-derive when the confidentiality mode changes; localStorage is not
  // reactive, but provider selection is stable within a session.
  }, [mode]);
}

// resolveRedlineProvider — pick the AI provider the .docx "Revise with AI"
// redline should use (BUG-009).
//
// The redline button is enabled only when there is a VALID key for the chosen
// provider (DocxEditor: `apiKeys.find(k => k.provider === aiProvider && k.isValid)`).
// So choosing the provider correctly is what makes the feature usable. The rules,
// in order:
//
//   1. Local-only mode  -> an on-machine model, no key needed. Prefer the
//      embedded Advisor Prep Hero Local AI when its model is downloaded + ready (F-503) —
//      it needs no separate Ollama daemon — else the egress-resolved local
//      provider ('ollama'). This matches Ask / Chat / Client Map / workflows.
//   2. Otherwise, prefer the SAME provider the trust bar / Privacy Center
//      resolved to (useActiveEgressProvider) IF the user has a valid key for it
//      -> all surfaces agree on which provider sees the data.
//   3. Otherwise fall back to ANY provider the user has a valid key for. This
//      handles (a) a key added mid-session before the egress hook re-derives,
//      and (b) a stale/invalid higher-priority key masking a valid lower one —
//      both would otherwise leave a usable key unused and the button dead.
//   4. If there is no valid key at all, return the egress provider unchanged
//      (the button stays correctly disabled with the "add a key" hint).
//
// Pure + dependency-free so it can be unit-tested without rendering MainPanel.

import type { ChatProviderId } from '@/platform/providers/providerFactory';

export interface RedlineProviderInput {
  /** True when the confidentiality mode restricts AI to on-machine models. */
  localOnly: boolean;
  /** The provider the trust bar / egress display resolved to. */
  egressProvider: ChatProviderId;
  /** The user's BYOK keys (same shape DocxEditor receives). */
  apiKeys: { provider: string; key: string; isValid: boolean }[];
  /**
   * F-503 — the embedded Advisor Prep Hero Local AI model is downloaded + READY. In
   * Local-only mode the redline prefers this on-device engine over Ollama (it
   * needs no separate daemon), so a machine with the embedded model but no
   * Ollama can still run Word "Revise with AI" privately. Defaults false.
   */
  localModelReady?: boolean;
}

export function resolveRedlineProvider({
  localOnly,
  egressProvider,
  apiKeys,
  localModelReady = false,
}: RedlineProviderInput): ChatProviderId {
  // Local-only: on-machine model, no key needed. Prefer the embedded Advisor Prep Hero
  // Local AI when ready (F-503); else the egress-resolved local provider, which
  // is 'ollama' here.
  if (localOnly) return localModelReady ? 'lantern-local' : egressProvider;

  // Prefer the trust-bar provider when it actually has a usable key.
  if (apiKeys.some((k) => k.provider === egressProvider && k.isValid)) {
    return egressProvider;
  }

  // Otherwise use any provider with a valid key (reactive to key changes).
  const firstValid = apiKeys.find((k) => k.isValid)?.provider as
    | ChatProviderId
    | undefined;
  return firstValid ?? egressProvider;
}

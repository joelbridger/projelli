// resolveRedlineProvider — pick the AI provider the .docx "Revise with AI"
// redline should use (BUG-009).
//
// The redline button is enabled only when there is a VALID key for the chosen
// provider (DocxEditor: `apiKeys.find(k => k.provider === aiProvider && k.isValid)`).
// So choosing the provider correctly is what makes the feature usable. The rules,
// in order:
//
//   1. Local-only mode  -> an on-machine model, no key needed. Prefer the
//      embedded Lantern Local AI when its model is downloaded + ready (F-503) —
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
  /**
   * The REAL provider the trust bar / egress display resolved to, or `null` when
   * the badge is a status sentinel ('none' / 'local-pending' / "checking"). It is
   * `ChatProviderId | null` — never a sentinel — because a sentinel must not be
   * treated as a provider id (fix round 2, item 2).
   */
  egressProvider: ChatProviderId | null;
  /** The user's BYOK keys (same shape DocxEditor receives). */
  apiKeys: { provider: string; key: string; isValid: boolean }[];
  /**
   * F-503 — the embedded Lantern Local AI model is downloaded + READY. In
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
  // Local-only: on-machine model, no key needed. Prefer the embedded Lantern
  // Local AI when ready (F-503); else Ollama — the two local engines. Resolved
  // directly here, NOT from `egressProvider`, so the badge sentinel can never
  // become the redline provider id.
  if (localOnly) return localModelReady ? 'lantern-local' : 'ollama';

  // Prefer the trust-bar provider when it is a real provider with a usable key.
  if (egressProvider && apiKeys.some((k) => k.provider === egressProvider && k.isValid)) {
    return egressProvider;
  }

  // Otherwise use any provider with a valid key (reactive to key changes).
  const firstValid = apiKeys.find((k) => k.isValid)?.provider as
    | ChatProviderId
    | undefined;
  // No trust-bar provider and no valid key: fall back to a real default so the
  // button stays correctly disabled with the "add a key" hint (never a sentinel).
  return firstValid ?? egressProvider ?? 'anthropic';
}

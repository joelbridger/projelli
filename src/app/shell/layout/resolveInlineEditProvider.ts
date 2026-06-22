// resolveInlineEditProvider — build the Provider the markdown/text inline
// "Ask AI" edit (useInlineAiEdit) should use (BUG-012).
//
// MainPanel renders <MarkdownEditor> and must hand it a getAiProvider that
// returns a CONCRETE Provider (unlike DocxEditor, which takes a provider id and
// builds the provider itself). Before this, MainPanel passed nothing, so
// getProvider() was null and the inline edit silently no-opped for everyone.
//
// We reuse the SAME resolved provider id the redline + trust bar use
// (resolveRedlineProvider / useActiveEgressProvider), then turn it into a
// Provider via the shared createProvider factory:
//   - local ('ollama')   -> built keyless (on-machine; nothing leaves the box).
//   - cloud + valid key   -> built BYOK-direct with that key.
//   - cloud + no valid key -> null, so the surface degrades cleanly instead of
//     constructing a keyless cloud provider that would 401 mid-stream.
//
// Pure + dependency-light so it can be unit-tested without rendering MainPanel.

import {
  createProvider,
  isLocalProviderId,
  type ChatProviderId,
} from '@/platform/providers/providerFactory';
import type { Provider } from '@/platform/providers/Provider';
import { assertCloudGenerationAllowed } from '@/platform/privacy/localOnlyGuard';

export interface InlineEditProviderInput {
  /** The provider id resolved by resolveRedlineProvider (agrees with the trust bar). */
  provider: ChatProviderId;
  /** The user's BYOK keys (same shape DocxEditor / MainPanel receive). */
  apiKeys: { provider: string; key: string; isValid: boolean }[];
  /** Optional model override (e.g. the detected Ollama model in Local-only mode). */
  model?: string;
}

export function resolveInlineEditProvider({
  provider,
  apiKeys,
  model,
}: InlineEditProviderInput): Provider | null {
  const modelOpt = model ? { model } : {};

  // Local model: on-machine, keyless. Never reaches the network.
  if (isLocalProviderId(provider)) {
    return createProvider({ provider, ...modelOpt });
  }

  // Personal-install choice gate (Task 1.3 fix): inline AI edit is cloud generation;
  // block it until the user has made an explicit confidentiality choice.
  // Pass the provider id so local providers skip the gate automatically.
  // Firm installs are a no-op inside assertCloudGenerationAllowed (isFirm first).
  // Returns null (clean no-op) rather than throwing, so MainPanel's getAiProvider
  // degrades gracefully — the same as a missing-key case.
  try {
    assertCloudGenerationAllowed(provider);
  } catch {
    return null;
  }

  // Cloud: only build when the user actually has a VALID key for THIS provider,
  // so a keyless construction can't 401 mid-stream. No key => clean null no-op.
  const apiKey = apiKeys.find((k) => k.provider === provider && k.isValid)?.key;
  if (!apiKey) return null;

  return createProvider({ provider, apiKey, ...modelOpt });
}

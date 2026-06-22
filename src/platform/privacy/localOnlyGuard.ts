/**
 * Local-only egress enforcement + personal-install choice gate.
 *
 * Two enforcement points live here so they share one import site in the send paths:
 *
 *   1. Local-only guard (existing): a cloud send is blocked when Local-only mode
 *      is on, so the egress indicator can never lie.
 *
 *   2. Personal-install choice gate (Task 1.3): a cloud GENERATION send is blocked
 *      on a personal (non-firm) install until the user has made an explicit,
 *      informed confidentiality choice via the Privacy Center. Retrieval is
 *      unaffected — only generation is gated.
 *
 * Redline + inline-edit already resolve their provider through
 * `useActiveEgressProvider` (which returns 'ollama' in Local-only), so they are
 * safe. The two paths that route by a chat's STORED provider (chat send) or by
 * KEY PRESENCE (Ask) bypass that and need these guards.
 */

import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { isLocalProviderId, type ChatProviderId } from '@/platform/providers/providerFactory';
import {
  resolveEffectiveEgress,
  CONFIDENTIALITY_CHOICE_MADE_KEY,
} from '@/platform/privacy/resolvePersonalEgressDefault';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useFirmStore } from '@/platform/firm/firmStore';

/** True when Local-only confidentiality mode is in effect (global or matter-forced). */
export function isLocalOnlyMode(): boolean {
  return getConfidentialityMode() === 'local-only';
}

/** Thrown when a cloud AI send is attempted while Local-only mode is on. The
 *  chat/ask UI surfaces the message so the user knows why the send was blocked. */
export class LocalOnlyEgressError extends Error {
  constructor(provider: string) {
    super(
      `Local-only mode is on, so nothing can be sent to a cloud AI provider. ` +
        `This chat is set to "${provider}". Switch it to a local model, or turn off ` +
        `Local-only mode in the Privacy Center, to send.`,
    );
    this.name = 'LocalOnlyEgressError';
  }
}

/**
 * Fail-closed guard for SEND paths that route by a stored/explicit provider id
 * (the chat send path). Throws `LocalOnlyEgressError` when Local-only is on and
 * the provider would send to the cloud, so a stored cloud chat can never leak
 * while the indicator says "nothing leaves".
 */
export function assertLocalOnlyAllowsSend(provider: string): void {
  if (isLocalOnlyMode() && !isLocalProviderId(provider as ChatProviderId)) {
    throw new LocalOnlyEgressError(provider);
  }
}

/**
 * Thrown when a personal install attempts cloud AI generation before the user
 * has made an explicit, informed confidentiality choice via the Privacy Center.
 * The chat/ask UI surfaces this message through the existing catch-block path
 * (same mechanism as LocalOnlyEgressError), so the user knows exactly where to go.
 */
export class ConfidentialityChoiceRequiredError extends Error {
  constructor() {
    super(
      `Before sending to a cloud AI, go to Settings → Privacy and choose how you want AI requests handled. ` +
        `This takes less than a minute and only needs to happen once.`,
    );
    this.name = 'ConfidentialityChoiceRequiredError';
  }
}

/**
 * Fail-closed guard for CLOUD GENERATION paths on personal installs.
 *
 * Reads `isFirm` (from firmStore) and `choiceMade` (from settingsStore) at call
 * time, then delegates to `resolveEffectiveEgress`. Throws
 * `ConfidentialityChoiceRequiredError` when `needsChoice` is true.
 *
 * Call this ONCE per send attempt, BEFORE constructing any cloud provider.
 * Local retrieval / indexing / search must NOT call this guard.
 *
 * @param provider  Optional provider id. When provided and it is a local provider
 *   (e.g. 'ollama'), the gate is skipped — local generation does not require an
 *   explicit confidentiality choice (no data leaves the machine).
 *
 * Firm installs: `resolveEffectiveEgress` branches on `isFirm` first and ignores
 * `choiceMade`, so this is always a no-op for firm users.
 */
export function assertCloudGenerationAllowed(provider?: string): void {
  // Local providers never send to the cloud — skip the gate.
  if (provider !== undefined && isLocalProviderId(provider as ChatProviderId)) return;
  const isFirm = Boolean(useFirmStore.getState().session?.activated);
  const storedMode = getConfidentialityMode();
  const choiceMade = Boolean(
    useSettingsStore.getState().getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY),
  );
  const { needsChoice } = resolveEffectiveEgress({ isFirm, storedMode, choiceMade });
  if (needsChoice) {
    throw new ConfidentialityChoiceRequiredError();
  }
}

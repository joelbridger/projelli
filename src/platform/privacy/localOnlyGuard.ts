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
// The fail-closed cloud-send primitives live in a provider-free module so the
// provider classes can import them without a circular dependency. Re-exported
// here so existing import sites keep resolving them from `localOnlyGuard`.
import {
  LocalOnlyEgressError,
  isLocalOnlyModeFailClosed,
  assertCloudSendAllowed,
} from '@/platform/privacy/cloudSendGuard';

export { LocalOnlyEgressError, isLocalOnlyModeFailClosed, assertCloudSendAllowed };

/** True when Local-only confidentiality mode is in effect (global or matter-forced).
 *  NON-fail-closed: reflects the current in-memory setting (schema-defaulted to
 *  'direct' before hydration). Use for UI display / skip decisions where a
 *  transient default is harmless. Privacy ENFORCEMENT must use
 *  `isLocalOnlyModeFailClosed()` / the assert* guards below. */
export function isLocalOnlyMode(): boolean {
  return getConfidentialityMode() === 'local-only';
}

/**
 * Fail-closed guard for SEND paths that route by a stored/explicit provider id
 * (the chat send path). Throws `LocalOnlyEgressError` when Local-only is on and
 * the provider would send to the cloud, so a stored cloud chat can never leak
 * while the indicator says "nothing leaves".
 */
export function assertLocalOnlyAllowsSend(provider: string): void {
  if (isLocalOnlyModeFailClosed() && !isLocalProviderId(provider as ChatProviderId)) {
    throw new LocalOnlyEgressError(provider);
  }
}

/**
 * Thrown when an EXTERNAL (off-device) operation that this guard protects is
 * attempted while Local-only mode is on. Distinct from `LocalOnlyEgressError`
 * (which is about routing an AI provider send).
 *
 * SCOPE (per the product rule): private mode means YOUR DATA is never sent to a
 * cloud AI. User-authorized CONNECTORS (Wealthbox sync, email sync) and fetching
 * the local model are NOT blocked — they pull the user's own data in / fetch
 * model weights and send nothing to a cloud AI, so this guard is deliberately
 * NOT wired into those paths. It protects off-device chatter that is NOT a
 * connector and NOT user data — e.g. the cloud model-list refresh (sends the API
 * key), telemetry/diagnostics, cloud key validation, and cloud fan-out. The UI
 * surfaces the message so the user knows why the action is disabled.
 */
export class LocalOnlyExternalError extends Error {
  constructor(op: string) {
    super(
      `Local-only mode is on, so "${op}" can't run — it would contact a service ` +
        `off your device. Turn off Local-only mode in the Privacy Center to use it.`,
    );
    this.name = 'LocalOnlyExternalError';
  }
}

/**
 * Fail-closed guard for any EXTERNAL (off-device) operation that has NO on-device
 * equivalent (connector syncs, model download / model-list refresh, telemetry,
 * diagnostics, cloud fan-out). Throws `LocalOnlyExternalError` when Local-only is
 * on.
 *
 * Call this IMMEDIATELY before the external call and AFTER every `await`, so a
 * confidentiality-mode flip mid-operation can't slip a call through (the same
 * race the Ask path closes with `assertLocalOnlyAllowsSend`). `op` is a short
 * human label used in the thrown message. Surfaces (buttons, auto-effects) should
 * ALSO check `isLocalOnlyMode()` up front to disable/skip the action; this guard
 * is the last-line enforcement that makes the kill-switch airtight.
 */
export function assertLocalOnlyAllowsExternal(op: string): void {
  if (isLocalOnlyModeFailClosed()) {
    throw new LocalOnlyExternalError(op);
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

export function isConfidentialityChoiceRequiredError(
  error: unknown,
): error is ConfidentialityChoiceRequiredError {
  return (
    error instanceof ConfidentialityChoiceRequiredError ||
    (error instanceof Error && error.name === 'ConfidentialityChoiceRequiredError')
  );
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
  const choiceMade =
    useSettingsStore.getState().getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY) === true;
  const { needsChoice } = resolveEffectiveEgress({ isFirm, storedMode, choiceMade });
  if (needsChoice) {
    throw new ConfidentialityChoiceRequiredError();
  }
}

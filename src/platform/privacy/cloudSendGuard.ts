/**
 * cloudSendGuard — the CENTRAL, fail-closed choke point for cloud-AI sends.
 *
 * This module is intentionally tiny and provider-free (it must NOT import the
 * provider classes or providerFactory) so the cloud provider implementations can
 * import it without a circular dependency. `localOnlyGuard` re-exports everything
 * here, so existing import sites keep working.
 *
 * The guarantee: in private mode (Local-only) no AI prompt or file is ever sent
 * to a cloud AI. Every cloud provider's send methods call `assertCloudSendAllowed`
 * as their first statement, so the rule is enforced in ONE place for every
 * current and future call path. Local providers (Ollama / Advisor Prep Hero Local AI) do
 * NOT call it, so on-device inference is unaffected.
 */

import {
  CONFIDENTIALITY_MODE_SETTING_KEY,
  CONFIDENTIALITY_MODES,
  type ConfidentialityMode,
} from '@/platform/privacy/egress';
import { SK_SETTINGS } from '@/config/identity';

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

/** localStorage key the settings store persists under (zustand persist `name`). */
const SETTINGS_PERSIST_KEY = SK_SETTINGS;

/**
 * Read the persisted confidentiality mode straight from storage, bypassing the
 * in-memory store. This is the fail-closed source of truth: during the store's
 * hydration window `getSetting` returns the schema default ('direct'), so a
 * Local-only user's send could otherwise slip through before rehydration. The
 * raw value is authoritative the instant the app starts.
 */
function persistedConfidentialityModeRaw(): ConfidentialityMode | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const raw = localStorage.getItem(SETTINGS_PERSIST_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { state?: { values?: Record<string, unknown> } };
    const v = parsed.state?.values?.[CONFIDENTIALITY_MODE_SETTING_KEY];
    return typeof v === 'string' && (CONFIDENTIALITY_MODES as string[]).includes(v)
      ? (v as ConfidentialityMode)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * TRULY fail-closed Local-only check for privacy guards. Returns true (= BLOCK
 * any cloud/external send) UNLESS the persisted confidentiality choice EXPLICITLY
 * reads 'direct' or 'assured'. Everything else blocks:
 *   - 'local-only' (the user chose private mode),
 *   - missing / corrupt / unreadable storage,
 *   - the not-yet-hydrated window (the in-memory store would report the schema
 *     default 'direct', which we deliberately do NOT trust here).
 *
 * Read straight from storage so the answer is correct the instant the app starts.
 * We never default to "cloud allowed" when the mode is unknown — a fresh install
 * with no choice yet is gated separately by the personal-install choice gate, so
 * blocking here is safe and correct.
 */
export function isLocalOnlyModeFailClosed(): boolean {
  const persisted = persistedConfidentialityModeRaw();
  return persisted !== 'direct' && persisted !== 'assured';
}

/**
 * CENTRAL CLOUD-SEND CHOKE POINT — fail-closed.
 *
 * Called at the top of EVERY cloud provider send method (sendMessage /
 * sendMessageStreaming / structuredOutput on the Anthropic, OpenAI, and Google
 * providers). Because every cloud AI request funnels through one of those
 * methods, this single guard covers EVERY current and future cloud-AI send in
 * one place: in Local-only (or before the mode is confirmed loaded) it throws,
 * so no AI prompt or file can ever reach a cloud AI in private mode. Local
 * providers do NOT call this. The per-call-site immediate-before-send guards
 * remain as defense-in-depth for mid-flight mode flips.
 */
export function assertCloudSendAllowed(providerId: string): void {
  if (isLocalOnlyModeFailClosed()) {
    throw new LocalOnlyEgressError(providerId);
  }
}

/**
 * egressConfigEvents — a tiny dependency-free pub/sub so the always-visible
 * egress badge can re-resolve the instant the configured AI keys (or the saved
 * default provider) change.
 *
 * This lives in its own module (not in useActiveEgressProvider) so that
 * KeychainService — the source of truth for keys — can broadcast a change
 * without creating an import cycle (useActiveEgressProvider imports
 * KeychainService to read key presence).
 */

/** Same-tab event name. The cross-tab `storage` event covers other tabs. */
export const EGRESS_CONFIG_CHANGE_EVENT = 'keepance:egress-config-change';

/**
 * Notify egress surfaces that the configured keys / default provider changed.
 * Call this from any code that adds or removes an AI key (KeychainService) or
 * writes the default provider, so the trust badge re-resolves immediately (the
 * `storage` event only fires in OTHER tabs).
 */
export function notifyEgressConfigChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(EGRESS_CONFIG_CHANGE_EVENT));
  } catch {
    // No window (non-DOM env) — nothing to notify.
  }
}

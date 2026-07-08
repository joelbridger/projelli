/**
 * localAiReadiness — a tiny, off-desktop-safe subscription to the embedded
 * Advisor Prep Hero Local AI download/readiness stream.
 *
 * Fix round 2, item 3: the egress badge can show "Local AI setting up"
 * (LOCAL_PENDING) while the on-device model is still downloading. Readiness
 * signals through a Tauri event (`LOCAL_LLM_MODEL_EVENT`), NOT through the egress
 * config-change / storage events the badge already listens to — so without this
 * the badge stayed on "setting up" until a reload. The top-bar egress hook
 * subscribes here and re-resolves when the model's state changes, so the badge
 * flips to "Using local AI" the moment the download finishes.
 *
 * Encapsulated (and mockable) so the egress hook stays free of Tauri imports and
 * so it degrades to a no-op in the browser/tests.
 */

import { LOCAL_LLM_MODEL_EVENT } from '@/platform/utils/tauri-commands';

/**
 * Invoke `onChange` whenever the local-model download/readiness state changes.
 * Returns an unsubscribe function. No-op (unsubscribe is a no-op) off-desktop or
 * if the Tauri event bridge is unavailable.
 */
export function onLocalAiReadinessChange(onChange: () => void): () => void {
  // A mutable holder read through `isCancelled()` (a call, not a direct local
  // read) so TS control-flow can't narrow the post-await guard to always-false.
  const state = { cancelled: false, unlisten: null as (() => void) | null };
  const isCancelled = () => state.cancelled;

  async function subscribe(): Promise<void> {
    const core = await import('@tauri-apps/api/core');
    if (!core.isTauri()) return;
    const { listen } = await import('@tauri-apps/api/event');
    const stop = await listen(LOCAL_LLM_MODEL_EVENT, () => {
      onChange();
    });
    if (isCancelled()) {
      stop();
      return;
    }
    state.unlisten = stop;
  }

  // Best-effort background subscription: off-desktop, or when the Tauri event
  // bridge is unavailable, it simply never fires — the badge just won't
  // live-refresh on readiness (a reload still works). Nothing to recover.
  // eslint-disable-next-line lantern-async/no-silent-failure -- best-effort; failure only disables live badge refresh, never a data path
  void subscribe().catch(() => {});

  return () => {
    state.cancelled = true;
    state.unlisten?.();
  };
}

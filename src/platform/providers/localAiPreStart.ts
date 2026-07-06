/**
 * localAiPreStart — opportunistic warm-up of the embedded llama-server sidecar.
 *
 * Fix 1 (demo readiness): `AppLocalProvider` used to start the sidecar lazily
 * on the FIRST Ask question. The sidecar's own health wait can legitimately
 * take up to 120s on a cold model load (`HEALTH_TIMEOUT_SECS` in
 * `llama_server.rs`), but Ask's no-token watchdog gives up at 45s
 * (`ASK_ANSWER_TIMEOUT_MS`) — so the first question right after switching to
 * Local AI could look hung and then fail, even though the sidecar was still
 * making progress. Kicking the sidecar off as soon as the user signals intent
 * to use Local AI (selecting Local-only mode, picking the local model in a
 * chat, or on boot when Local-only is already the persisted mode) gives it a
 * head start, so by the time a question is actually asked the sidecar is
 * often already healthy.
 */

import { isEmbeddedLocalModelReady } from './resolveLocalProvider';
import { localLlmSidecarStart } from '@/platform/utils/tauri-commands';

let inFlight: Promise<void> | null = null;

/**
 * Fire-and-forget: callers never await this. If the embedded model isn't
 * downloaded yet, there is nothing to start — a no-op (the "still setting up"
 * honesty is Fix 2's job, not this one). Errors from the actual start attempt
 * (missing binary, model deleted mid-flight, etc.) are swallowed here; the
 * real failure surfaces normally when the user actually sends a question,
 * through the existing send-path error handling.
 *
 * Concurrent triggers (e.g. a boot-time pre-start still in flight when the
 * user opens the confidentiality settings and re-selects Local-only) share
 * ONE in-flight attempt rather than racing parallel health-wait loops — the
 * Rust command is idempotent, but there's no reason to poll it twice at once.
 */
export function preStartLocalAi(): void {
  if (inFlight) return;
  inFlight = (async () => {
    try {
      if (!(await isEmbeddedLocalModelReady())) return;
      await localLlmSidecarStart();
      // eslint-disable-next-line lantern-async/no-silent-failure -- best-effort warm-up only; the real failure surfaces normally at the actual send, see module doc.
    } catch {
      // Swallowed intentionally — see the disable comment above.
    }
  })();
  // eslint-disable-next-line lantern-async/no-silent-failure -- inFlight can only reject if the try/catch above somehow re-throws, which it never does; this just clears the in-flight guard.
  void inFlight.finally(() => {
    inFlight = null;
  });
}

/** Test-only seam: clear the in-flight guard between tests. */
export function resetLocalAiPreStartForTests(): void {
  inFlight = null;
}

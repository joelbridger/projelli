/**
 * useLocalLlmModelStatus — drive the OPT-IN Advisor Prep Hero Local AI model download.
 *
 * Unlike useModelStatus (the e5 search model, which is required and downloads
 * automatically), the local AI's GGUF is a ~2.4 GB optional engine. This hook
 * therefore NEVER auto-downloads: on mount it only probes status, and the
 * transfer starts solely when the user calls `start()` (the "Download Advisor Prep Hero
 * Local AI" control). Once running it streams `local-llm-model-download-progress`
 * events into a snapshot the download banner + settings control render.
 *
 * Outside Tauri (browser/tests) the hook stays at 'idle' so nothing renders —
 * same convention as useModelStatus / useRagStatus.
 *
 * Stall watchdog mirrors useModelStatus: a mid-transfer TCP stall (NAT timeout
 * without RST) can freeze the read with no error event, so after 90s without a
 * progress event during an active transfer `stalled` flips true and the banner
 * tells the user that restarting resumes the partial file via HTTP Range.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LOCAL_LLM_MODEL_EVENT,
  localLlmModelEnsure,
  localLlmModelStatus,
  type LocalLlmDownloadProgress,
} from '@/platform/utils/tauri-commands';

/** Download lifecycle states. 'idle' = off-desktop / unprobed; 'absent' = the
 *  model is not downloaded and the user has not opted in yet. */
export type LocalLlmUiState =
  | 'idle'
  | 'absent'
  | 'checking'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'error';

export interface LocalLlmStatusSnapshot {
  state: LocalLlmUiState;
  bytesDone: number;
  bytesTotal: number | null;
  message: string | null;
  /** True when a transfer is active but no progress event arrived for 90s. */
  stalled: boolean;
  /**
   * Has the INITIAL status probe resolved? It starts false on desktop and flips
   * true once we know the real status (ready / downloading / absent); it is also
   * true immediately off-desktop, where there is no model to probe. Consumers
   * use it to distinguish "no local model" from "still checking" so an
   * unset-provider chat is never defaulted to the cloud mid-probe (the privacy
   * initial-load race).
   */
  probed: boolean;
  /** Opt-in: begin the one-time download. No-op while already in flight. */
  start: () => void;
  /** Resume after an error (hf-style Range resume); same call as start. */
  retry: () => void;
}

interface SnapshotState {
  state: LocalLlmUiState;
  bytesDone: number;
  bytesTotal: number | null;
  message: string | null;
  stalled: boolean;
  probed: boolean;
}

const INITIAL: SnapshotState = {
  state: 'idle',
  bytesDone: 0,
  bytesTotal: null,
  message: null,
  stalled: false,
  probed: false,
};

/** No progress event for this long while a transfer is active → stalled. */
const STALL_AFTER_MS = 90_000;
/** How often the watchdog re-checks for a stall. */
const STALL_CHECK_MS = 15_000;

const ACTIVE_STATES: ReadonlySet<LocalLlmUiState> = new Set([
  'checking',
  'downloading',
  'verifying',
]);

export function useLocalLlmModelStatus(): LocalLlmStatusSnapshot {
  const [snap, setSnap] = useState<SnapshotState>(INITIAL);
  const lastEventAtRef = useRef(Date.now());
  // Effect-scoped cancellation as a ref (not a plain `let`): a boolean local
  // trips no-unnecessary-condition because TS can't see the async cleanup
  // mutate it, whereas a ref property read stays a genuine boolean check.
  const cancelledRef = useRef(false);

  const start = useCallback(() => {
    // Give the attempt its own stall window so the banner doesn't re-flag
    // "stalled" before the first event of this transfer arrives.
    lastEventAtRef.current = Date.now();
    setSnap((s) => ({ ...s, state: 'checking', message: null, stalled: false }));
    void localLlmModelEnsure().catch(() => {
      /* the Error event carries the detail */
    });
  }, []);

  useEffect(() => {
    // Reset per setup: React 18 StrictMode runs setup → cleanup → setup with
    // the ref preserved, and the cleanup sets cancelledRef.current = true — so
    // without this reset the second (real) setup would treat itself as already
    // cancelled and never reach the status probe (the control/banner would stay
    // 'idle' forever in dev). Reads go through isCancelled() — a call, not a
    // direct property read — so TS doesn't narrow this reset to a literal and
    // wrongly flag the post-await guards as always-false.
    cancelledRef.current = false;
    let unlisten: (() => void) | null = null;
    let stallTimer: ReturnType<typeof setInterval> | null = null;
    const isCancelled = () => cancelledRef.current;

    void (async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        if (!core.isTauri()) {
          // Off-desktop there is no embedded model to probe: the status is
          // settled (absent) immediately, so mark it probed so consumers don't
          // sit forever in the "checking" state.
          setSnap((s) => ({ ...s, probed: true }));
          return;
        }
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<LocalLlmDownloadProgress>(
          LOCAL_LLM_MODEL_EVENT,
          (event) => {
            const p = event.payload;
            lastEventAtRef.current = Date.now();
            setSnap((s) => ({
              ...s,
              state: p.state,
              bytesDone: p.bytesDone,
              bytesTotal: p.bytesTotal,
              message: p.message ?? null,
              stalled: false,
            }));
          },
        );
        if (isCancelled()) {
          stop();
          return;
        }
        unlisten = stop;

        stallTimer = setInterval(() => {
          setSnap((s) => {
            if (!ACTIVE_STATES.has(s.state) || s.stalled) return s;
            if (Date.now() - lastEventAtRef.current <= STALL_AFTER_MS) return s;
            return { ...s, stalled: true };
          });
        }, STALL_CHECK_MS);

        const status = await localLlmModelStatus();
        if (isCancelled()) return;
        lastEventAtRef.current = Date.now();
        // Every branch sets probed:true — the initial status is now KNOWN, which
        // ends the "checking" window for an unset-provider chat.
        if (status === 'ready') {
          setSnap((s) => ({ ...s, state: 'ready', stalled: false, probed: true }));
        } else if (status === 'downloading') {
          // A download is already in flight (started before this mount):
          // reflect it immediately rather than waiting for the next event.
          setSnap((s) => ({ ...s, state: 'downloading', stalled: false, probed: true }));
        } else {
          // 'absent' (or anything unexpected) — show the opt-in prompt and do
          // NOT auto-start the 2.4 GB transfer.
          setSnap((s) => ({ ...s, state: 'absent', stalled: false, probed: true }));
        }
      } catch {
        // Tauri APIs unavailable (browser / test) — settle as probed so the UI
        // falls back to the cloud default instead of "checking" forever.
        setSnap((s) => ({ ...s, probed: true }));
      }
    })();

    return () => {
      cancelledRef.current = true;
      if (unlisten) unlisten();
      if (stallTimer !== null) clearInterval(stallTimer);
    };
  }, []);

  return { ...snap, start, retry: start };
}

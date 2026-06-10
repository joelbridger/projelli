/**
 * useModelStatus — drive the one-time embedding-model download (Option B).
 *
 * On Tauri mount: probe `model_status`; when files are absent, kick
 * `model_ensure` (idempotent and single-flight on the Rust side) and stream
 * `model-download-progress` events into a snapshot the ModelDownloadCard
 * renders. When the probe says a download is already in flight, the snapshot
 * reflects `downloading` immediately — the engine throttles progress events
 * to ~4 MB, so the first one can be far away on a slow link. Outside Tauri
 * (browser/tests) the hook stays at 'idle' and the card renders nothing —
 * same convention as useRagStatus.
 *
 * Stall watchdog: a mid-transfer TCP stall (NAT timeout without RST) freezes
 * hf-hub's read forever with no error event — the engine can't detect it
 * (hf-hub exposes no read timeout), so the frontend must. When no event has
 * arrived for 90s while a transfer is active, `stalled` flips true so the
 * card can tell the user to restart the app (the single-flight flag resets
 * and hf-hub resumes the partial file via Range).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MODEL_DOWNLOAD_EVENT,
  modelEnsure,
  modelStatus,
  type ModelDownloadProgress,
  type ModelDownloadState,
} from '@/utils/tauri-commands';

export interface ModelStatusSnapshot {
  state: 'idle' | ModelDownloadState;
  bytesDone: number;
  bytesTotal: number | null;
  message: string | null;
  /** True when a transfer is active but no progress event arrived for 90s. */
  stalled: boolean;
  retry: () => void;
}

interface SnapshotState {
  state: 'idle' | ModelDownloadState;
  bytesDone: number;
  bytesTotal: number | null;
  message: string | null;
  stalled: boolean;
}

const INITIAL: SnapshotState = {
  state: 'idle',
  bytesDone: 0,
  bytesTotal: null,
  message: null,
  stalled: false,
};

/** No progress event for this long while a transfer is active → stalled. */
const STALL_AFTER_MS = 90_000;
/** How often the watchdog re-checks for a stall. */
const STALL_CHECK_MS = 15_000;

export function useModelStatus(): ModelStatusSnapshot {
  const [snap, setSnap] = useState<SnapshotState>(INITIAL);
  const lastEventAtRef = useRef(Date.now());

  const retry = useCallback(() => {
    // Give the new attempt its own stall window so the card doesn't
    // re-flag "stalled" before the first event of the retry arrives.
    lastEventAtRef.current = Date.now();
    setSnap((s) => ({ ...s, state: 'checking', message: null, stalled: false }));
    void modelEnsure().catch(() => {
      /* the Error event carries the detail */
    });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let stallTimer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const core = await import('@tauri-apps/api/core');
        if (!core.isTauri()) return;
        const { listen } = await import('@tauri-apps/api/event');
        const stop = await listen<ModelDownloadProgress>(
          MODEL_DOWNLOAD_EVENT,
          (event) => {
            const p = event.payload;
            lastEventAtRef.current = Date.now();
            setSnap({
              state: p.state,
              bytesDone: p.bytesDone,
              bytesTotal: p.bytesTotal,
              message: p.message ?? null,
              stalled: false,
            });
          },
        );
        if (cancelled) {
          stop();
          return;
        }
        unlisten = stop;

        stallTimer = setInterval(() => {
          setSnap((s) => {
            const active =
              s.state === 'checking' ||
              s.state === 'downloading' ||
              s.state === 'verifying';
            if (!active || s.stalled) return s;
            if (Date.now() - lastEventAtRef.current <= STALL_AFTER_MS) return s;
            return { ...s, stalled: true };
          });
        }, STALL_CHECK_MS);

        const status = await modelStatus();
        if (cancelled) return;
        lastEventAtRef.current = Date.now();
        if (status === 'ready') {
          setSnap((s) => ({ ...s, state: 'ready', stalled: false }));
        } else if (status === 'absent') {
          setSnap((s) => ({ ...s, state: 'checking', stalled: false }));
          void modelEnsure().catch(() => {
            /* the Error event carries the detail */
          });
        } else if (status === 'downloading') {
          // Reflect the in-flight download right away instead of waiting
          // up to ~4 MB of transfer for the next throttled event.
          setSnap((s) => ({ ...s, state: 'downloading', stalled: false }));
        }
      } catch {
        // Tauri APIs unavailable (browser / test) — stay idle.
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (stallTimer !== null) clearInterval(stallTimer);
    };
  }, []);

  return { ...snap, retry };
}

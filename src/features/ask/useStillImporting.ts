// useStillImporting (QA-90) — true while any content source (email,
// Wealthbox CRM, OneDrive, or workspace file indexing) is actively
// importing. Reads the exact backend signal the setup screen is built on
// (`get_setup_progress` + the `setup-progress-changed` event via
// `isImportingContent`, QA-89) plus OneDrive's own live sync event — the
// same sources `useSetupProgress` reads — without pulling in that hook's
// Client Map / workspace store dependencies, which have nothing to do with
// whether content is still coming in.

import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  SETUP_PROGRESS_CHANGED_EVENT,
  getSetupProgress,
  isImportingContent,
} from '@/platform/utils/setup-progress-commands';
import { ONEDRIVE_SYNC_EVENT, oneDriveStatus, type OneDriveSyncProgress } from '@/platform/utils/onedrive-commands';

/** Coalesce bursts of source events — mirrors useSetupProgress's debounce. */
const REFETCH_DEBOUNCE_MS = 150;

/**
 * QA-90 round 3 — tri-state, not a plain boolean. `'unknown'` covers the brief
 * window between mount and the first `get_setup_progress` / `onedrive_status`
 * round-trip resolving. A question asked in that window must NOT read as a
 * confident "nothing is importing" — the bug this fixes: `useAsk.ts`'s
 * retrieval-evidence gate used to receive a `false` default during that
 * window, so an instant zero-hit question got the generic "nothing found"
 * decline instead of the honest still-importing one. Callers that need a
 * single "is this ambiguous" boolean should use `isImportStatusUnsettled`
 * below rather than comparing to `'importing'` directly.
 */
export type ImportStatus = 'unknown' | 'importing' | 'idle';

/**
 * True when a zero-hit answer should be treated as ambiguous rather than a
 * confident "nothing found" — either a content source is actively
 * importing, or we don't know yet.
 */
export function isImportStatusUnsettled(status: ImportStatus): boolean {
  return status !== 'idle';
}

export function useStillImporting(): ImportStatus {
  // `null` = not yet known; `false`/`true` = resolved. In browser/dev mode
  // there's no native backend to ask, so both sources start already settled
  // (lazy initializer, not a setState-in-effect) instead of sitting 'unknown'
  // forever.
  const [backendImporting, setBackendImporting] = useState<boolean | null>(() => (isTauri() ? null : false));
  const [oneDriveSyncing, setOneDriveSyncing] = useState<boolean | null>(() => (isTauri() ? null : false));

  useEffect(() => {
    if (!isTauri()) return;
    const guard = { cancelled: false };
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refetch = async () => {
      try {
        const snapshot = await getSetupProgress();
        if (!guard.cancelled) setBackendImporting(isImportingContent(snapshot));
      } catch (err) {
        // Keep the last known value on a transient failure — but if this is
        // the very first attempt (still 'unknown'), settle to the safe
        // default rather than leaving the retrieval-evidence gate stuck
        // treating every zero-hit answer as ambiguous forever.
        console.warn('useStillImporting: setup-progress refetch failed.', err);
        if (!guard.cancelled) setBackendImporting((prev) => prev ?? false);
      }
    };

    // refetch() never rejects (it catches internally above) — this call can't
    // fail, so there's nothing a .catch() here would ever handle.
    // eslint-disable-next-line lantern-async/no-silent-failure -- refetch() has its own try/catch and never rejects
    void refetch();

    void listen(SETUP_PROGRESS_CHANGED_EVENT, () => {
      if (timer) clearTimeout(timer);
      // eslint-disable-next-line lantern-async/no-silent-failure -- refetch() has its own try/catch and never rejects
      timer = setTimeout(() => void refetch(), REFETCH_DEBOUNCE_MS);
    })
      .then((stop) => {
        if (guard.cancelled) stop();
        else unlisten = stop;
      })
      .catch(() => {
        console.warn('useStillImporting: setup-progress listener unavailable.');
      });

    return () => {
      guard.cancelled = true;
      if (timer) clearTimeout(timer);
      if (unlisten) unlisten();
    };
  }, []);

  // OneDrive import progress has no field in the backend snapshot — its
  // truth is this live event (same as the setup screen's overlay) — so it's
  // read directly instead of pulling in useSetupProgress's onedriveStore.
  // QA-90 round 2: a live event alone misses a sync that was ALREADY running
  // before this hook mounted (Ask opened mid-import) or that emits no further
  // progress after mount — so seed the initial value from the backend's own
  // live status (onedrive_status, the same atomic flag the sync loop itself
  // sets) before falling back to listening for updates.
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;

    void oneDriveStatus()
      .then((status) => {
        if (!disposed) setOneDriveSyncing(status.isSyncing);
      })
      .catch((err: unknown) => {
        console.warn('useStillImporting: initial OneDrive status check failed.', err);
        if (!disposed) setOneDriveSyncing((prev) => prev ?? false);
      });

    let unlisten: (() => void) | undefined;
    void listen<OneDriveSyncProgress>(ONEDRIVE_SYNC_EVENT, (event) => {
      setOneDriveSyncing(event.payload.status === 'syncing');
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        console.warn('useStillImporting: OneDrive progress listener unavailable.');
      });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);

  if (backendImporting === true || oneDriveSyncing === true) return 'importing';
  if (backendImporting === null || oneDriveSyncing === null) return 'unknown';
  return 'idle';
}

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

export function useStillImporting(): boolean {
  const [backendImporting, setBackendImporting] = useState(false);
  const [oneDriveSyncing, setOneDriveSyncing] = useState(false);

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
        // Keep the last known value on a transient failure.
        console.warn('useStillImporting: setup-progress refetch failed.', err);
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

  return backendImporting || oneDriveSyncing;
}

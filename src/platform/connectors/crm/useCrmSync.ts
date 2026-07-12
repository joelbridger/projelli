// Subscribe to the `crm-sync-progress` Tauri event and push updates into
// crmStore. Mirrors useMailSync.ts event-subscription pattern.

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { CRM_SYNC_EVENT, type CrmSyncProgress } from '@/platform/utils/wealthbox-commands';
import { useCrmStore } from '@/platform/connectors/crm/crmStore';

export function useCrmSync(): void {
  const setProgress = useCrmStore((s) => s.setProgress);
  useEffect(() => {
    if (!isTauri()) return;
    const un = listen<CrmSyncProgress>(CRM_SYNC_EVENT, (e) => {
      // A slow request from an older attempt must never repaint a newer run.
      if (e.payload.runId !== useCrmStore.getState().currentRunId) return;
      setProgress(e.payload);
    });
    return () => {
      void un.then((f) => { f(); });
    };
  }, [setProgress]);
}

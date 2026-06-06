// Subscribe to the `mail-sync-progress` Tauri event and push updates into
// the mailStore. Mirror of useRagStatus.ts event-subscription pattern.

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { MAIL_SYNC_EVENT, type MailSyncProgress } from '@/utils/mail-commands';
import { useMailStore } from '@/stores/mailStore';

export function useMailSync() {
  const setProgress = useMailStore((s) => s.setProgress);
  useEffect(() => {
    if (!isTauri()) return;
    const un = listen<MailSyncProgress>(MAIL_SYNC_EVENT, (e) => setProgress(e.payload));
    return () => { un.then((f) => f()); };
  }, [setProgress]);
}

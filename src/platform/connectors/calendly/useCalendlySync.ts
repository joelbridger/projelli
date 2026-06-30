import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import {
  CALENDLY_SYNC_EVENT,
  type CalendlySyncProgress,
} from '@/platform/utils/calendly-commands';
import { useCalendlyStore } from '@/platform/connectors/calendly/calendlyStore';

export function useCalendlySync(): void {
  const setProgress = useCalendlyStore((s) => s.setProgress);
  useEffect(() => {
    if (!isTauri()) return;
    const un = listen<CalendlySyncProgress>(CALENDLY_SYNC_EVENT, (e) => {
      setProgress(e.payload);
    });
    return () => {
      void un.then((f) => { f(); });
    };
  }, [setProgress]);
}

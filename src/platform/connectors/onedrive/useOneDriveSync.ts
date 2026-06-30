import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { ONEDRIVE_SYNC_EVENT, type OneDriveSyncProgress } from '@/platform/utils/onedrive-commands';
import { useOneDriveStore } from '@/platform/connectors/onedrive/onedriveStore';

export function useOneDriveSync(): void {
  const setProgress = useOneDriveStore((s) => s.setProgress);
  useEffect(() => {
    if (!isTauri()) return;
    const un = listen<OneDriveSyncProgress>(ONEDRIVE_SYNC_EVENT, (event) => {
      setProgress(event.payload);
    });
    return () => {
      void un.then((f) => { f(); });
    };
  }, [setProgress]);
}

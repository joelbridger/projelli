import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  DOCUSIGN_SYNC_EVENT,
  type DocusignSyncProgress,
} from '@/platform/utils/docusign-commands';
import { useDocusignStore } from '@/features/docusign/docusignStore';

export function useDocusignSync(): void {
  const setProgress = useDocusignStore((s) => s.setProgress);
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = listen<DocusignSyncProgress>(DOCUSIGN_SYNC_EVENT, (event) => {
      setProgress(event.payload);
    });
    return () => {
      void unlisten.then((fn) => { fn(); });
    };
  }, [setProgress]);
}

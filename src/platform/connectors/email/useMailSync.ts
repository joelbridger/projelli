// Subscribe to the `mail-sync-progress` Tauri event and push updates into
// the mailStore. Mirror of useRagStatus.ts event-subscription pattern.
//
// G5: also accepts an optional `onMailChunk` callback. When provided, a
// second listener subscribes to `mail-index-chunk` and calls the callback
// with each payload. The callback is used by App.tsx to feed decrypted mail
// text into the in-memory MiniSearch ContentIndex without persisting it.

import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import { MAIL_SYNC_EVENT, MAIL_INDEX_CHUNK_EVENT, type MailSyncProgress, type MailIndexChunk } from '@/platform/utils/mail-commands';
import { useMailStore } from '@/platform/connectors/email/mailStore';

interface UseMailSyncOptions {
  onMailChunk?: (chunk: MailIndexChunk) => void;
}

export function useMailSync({ onMailChunk }: UseMailSyncOptions = {}) {
  const setProgress = useMailStore((s) => s.setProgress);
  useEffect(() => {
    if (!isTauri()) return;
    const unProg = listen<MailSyncProgress>(MAIL_SYNC_EVENT, (e) => setProgress(e.payload));
    const unChunk = onMailChunk
      ? listen<MailIndexChunk>(MAIL_INDEX_CHUNK_EVENT, (e) => onMailChunk(e.payload))
      : Promise.resolve(() => {});
    return () => {
      void unProg.then((f) => f());
      void unChunk.then((f) => f());
    };
  }, [setProgress, onMailChunk]);
}

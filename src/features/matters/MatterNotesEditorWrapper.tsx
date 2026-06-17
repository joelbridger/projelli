/**
 * MatterNotesEditorWrapper — resolves the matter from the store and manages the
 * MatterSyncClient lifecycle for the notes tab.
 *
 * This is the React boundary between the tab system (which knows only the
 * localMatterId string) and the MatterNotesEditor (which needs the resolved
 * Matter object + a running MatterSyncClient). It boots the sync client on
 * mount and stops it when the tab unmounts.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatterStore } from '@/stores/matterStore';
import { ensureMatterSync, getMatterSyncClient } from '@/features/matters/logic/matterNotesSync';
import { MatterNotesEditor } from '@/features/matters/MatterNotesEditor';
import { useMatterSyncStatus } from '@/stores/matterSyncStore';
import type { MatterSyncClient } from '@/platform/firm/MatterSyncClient';

interface MatterNotesEditorWrapperProps {
  localMatterId: string;
  workspaceService?: { writeFile: (path: string, content: string) => Promise<void> } | null;
  className?: string;
}

export function MatterNotesEditorWrapper({
  localMatterId,
  workspaceService,
  className,
}: MatterNotesEditorWrapperProps) {
  const { t } = useTranslation();
  const matter = useMatterStore((s) => s.matters.find((m) => m.id === localMatterId) ?? null);
  const [syncClient, setSyncClient] = useState<MatterSyncClient | null>(null);
  const [loading, setLoading] = useState(true);
  // Subscribe to sync status so we detect when stopMatterSync evicts our client
  // (e.g. after a key-epoch advance fails with 403/walled).
  const syncStatus = useMatterSyncStatus(localMatterId);

  useEffect(() => {
    if (!matter) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    // Only show the loading spinner on the initial mount or when our client has
    // been evicted from the cache (e.g. after a walled key-epoch advance). For
    // normal status transitions (connecting → live) the current syncClient is
    // still valid and we don't want to flash the loading state.
    const cachedClient = getMatterSyncClient(matter.id);
    if (!cachedClient) {
      setLoading(true);
    }
    void ensureMatterSync(matter).then((client) => {
      if (cancelled) return;
      setSyncClient(client);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      // Do NOT stop the client on unmount — the notes tab can be closed and
      // re-opened; the singleton cache in matterNotesSync handles reuse.
      // stopMatterSync is called explicitly on unshare / sign-out.
    };
  }, [matter?.id, syncStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className={`flex items-center justify-center h-full text-muted-foreground text-sm ${className ?? ''}`}>
        <span>{t('matter.notes.loading')}</span>
      </div>
    );
  }

  if (!matter) {
    return (
      <div className={`flex items-center justify-center h-full text-muted-foreground text-sm ${className ?? ''}`}>
        <span>{t('matter.notes.not-found')}</span>
      </div>
    );
  }

  return (
    <MatterNotesEditor
      matter={matter}
      syncClient={syncClient}
      {...(workspaceService != null ? { workspaceService } : {})}
      {...(className != null ? { className } : {})}
    />
  );
}

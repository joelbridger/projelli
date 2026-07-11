import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  loadLiveCrmRecords,
  saveLiveCrmRecord,
  type LiveCrmRecord,
} from './liveRecords';

/** Keeps a mounted CRM screen in step with the encrypted record store. */
export function useLiveCrmRecords() {
  const workspaceRoot = useWorkspaceStore((state) => state.rootPath);
  const [records, setRecords] = useState<readonly LiveCrmRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setError(null);
      setRecords(await loadLiveCrmRecords(workspaceRoot));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspaceRoot]);
  useEffect(() => { void reload(); }, [reload]);
  const save = useCallback(async (record: LiveCrmRecord) => {
    const saved = await saveLiveCrmRecord(workspaceRoot, record);
    setRecords((current) => {
      const exists = current.some((item) => item.id === saved.id);
      return exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved];
    });
    return saved;
  }, [workspaceRoot]);
  return { records, save, reload, error, workspaceRoot };
}

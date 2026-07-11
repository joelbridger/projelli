import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  getCrmEngineFreshness,
  subscribeCrmEngineFreshness,
  type CrmEngineFreshness,
} from './store';
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
  const workspaceRootRef = useRef(workspaceRoot);
  workspaceRootRef.current = workspaceRoot;
  const [freshness, setFreshness] = useState<CrmEngineFreshness>(
    getCrmEngineFreshness,
  );
  useEffect(() => subscribeCrmEngineFreshness(setFreshness), []);
  const reload = useCallback(async () => {
    const rootAtStart = workspaceRoot;
    try {
      setError(null);
      const loaded = await loadLiveCrmRecords(rootAtStart);
      if (workspaceRootRef.current !== rootAtStart) return;
      setRecords(loaded);
    } catch (reason) {
      if (workspaceRootRef.current !== rootAtStart) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [workspaceRoot]);
  useEffect(() => {
    setRecords([]);
    setError(null);
  }, [workspaceRoot]);
  useEffect(() => { void reload(); }, [reload]);
  const save = useCallback(async (record: LiveCrmRecord) => {
    const rootAtStart = workspaceRoot;
    const saved = await saveLiveCrmRecord(rootAtStart, record);
    if (workspaceRootRef.current !== rootAtStart) return saved;
    setRecords((current) => {
      const exists = current.some((item) => item.id === saved.id);
      return exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved];
    });
    return saved;
  }, [workspaceRoot]);
  return { records, save, reload, error, workspaceRoot, freshness };
}

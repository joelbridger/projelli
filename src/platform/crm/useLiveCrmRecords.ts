import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatterStore } from '@/platform/matter/matterStore';
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
import {
  clearLiveRecordRelay,
  ensureLiveRecordRelay,
  publishLiveRecord,
} from './liveRecordRelay';

// Several CRM surfaces can be mounted at once inside the Home shell. A write
// from one surface must refresh the others too; otherwise a migration-created
// workflow exists in SQLCipher but the Workflows screen still says it is empty.
export const LIVE_CRM_RECORDS_CHANGED = 'lantern:crm-live-records-changed';

/** Keeps a mounted CRM screen in step with the encrypted record store. */
export function useLiveCrmRecords() {
  const workspaceRoot = useWorkspaceStore((state) => state.rootPath);
  const sharedMatterId = useMatterStore((state) => {
    const active = state.matters.find((matter) => matter.id === state.activeMatterId);
    return active?.shared && active.firmMatterId ? active.firmMatterId : null;
  });
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
  useEffect(() => {
    const refresh = () => { void reload(); };
    window.addEventListener(LIVE_CRM_RECORDS_CHANGED, refresh);
    return () => window.removeEventListener(LIVE_CRM_RECORDS_CHANGED, refresh);
  }, [reload]);
  useEffect(() => {
    if (!sharedMatterId || !workspaceRoot) {
      clearLiveRecordRelay();
      return;
    }
    let cancelled = false;
    void ensureLiveRecordRelay(sharedMatterId, async (record) => {
      if (cancelled) return;
      await saveLiveCrmRecord(workspaceRoot, record);
      // The singleton relay persists once, then the shared notification lets
      // every mounted live-record consumer reload its own current workspace.
      if (!cancelled) window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
    });
    return () => { cancelled = true; };
  }, [reload, sharedMatterId, workspaceRoot]);
  const save = useCallback(async (record: LiveCrmRecord) => {
    // Scope firm-level records to the shared client matter (multi-seat), and
    // pin the workspace we started from so a mid-save folder switch can never
    // land one workspace's record in another's view.
    const scoped = sharedMatterId && (!record.matterId || record.matterId === 'firm')
      ? { ...record, matterId: sharedMatterId }
      : record;
    const rootAtStart = workspaceRoot;
    const saved = await saveLiveCrmRecord(rootAtStart, scoped);
    if (workspaceRootRef.current !== rootAtStart) return saved;
    setRecords((current) => {
      const exists = current.some((item) => item.id === saved.id);
      return exists ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved];
    });
    publishLiveRecord(saved);
    window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
    return saved;
  }, [sharedMatterId, workspaceRoot]);
  // Derive the user-facing state from the same shared-matter check that starts
  // the relay. This also prevents a one-frame offline warning while React is
  // switching from a firm matter to a solo workspace.
  const effectiveFreshness: CrmEngineFreshness = sharedMatterId && workspaceRoot
    ? freshness
    : { kind: 'idle' };
  return { records, save, reload, error, workspaceRoot, freshness: effectiveFreshness, sharedMatterId };
}

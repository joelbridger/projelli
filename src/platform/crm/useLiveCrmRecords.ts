import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import {
  readSelectionOperationDecision,
  useSelectionOperationDecision,
} from '@/platform/client-context';
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
  removeLiveRecordRelayWriter,
  publishLiveRecord,
} from './liveRecordRelay';

// Several CRM surfaces can be mounted at once inside the Home shell. A write
// from one surface must refresh the others too; otherwise a migration-created
// workflow exists in SQLCipher but the Workflows screen still says it is empty.
export const LIVE_CRM_RECORDS_CHANGED = 'lantern:crm-live-records-changed';

const CRM_CLIENT_SELECTION_REQUEST = {
  operationClass: 'client-scoped',
  allowAllMatters: false,
  requireFollowerAgreement: true,
} as const;

/** Keeps a mounted CRM screen in step with the encrypted record store. */
export function useLiveCrmRecords() {
  const workspaceRoot = useWorkspaceStore((state) => state.rootPath);
  const clientSelection = useSelectionOperationDecision(CRM_CLIENT_SELECTION_REQUEST);
  const sharedMatterId =
    clientSelection.kind === 'matter' &&
    clientSelection.matter.shared &&
    clientSelection.matter.firmMatterId
      ? clientSelection.matter.firmMatterId
      : null;
  const sharedLocalMatterId =
    clientSelection.kind === 'matter' &&
    clientSelection.matter.shared &&
    clientSelection.matter.firmMatterId
      ? clientSelection.matter.id
      : null;
  const [records, setRecords] = useState<readonly LiveCrmRecord[]>([]);
  const [recordsWorkspaceRoot, setRecordsWorkspaceRoot] =
    useState(workspaceRoot);
  const [error, setError] = useState<string | null>(null);
  const [errorWorkspaceRoot, setErrorWorkspaceRoot] = useState(workspaceRoot);
  const workspaceRootRef = useRef(workspaceRoot);
  useEffect(() => {
    workspaceRootRef.current = workspaceRoot;
  }, [workspaceRoot]);
  const [freshness, setFreshness] = useState<CrmEngineFreshness>(
    getCrmEngineFreshness
  );
  useEffect(() => subscribeCrmEngineFreshness(setFreshness), []);
  const reloadRecords = useCallback(async () => {
    const rootAtStart = workspaceRoot;
    try {
      const loaded = await loadLiveCrmRecords(rootAtStart);
      if (workspaceRootRef.current !== rootAtStart) return;
      setRecordsWorkspaceRoot(rootAtStart);
      setRecords(loaded);
      setErrorWorkspaceRoot(rootAtStart);
      setError(null);
      return loaded;
    } catch (reason) {
      if (workspaceRootRef.current !== rootAtStart) return;
      setErrorWorkspaceRoot(rootAtStart);
      setError(reason instanceof Error ? reason.message : String(reason));
      return undefined;
    }
  }, [workspaceRoot]);
  const reload = useCallback(async (): Promise<void> => {
    await reloadRecords();
  }, [reloadRecords]);
  useEffect(() => {
    void Promise.resolve().then(reload);
  }, [reload]);
  useEffect(() => {
    const refresh = () => {
      void reload();
    };
    window.addEventListener(LIVE_CRM_RECORDS_CHANGED, refresh);
    return () => {
      window.removeEventListener(LIVE_CRM_RECORDS_CHANGED, refresh);
    };
  }, [reload]);
  useEffect(() => {
    if (!sharedMatterId || !workspaceRoot) {
      clearLiveRecordRelay();
      return;
    }
    const lifecycle = { mounted: true };
    const onRemote = async (record: LiveCrmRecord) => {
      if (!lifecycle.mounted) return;
      await saveLiveCrmRecord(workspaceRoot, record);
      // The singleton relay persists once, then the shared notification lets
      // every mounted live-record consumer reload its own current workspace.
      // This signal is independent of the writer's lifecycle, so an in-flight
      // save still reaches remaining panels after its original owner unmounts.
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
    };
    void ensureLiveRecordRelay(sharedMatterId, onRemote).then(() => {
      if (!lifecycle.mounted) removeLiveRecordRelayWriter(onRemote);
    });
    return () => {
      lifecycle.mounted = false;
      removeLiveRecordRelayWriter(onRemote);
    };
  }, [reload, sharedMatterId, workspaceRoot]);
  const publishSavedRecord = useCallback(
    (saved: LiveCrmRecord) => {
      const rootAtStart = workspaceRoot;
      if (workspaceRootRef.current !== rootAtStart) return saved;
      setRecordsWorkspaceRoot(rootAtStart);
      setRecords((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved];
      });
      publishLiveRecord(saved);
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
      return saved;
    },
    [workspaceRoot]
  );
  const save = useCallback(
    async (record: LiveCrmRecord) => {
      const matterSelection = readSelectionOperationDecision({
        operationClass: 'matter-scoped',
        allowAllMatters: true,
        requireFollowerAgreement: true,
      });
      if (matterSelection.kind === 'refused') throw new Error(matterSelection.message);

      let currentSharedMatterId: string | null = null;
      if (
        matterSelection.kind === 'matter' &&
        (!record.matterId || record.matterId === 'firm')
      ) {
        const clientDecision = readSelectionOperationDecision({
          ...CRM_CLIENT_SELECTION_REQUEST,
          expectedScope: { kind: 'matter', matterId: matterSelection.matter.id },
        });
        if (clientDecision.kind === 'refused') throw new Error(clientDecision.message);
        currentSharedMatterId =
          clientDecision.kind === 'matter' &&
          clientDecision.matter.shared &&
          clientDecision.matter.firmMatterId
            ? clientDecision.matter.firmMatterId
            : null;
      }
      // Scope firm-level records to the shared client matter (multi-seat), and
      // pin the workspace we started from so a mid-save folder switch can never
      // land one workspace's record in another's view.
      const scoped =
        currentSharedMatterId && (!record.matterId || record.matterId === 'firm')
          ? { ...record, matterId: currentSharedMatterId }
          : record;
      const rootAtStart = workspaceRoot;
      const saved = await saveLiveCrmRecord(rootAtStart, scoped);
      return publishSavedRecord(saved);
    },
    [publishSavedRecord, workspaceRoot]
  );
  // Derive the user-facing state from the same shared-matter check that starts
  // the relay. This also prevents a one-frame offline warning while React is
  // switching from a firm matter to a solo workspace.
  const effectiveFreshness: CrmEngineFreshness =
    sharedMatterId && workspaceRoot ? freshness : { kind: 'idle' };
  return {
    records: recordsWorkspaceRoot === workspaceRoot ? records : [],
    save,
    publishSavedRecord,
    reload,
    reloadRecords,
    error: errorWorkspaceRoot === workspaceRoot ? error : null,
    workspaceRoot,
    freshness: effectiveFreshness,
    sharedMatterId,
    sharedLocalMatterId,
  };
}

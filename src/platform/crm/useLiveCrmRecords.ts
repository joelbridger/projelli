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
  saveLiveCrmRecordRebased,
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

// One synchronous canonical snapshot per workspace. Every mounted hook writes
// through this shared map, so a held reader in one surface sees a policy save
// from another surface before React has time to re-render either one.
const currentRecordsByWorkspace = new Map<string, readonly LiveCrmRecord[]>();

type CapturedWorkspace = {
  readonly rootPath: string | null;
  readonly generation: number;
};

function workspaceGeneration(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0;
}

/**
 * A returned live-record adapter may outlive the render that created it. Read
 * the workspace store itself before a held reader or writer acts so an A→B
 * switch cannot be hidden by the old hook closure (including A→B→A).
 *
 * The optional shape keeps narrow unit-test store doubles compatible; the real
 * Zustand store always provides getState().
 */
function capturedWorkspaceIsActive(captured: CapturedWorkspace): boolean {
  const getState = (
    useWorkspaceStore as unknown as {
      getState?: () => { rootPath: string | null; rootGeneration?: number };
    }
  ).getState;
  if (!getState) return true;
  const active = getState();
  return (
    active.rootPath === captured.rootPath &&
    workspaceGeneration(active.rootGeneration) === captured.generation
  );
}

const WORKSPACE_CHANGED_MESSAGE =
  'The workspace changed while CRM data was being updated. Try again.';

const CRM_CLIENT_SELECTION_REQUEST = {
  operationClass: 'client-scoped',
  allowAllMatters: false,
  requireFollowerAgreement: true,
} as const;

/** Keeps a mounted CRM screen in step with the encrypted record store. */
export function useLiveCrmRecords() {
  const workspaceRoot = useWorkspaceStore((state) => state.rootPath);
  const rootGeneration = workspaceGeneration(
    useWorkspaceStore((state) => state.rootGeneration)
  );
  const clientSelection = useSelectionOperationDecision(
    CRM_CLIENT_SELECTION_REQUEST
  );
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
  const currentRecordsRef = useRef<{
    workspaceRoot: typeof workspaceRoot;
    records: readonly LiveCrmRecord[];
  }>({ workspaceRoot, records: [] });
  const [recordsWorkspaceRoot, setRecordsWorkspaceRoot] =
    useState(workspaceRoot);
  const [error, setError] = useState<string | null>(null);
  const [errorWorkspaceRoot, setErrorWorkspaceRoot] = useState(workspaceRoot);
  const [freshness, setFreshness] = useState<CrmEngineFreshness>(
    getCrmEngineFreshness
  );
  useEffect(() => subscribeCrmEngineFreshness(setFreshness), []);
  const reloadRecords = useCallback(async () => {
    const rootAtStart = workspaceRoot;
    const capturedAtStart: CapturedWorkspace = {
      rootPath: rootAtStart,
      generation: rootGeneration,
    };
    try {
      const loaded = await loadLiveCrmRecords(rootAtStart);
      if (!capturedWorkspaceIsActive(capturedAtStart)) return;
      currentRecordsRef.current = {
        workspaceRoot: rootAtStart,
        records: loaded,
      };
      if (rootAtStart) currentRecordsByWorkspace.set(rootAtStart, loaded);
      setRecordsWorkspaceRoot(rootAtStart);
      setRecords(loaded);
      setErrorWorkspaceRoot(rootAtStart);
      setError(null);
      return loaded;
    } catch (reason) {
      if (!capturedWorkspaceIsActive(capturedAtStart)) return;
      setErrorWorkspaceRoot(rootAtStart);
      setError(reason instanceof Error ? reason.message : String(reason));
      return undefined;
    }
  }, [rootGeneration, workspaceRoot]);
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
      const capturedAtStart: CapturedWorkspace = {
        rootPath: rootAtStart,
        generation: rootGeneration,
      };
      if (!capturedWorkspaceIsActive(capturedAtStart)) {
        throw new Error(WORKSPACE_CHANGED_MESSAGE);
      }
      // Another mounted screen may have written a newer policy snapshot before
      // this hook re-rendered. Always merge into the shared per-workspace truth;
      // a hook-local ref is only a boot fallback before that shared snapshot
      // exists. Otherwise stale screen B can resurrect policy revoked by A.
      const current = rootAtStart
        ? (currentRecordsByWorkspace.get(rootAtStart) ??
          (currentRecordsRef.current.workspaceRoot === rootAtStart
            ? currentRecordsRef.current.records
            : []))
        : [];
      const next = current.some((item) => item.id === saved.id)
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [...current, saved];
      currentRecordsRef.current = { workspaceRoot: rootAtStart, records: next };
      if (rootAtStart) currentRecordsByWorkspace.set(rootAtStart, next);
      setRecordsWorkspaceRoot(rootAtStart);
      setRecords(next);
      publishLiveRecord(saved);
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
      return saved;
    },
    [rootGeneration, workspaceRoot]
  );
  const save = useCallback(
    async (record: LiveCrmRecord) => {
      const matterSelection = readSelectionOperationDecision({
        operationClass: 'matter-scoped',
        allowAllMatters: true,
        requireFollowerAgreement: true,
      });
      if (matterSelection.kind === 'refused')
        throw new Error(matterSelection.message);

      let currentSharedMatterId: string | null = null;
      if (
        matterSelection.kind === 'matter' &&
        (!record.matterId || record.matterId === 'firm')
      ) {
        const clientDecision = readSelectionOperationDecision({
          ...CRM_CLIENT_SELECTION_REQUEST,
          expectedScope: {
            kind: 'matter',
            matterId: matterSelection.matter.id,
          },
        });
        if (clientDecision.kind === 'refused')
          throw new Error(clientDecision.message);
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
        currentSharedMatterId &&
        (!record.matterId || record.matterId === 'firm')
          ? { ...record, matterId: currentSharedMatterId }
          : record;
      const rootAtStart = workspaceRoot;
      const capturedAtStart: CapturedWorkspace = {
        rootPath: rootAtStart,
        generation: rootGeneration,
      };
      if (!capturedWorkspaceIsActive(capturedAtStart)) {
        throw new Error(WORKSPACE_CHANGED_MESSAGE);
      }
      // This hook's local row is the edit base: comparing it with `scoped`
      // identifies only the fields this screen actually changed. The persistence
      // boundary rebases those fields onto the latest encrypted row, so stale
      // screen B cannot restore a visibility policy screen A just revoked.
      const renderedBase =
        recordsWorkspaceRoot === rootAtStart
          ? records.find((candidate) => candidate.id === scoped.id)
          : undefined;
      // A create followed immediately by an update can beat React's render.
      // In that one case the same hook's write-through ref already holds the
      // saved row. A genuinely stale mounted screen still has a rendered base,
      // so it never takes this fallback and keeps its older edit baseline.
      const base =
        renderedBase ??
        (currentRecordsRef.current.workspaceRoot === rootAtStart
          ? currentRecordsRef.current.records.find(
              (candidate) => candidate.id === scoped.id
            )
          : undefined);
      const saved = await saveLiveCrmRecordRebased(
        rootAtStart,
        scoped,
        base,
        () => capturedWorkspaceIsActive(capturedAtStart)
      );
      if (!capturedWorkspaceIsActive(capturedAtStart)) {
        throw new Error(WORKSPACE_CHANGED_MESSAGE);
      }
      return publishSavedRecord(saved);
    },
    [
      publishSavedRecord,
      records,
      recordsWorkspaceRoot,
      rootGeneration,
      workspaceRoot,
    ]
  );
  // Derive the user-facing state from the same shared-matter check that starts
  // the relay. This also prevents a one-frame offline warning while React is
  // switching from a firm matter to a solo workspace.
  const effectiveFreshness: CrmEngineFreshness =
    sharedMatterId && workspaceRoot ? freshness : { kind: 'idle' };
  return {
    records: recordsWorkspaceRoot === workspaceRoot ? records : [],
    getCurrentRecords: () => {
      if (
        !capturedWorkspaceIsActive({
          rootPath: workspaceRoot,
          generation: rootGeneration,
        })
      )
        return [];
      return (
        (workspaceRoot
          ? currentRecordsByWorkspace.get(workspaceRoot)
          : undefined) ??
        (currentRecordsRef.current.workspaceRoot === workspaceRoot
          ? currentRecordsRef.current.records
          : [])
      );
    },
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

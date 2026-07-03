// Applies the workspace's retention policy: Rust deletes + audit-logs; this
// runner supplies the policy + matter folders, then removes the RAG docs of
// any deleted transcript and records the sweep for the Data Map.
import { isTauri } from '@tauri-apps/api/core';
import { retentionSweep, ragDeletePath, retentionTakePendingRagCleanup } from '@/platform/utils/tauri-commands';
import { getMatters } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { toWorkspaceRelativeFolder } from '@/platform/rag/matterResolver';
import { useRetentionPolicyStore, type RetentionSweepRecord } from './retentionPolicyStore';

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Retry any RAG source ids left over from a previous run that crashed (or hit a
 * transient LanceDB error) between Rust deleting `transcript.json` and the
 * renderer finishing `rag_delete_path` for each of its chunks. Once
 * transcript.json is gone the ids can never be recomputed, so this list is the
 * only remaining record — every attempt clears an id from the persisted store
 * as soon as it succeeds, so a second crash only re-attempts what's left.
 */
async function flushPendingRagCleanup(workspaceRoot: string): Promise<string[]> {
  const ids = useRetentionPolicyStore.getState().pendingRagCleanup[workspaceRoot] ?? [];
  const errors: string[] = [];
  for (const sourceId of ids) {
    try {
      await ragDeletePath(sourceId);
      useRetentionPolicyStore.getState().clearPendingRagCleanupId(workspaceRoot, sourceId);
    } catch (e: unknown) {
      errors.push(`rag cleanup ${sourceId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return errors;
}

export async function runRetentionSweep(
  workspaceRoot: string,
  opts?: { force?: boolean },
): Promise<RetentionSweepRecord | null> {
  if (!isTauri() || !workspaceRoot) return null;
  // Reclaim any ids Rust already wrote DURABLY to disk the instant a
  // transcript delete happened, before the native call even returned last
  // time (see PENDING_RAG_CLEANUP_FILE in retention/mod.rs). This closes the
  // narrow crash window between the native retentionSweep() call resolving
  // and the setPendingRagCleanup call below running: even a full process
  // kill in that window is recovered here on the next launch, since Rust's
  // durable write happened independent of whether this renderer code ever
  // got to run.
  const recoveredIds = await retentionTakePendingRagCleanup(workspaceRoot).catch(() => []);
  if (recoveredIds.length > 0) {
    const current = useRetentionPolicyStore.getState().pendingRagCleanup[workspaceRoot] ?? [];
    useRetentionPolicyStore.getState().setPendingRagCleanup(
      workspaceRoot,
      Array.from(new Set([...current, ...recoveredIds])),
    );
  }
  // Finish any cleanup a previous crashed run left pending — this repairs
  // already-committed deletions, so it runs even when the sweep itself below
  // is about to be skipped by the debounce.
  const carriedErrors = await flushPendingRagCleanup(workspaceRoot);

  const store = useRetentionPolicyStore.getState();
  const last = store.lastSweep[workspaceRoot];
  if (!opts?.force && last && Date.now() - Date.parse(last.sweptAt) < SWEEP_INTERVAL_MS) return null;
  const policy = store.getPolicy(workspaceRoot);
  const activeRoot = useWorkspaceStore.getState().rootPath ?? workspaceRoot;
  const matterFolders = getMatters()
    .flatMap((m) => m.folderPaths)
    .map((folder) => toWorkspaceRelativeFolder(folder, activeRoot))
    .filter((rel): rel is string => Boolean(rel));
  const outcome = await retentionSweep(workspaceRoot, matterFolders, policy.mode, policy.audioRetentionDays);
  // Persist the pending cleanup list BEFORE attempting it: if the renderer
  // crashes mid-loop, the next sweep (or app start) picks up exactly what's
  // left via flushPendingRagCleanup above. MERGE with whatever the initial
  // flushPendingRagCleanup call above didn't manage to clear — overwriting
  // with only this sweep's ids would silently drop any id that failed AGAIN
  // on that retry, and once transcript.json is gone that id can never be
  // recomputed, leaving its RAG chunks searchable forever.
  const stillPending = useRetentionPolicyStore.getState().pendingRagCleanup[workspaceRoot] ?? [];
  const mergedPending = Array.from(new Set([...stillPending, ...outcome.ragCleanupSourceIds]));
  useRetentionPolicyStore.getState().setPendingRagCleanup(workspaceRoot, mergedPending);
  const cleanupErrors = await flushPendingRagCleanup(workspaceRoot);

  const rec: RetentionSweepRecord = {
    sweptAt: new Date().toISOString(),
    deletedCount: outcome.deleted.length,
    errors: [...carriedErrors, ...outcome.errors, ...cleanupErrors],
  };
  useRetentionPolicyStore.getState().recordSweep(workspaceRoot, rec);
  return rec;
}

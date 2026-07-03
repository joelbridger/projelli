// Applies the workspace's retention policy: Rust deletes + audit-logs; this
// runner supplies the policy + matter folders, then removes the RAG docs of
// any deleted transcript and records the sweep for the Data Map.
import { isTauri } from '@tauri-apps/api/core';
import { retentionSweep, ragDeletePath } from '@/platform/utils/tauri-commands';
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
  // left via flushPendingRagCleanup above.
  useRetentionPolicyStore.getState().setPendingRagCleanup(workspaceRoot, outcome.ragCleanupSourceIds);
  const cleanupErrors = await flushPendingRagCleanup(workspaceRoot);

  const rec: RetentionSweepRecord = {
    sweptAt: new Date().toISOString(),
    deletedCount: outcome.deleted.length,
    errors: [...carriedErrors, ...outcome.errors, ...cleanupErrors],
  };
  useRetentionPolicyStore.getState().recordSweep(workspaceRoot, rec);
  return rec;
}

/**
 * In-memory retrieval hold for mail whose durable filing has not yet been
 * mirrored into the vector table. This state deliberately lives outside the
 * workspace hook so a live filing can protect its sources before IPC returns.
 */

let workspace: string | null = null;
let loading = false;
let durableSourceIds = new Set<string>();
let nextLiveHoldId = 0;
const liveSourceIdsByHold = new Map<number, Set<string>>();

function resetForWorkspace(workspaceRoot: string): void {
  workspace = workspaceRoot;
  loading = true;
  durableSourceIds = new Set();
  liveSourceIdsByHold.clear();
}

export function beginPendingMailRagRetagHold(workspaceRoot: string): void {
  resetForWorkspace(workspaceRoot);
}

/**
 * Enter the restart-safe hold as soon as a workspace becomes active.  The
 * durable marker read happens asynchronously, so no mail result may be shown
 * in the gap before that read has completed.
 */
export function beginPendingMailRagRetagStartupHold(workspaceRoot: string): void {
  beginPendingMailRagRetagHold(workspaceRoot);
}

/**
 * A durable-marker read failed. Hold every mail result, but preserve any
 * in-flight filing holds that belong to this workspace.
 */
export function markPendingMailRagRetagLoading(workspaceRoot: string): void {
  if (workspace !== workspaceRoot) {
    resetForWorkspace(workspaceRoot);
    return;
  }
  loading = true;
  durableSourceIds = new Set();
}

/** Hold a live filing's exact sources before its vector update begins. */
export function holdPendingMailRagRetagSources(
  workspaceRoot: string,
  sources: Iterable<string>,
): () => void {
  if (workspace !== workspaceRoot) {
    workspace = workspaceRoot;
    loading = false;
    durableSourceIds = new Set();
    liveSourceIdsByHold.clear();
  }
  const holdId = nextLiveHoldId++;
  liveSourceIdsByHold.set(holdId, new Set(sources));
  return () => {
    // A hold must never release sources for a later workspace. This matters
    // when a filing finishes after the user has switched workspaces.
    if (workspace === workspaceRoot) liveSourceIdsByHold.delete(holdId);
  };
}

/**
 * Refresh the durable source-level marker set without disturbing active live
 * filings. Each live filing owns a separate hold so overlapping requests
 * cannot make one another searchable before their own vector update settles.
 */
export function setPendingMailRagRetagSources(
  workspaceRoot: string,
  sources: Iterable<string>,
): void {
  if (workspace !== workspaceRoot) {
    workspace = workspaceRoot;
    liveSourceIdsByHold.clear();
  }
  workspace = workspaceRoot;
  loading = false;
  durableSourceIds = new Set(sources);
}

export function isPendingMailRagRetagLoading(): boolean {
  return loading;
}

export function isPendingMailRagRetagSource(
  workspaceRoot: string | null | undefined,
  sourceId: string,
): boolean {
  if (workspace !== workspaceRoot) return false;
  if (durableSourceIds.has(sourceId)) return true;
  for (const liveSources of liveSourceIdsByHold.values()) {
    if (liveSources.has(sourceId)) return true;
  }
  return false;
}

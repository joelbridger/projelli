/**
 * In-memory retrieval hold for mail whose durable filing has not yet been
 * mirrored into the vector table. This state deliberately lives outside the
 * workspace hook so a live filing can protect its sources before IPC returns.
 */

let workspace: string | null = null;
let loading = false;
let sourceIds = new Set<string>();

export function beginPendingMailRagRetagHold(workspaceRoot: string): void {
  workspace = workspaceRoot;
  loading = true;
  sourceIds = new Set();
}

/** Hold a live filing's exact sources before its vector update begins. */
export function holdPendingMailRagRetagSources(
  workspaceRoot: string,
  sources: Iterable<string>,
): void {
  if (workspace !== workspaceRoot) {
    workspace = workspaceRoot;
    loading = false;
    sourceIds = new Set();
  }
  for (const source of sources) sourceIds.add(source);
}

/** Replace the temporary live hold with the durable source-level marker set. */
export function setPendingMailRagRetagSources(
  workspaceRoot: string,
  sources: Iterable<string>,
): void {
  workspace = workspaceRoot;
  loading = false;
  sourceIds = new Set(sources);
}

export function isPendingMailRagRetagLoading(): boolean {
  return loading;
}

export function isPendingMailRagRetagSource(
  workspaceRoot: string | null | undefined,
  sourceId: string,
): boolean {
  return workspace === workspaceRoot && sourceIds.has(sourceId);
}

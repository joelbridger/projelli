import { invoke, isTauri } from '@tauri-apps/api/core';
import { crmSetWorkspace } from '@/platform/utils/wealthbox-commands';
import type {
  MergeApprovalRequest,
  MergeApprovalResult,
  RedactedMergeReceipt,
} from './contract';

let mergeWorkspaceOperation: Promise<void> = Promise.resolve();

function inMergeWorkspace<T>(workspaceRoot: string, operation: () => Promise<T>) {
  const task = mergeWorkspaceOperation.catch((error: unknown) => {
    console.warn('CRM merge workspace selection failed:', error);
  }).then(async () => {
    await crmSetWorkspace(workspaceRoot);
    return operation();
  });
  mergeWorkspaceOperation = task.then(() => undefined, () => undefined);
  return task;
}

/** Sends an explicit, review-approved merge to the sole SQLCipher boundary. */
export async function approveHouseholdMerge(
  workspaceRoot: string | null | undefined,
  request: MergeApprovalRequest
): Promise<MergeApprovalResult> {
  if (!isTauri()) throw new Error('Household merges are available only in the desktop app.');
  if (!workspaceRoot) throw new Error('Open a workspace before merging households.');
  return inMergeWorkspace(workspaceRoot, () =>
    invoke<MergeApprovalResult>('crm_merge_households_approve', { request })
  );
}

/** Loads only a durable, redacted receipt—not either household's private data. */
export function findMergeReceipt(
  workspaceRoot: string | null | undefined,
  receiptId: string
): Promise<RedactedMergeReceipt | null> {
  if (!isTauri() || !workspaceRoot) return Promise.resolve(null);
  return inMergeWorkspace(workspaceRoot, () =>
    invoke<RedactedMergeReceipt | null>('crm_merge_receipt_get', { receiptId })
  );
}

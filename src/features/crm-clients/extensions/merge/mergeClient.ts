import { invoke, isTauri } from '@tauri-apps/api/core';
import type {
  MergeApprovalRequest,
  MergeApprovalResult,
  RedactedMergeReceipt,
} from './contract';

/**
 * Sends an explicit, review-approved merge to the sole SQLCipher boundary.
 * The native command pins the already-open workspace through the complete
 * transaction; this client never performs a separate, raceable workspace swap.
 */
export async function approveHouseholdMerge(
  workspaceRoot: string | null | undefined,
  request: MergeApprovalRequest
): Promise<MergeApprovalResult> {
  if (!isTauri()) throw new Error('Household merges are available only in the desktop app.');
  if (!workspaceRoot) throw new Error('Open a workspace before merging households.');
  return invoke<MergeApprovalResult>('crm_merge_households_approve', {
    workspaceRoot,
    request,
  });
}

/** Loads only a durable, redacted receipt—not either household's private data. */
export function findMergeReceipt(
  workspaceRoot: string | null | undefined,
  receiptId: string
): Promise<RedactedMergeReceipt | null> {
  if (!isTauri() || !workspaceRoot) return Promise.resolve(null);
  return invoke<RedactedMergeReceipt | null>('crm_merge_receipt_get', {
    workspaceRoot,
    receiptId,
  });
}

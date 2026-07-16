/**
 * Public doorway for duplicate household merge consumers.
 *
 * This contract intentionally exposes only eligibility, review input,
 * approval, and redacted receipt lookup. SQL rows, raw stored documents, and
 * native transaction mechanics remain inside the feature.
 */
export type MergeChoice = 'source' | 'target';

export interface MergeEligibility {
  eligible: boolean;
  reason?: 'same-household' | 'inaccessible-household';
}

export interface MergeReviewInput {
  sourceId: string;
  targetId: string;
  conflictingFields: readonly string[];
  movedReferenceCount: number;
}

export interface MergeApprovalRequest {
  sourceId: string;
  targetId: string;
  matterId: string;
  idempotencyKey: string;
  fieldChoices: Readonly<Record<string, MergeChoice>>;
}

export interface RedactedMergeReceipt {
  receiptId: string;
  sourceId: string;
  targetId: string;
  matterId: string;
  approvedBy: string;
  approvedAt: string;
  movedReferenceCount: number;
  conflictCount: number;
}

export interface MergeApprovalResult {
  receipt: RedactedMergeReceipt;
  idempotent: boolean;
}

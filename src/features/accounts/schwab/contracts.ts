import { findSchwabPacketReceipt, type SchwabPacketReceipt } from './packet';
import type { SchwabAccountType, SchwabHousehold } from './mapping';

/** The only input accepted by the public Schwab review surface. */
export interface SchwabReviewInput {
  household: SchwabHousehold;
}

/** Value-free review progress for callers that need to present its status. */
export interface SchwabRedactedProposalStatus {
  accountType: SchwabAccountType;
  fieldCount: number;
  unresolvedConflictCount: number;
  ready: boolean;
}

/** The public result shape of an approval attempt; receipts are redacted. */
export type SchwabApprovalResult =
  | { status: 'approved'; receipt: SchwabPacketReceipt }
  | { status: 'stalled'; receipt: undefined };

/** The only supported lookup key for a saved, redacted receipt. */
export interface SchwabReceiptLookup {
  householdId: string;
  accountType: SchwabAccountType;
}

/** Looks up a saved redacted receipt without exposing packet construction. */
export function findSchwabReceipt({
  householdId,
  accountType,
}: SchwabReceiptLookup): SchwabPacketReceipt | undefined {
  return findSchwabPacketReceipt(householdId, accountType);
}

export type { SchwabAccountType, SchwabHousehold, SchwabPacketReceipt };

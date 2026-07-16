import { createElement } from 'react';
import type { HouseholdHeaderActionDescriptor } from '../../recordRegistry';
import { MergeHeaderAction } from './MergeHeaderAction';

declare module '../../recordRegistry' {
  interface HouseholdHeaderActionIdMap { merge_duplicate: true; }
}

/** The sole record-shell registration owned by this feature. */
export const householdMergeHeaderAction: HouseholdHeaderActionDescriptor = {
  id: 'merge_duplicate',
  order: 50,
  mount: (context) => createElement(MergeHeaderAction, context),
};

export { assessMergeEligibility, buildMergeReview } from './mergeReview';
export { approveHouseholdMerge, findMergeReceipt } from './mergeClient';
export type {
  MergeApprovalRequest,
  MergeApprovalResult,
  MergeChoice,
  MergeEligibility,
  MergeReviewInput,
  RedactedMergeReceipt,
} from './contract';

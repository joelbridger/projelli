import { createDirectoryPreferenceStore } from '@/features/crm-clients/directoryPreferences';
import type { DuplicateContactMatch } from './duplicateDetection';

export type DuplicateReviewDisposition = 'reviewed' | 'dismissed';
export type DuplicateReviewState = Readonly<
  Record<string, DuplicateReviewDisposition>
>;

export const EMPTY_DUPLICATE_REVIEW_STATE: DuplicateReviewState = Object.freeze(
  {}
);

function isDuplicateReviewState(value: unknown): value is DuplicateReviewState {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (disposition) => disposition === 'reviewed' || disposition === 'dismissed'
    )
  );
}

/** The duplicate extension's one sanctioned saved-preference slot. */
export const duplicateReviewPreferences =
  createDirectoryPreferenceStore<DuplicateReviewState>(
    'crm-duplicates',
    isDuplicateReviewState
  );

export function readDuplicateReviewState(): DuplicateReviewState {
  return duplicateReviewPreferences.load() ?? EMPTY_DUPLICATE_REVIEW_STATE;
}

export function duplicateMatchKey(match: DuplicateContactMatch): string {
  return [
    match.normalizedName,
    match.explanation,
    ...match.records.map(({ ref }) => `${ref.kind}:${ref.matterId}:${ref.id}`),
  ].join('|');
}

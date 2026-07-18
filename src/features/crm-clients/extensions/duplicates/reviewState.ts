import {
  createDirectoryPreferenceStore,
  type DirectoryPreferenceStore,
} from '@/features/crm-clients';
import type { DuplicateContactMatch } from './duplicateDetection';

export type DuplicateReviewDisposition = 'reviewed' | 'dismissed';
export type DuplicateReviewState = Readonly<
  Record<string, DuplicateReviewDisposition>
>;

export const EMPTY_DUPLICATE_REVIEW_STATE: DuplicateReviewState = Object.freeze(
  {}
);

function isDuplicateReviewState(value: unknown): value is DuplicateReviewState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(
    (disposition) => disposition === 'reviewed' || disposition === 'dismissed'
  );
}

function createDuplicateReviewPreferences(): DirectoryPreferenceStore<DuplicateReviewState> {
  return createDirectoryPreferenceStore<DuplicateReviewState>(
    'crm-duplicates',
    isDuplicateReviewState
  );
}

/** The duplicate extension's one sanctioned, lazily opened saved-preference slot. */
export const duplicateReviewPreferences: DirectoryPreferenceStore<DuplicateReviewState> = {
  load: () => createDuplicateReviewPreferences().load(),
  save: (value) => {
    createDuplicateReviewPreferences().save(value);
  },
  clear: () => {
    createDuplicateReviewPreferences().clear();
  },
};

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

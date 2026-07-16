import type { HouseholdRecord } from '../../adapters';
import type { MergeEligibility, MergeReviewInput } from './contract';

const scalarFields = [
  'name',
  'lifecycle',
  'primaryAdvisor',
  'ownership',
  'serviceTier',
  'nextReview',
  'schedulingLinkUrl',
] as const;
const referenceFields = [
  'facts',
  'accounts',
  'members',
  'externalParties',
  'notes',
  'customFields',
  'tags',
  'contextRefs',
] as const;
const nonScalarFields = [...referenceFields, 'extensionData'] as const;

function values(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasConflict(sourceValue: unknown, targetValue: unknown): boolean {
  if (sourceValue === undefined || sourceValue === null) return false;
  if (targetValue === undefined || targetValue === null) return false;
  if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
    return sourceValue.length > 0 && targetValue.length > 0
      && JSON.stringify(sourceValue) !== JSON.stringify(targetValue);
  }
  return JSON.stringify(sourceValue) !== JSON.stringify(targetValue);
}

export function assessMergeEligibility(
  source: Pick<HouseholdRecord, 'id' | 'ownership'>,
  target: Pick<HouseholdRecord, 'id' | 'ownership'>
): MergeEligibility {
  if (source.id === target.id) return { eligible: false, reason: 'same-household' };
  if (source.ownership === 'other' || target.ownership === 'other') {
    return { eligible: false, reason: 'inaccessible-household' };
  }
  return { eligible: true };
}

/** Creates a value-free review plan. The native transaction rechecks all data. */
export function buildMergeReview(
  source: HouseholdRecord,
  target: HouseholdRecord
): MergeReviewInput {
  const conflictingFields = [...scalarFields, ...nonScalarFields].filter((field) =>
    hasConflict(source[field], target[field])
  );
  const movedReferenceCount = referenceFields.reduce(
    (count, field) => count + (hasConflict(source[field], target[field]) ? [] : values(source[field])).filter((entry) => {
      const sourceId = entry !== null && typeof entry === 'object' && 'id' in entry
        ? (entry as { id?: unknown }).id
        : undefined;
      return !values(target[field]).some((candidate) => {
        const targetId = candidate !== null && typeof candidate === 'object' && 'id' in candidate
          ? (candidate as { id?: unknown }).id
          : undefined;
        return sourceId !== undefined ? sourceId === targetId : JSON.stringify(entry) === JSON.stringify(candidate);
      });
    }).length,
    0
  );
  return { sourceId: source.id, targetId: target.id, conflictingFields, movedReferenceCount };
}

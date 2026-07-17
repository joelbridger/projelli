import type { ContactRef } from '@/features/crm-contacts';
import type { ClientBoundary } from '@/features/meetings';
import type { Matter } from '@/platform/types/matter';
import type { HouseholdRecord } from './adapters';
import type { HouseholdSectionContext } from './recordRegistry';

type HouseholdBoundarySource = Pick<HouseholdRecord, 'id' | 'name'>;

/**
 * Resolve a CRM household to its one authoritative local matter.  The saved
 * CRM key on Matter is the only proof accepted here: caller-supplied matter
 * ids, including a shared matter's firmMatterId, are deliberately ignored.
 */
export function resolveHouseholdMatterId(
  household: Pick<HouseholdBoundarySource, 'id'>,
  matters: readonly Matter[]
): string | undefined {
  const candidates = matters.filter((matter) =>
    (matter.crmHouseholdKeys ?? []).includes(household.id)
  );

  // Missing or ambiguous links must never open a cross-client boundary.
  return candidates.length === 1 ? candidates[0]?.id : undefined;
}

/**
 * Create Meetings' client isolation boundary only from Matter.crmHouseholdKeys.
 * A missing or ambiguous match fails closed by returning no boundary.
 */
export function toMeetingClientBoundary(
  household: HouseholdBoundarySource,
  matters: readonly Matter[]
): ClientBoundary | undefined {
  const matterId = resolveHouseholdMatterId(household, matters);
  if (!matterId) return undefined;

  return {
    householdRef: household.id,
    matterId,
    ...(household.name.trim() ? { displayName: household.name.trim() } : {}),
  };
}

/** Build the public section context from the same authoritative local-matter link. */
export function toHouseholdSectionContext(
  household: HouseholdBoundarySource,
  matters: readonly Matter[]
): HouseholdSectionContext | undefined {
  const matterId = resolveHouseholdMatterId(household, matters);
  if (!matterId) return undefined;

  const householdRef: ContactRef = {
    kind: 'household',
    id: household.id,
    matterId,
    ...(household.name.trim() ? { label: household.name.trim() } : {}),
  };
  return { householdRef, matterId };
}

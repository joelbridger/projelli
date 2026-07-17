import { validateContactRef, type ContactRef } from '@/features/crm-contacts';
import type { ClientBoundary } from '@/features/meetings';
import type { HouseholdSectionContext } from './recordRegistry';

/**
 * The durable identity the household record surface receives from the live CRM
 * record. `matterId` deliberately appears both here and in `householdRef` so
 * this adapter can reject a crossed-client handoff instead of repairing it.
 */
export interface HouseholdRecordIdentity {
  householdRef: ContactRef;
  matterId: string;
  displayName?: string;
}

function checkedIdentity(identity: HouseholdRecordIdentity): HouseholdRecordIdentity {
  const householdRef = validateContactRef(identity.householdRef);
  if (householdRef.kind !== 'household') {
    throw new Error('Household record identity must reference a household.');
  }
  if (householdRef.matterId !== identity.matterId) {
    throw new Error('Household record identity matterId must match householdRef.matterId.');
  }
  return {
    householdRef,
    matterId: identity.matterId,
    ...(identity.displayName?.trim()
      ? { displayName: identity.displayName.trim() }
      : {}),
  };
}

/** Build the deliberately narrow public section context from a verified record identity. */
export function householdSectionContextFromRecordIdentity(
  identity: HouseholdRecordIdentity
): HouseholdSectionContext {
  const checked = checkedIdentity(identity);
  return { householdRef: checked.householdRef, matterId: checked.matterId };
}

/**
 * Adapt a verified CRM household identity to Meetings' client isolation
 * boundary. This never derives a matter id from a household id.
 */
export function toMeetingClientBoundary(
  identity: HouseholdRecordIdentity
): ClientBoundary {
  const checked = checkedIdentity(identity);
  return {
    householdRef: checked.householdRef.id,
    matterId: checked.matterId,
    ...(checked.displayName ? { displayName: checked.displayName } : {}),
  };
}

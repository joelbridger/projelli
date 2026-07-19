import type { Matter } from '@/platform/types/matter';
import type { AutoJoinCandidate } from './meetingAutoJoin';
import type { SealedMeetingClientBoundary } from './foundation/contract';

export type AutoJoinManagementScope =
  | { readonly kind: 'firm-wide' }
  | {
      readonly kind: 'selected-client';
      readonly client: SealedMeetingClientBoundary;
    };

/**
 * A matter id alone never narrows the Automations list. Selected-client mode
 * requires the sealed household + matter pair and one unambiguous saved
 * household link. If the calendar match cannot prove that pair, the candidate
 * is suppressed rather than exposing another household's title or count.
 */
export function filterAutoJoinCandidatesForManagement(
  candidates: readonly AutoJoinCandidate[],
  matters: readonly Matter[],
  scope: AutoJoinManagementScope
): AutoJoinCandidate[] {
  if (scope.kind === 'firm-wide') return [...candidates];

  const linkedMatters = matters.filter(
    (matter) => !matter.archived && matter.id === scope.client.matterId
  );
  if (linkedMatters.length !== 1) return [];
  const householdRefs = Array.from(
    new Set(
      (linkedMatters[0]?.crmHouseholdKeys ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  if (
    householdRefs.length !== 1 ||
    householdRefs[0] !== scope.client.householdRef
  ) {
    return [];
  }
  return candidates.filter(
    (candidate) => candidate.matterId === scope.client.matterId
  );
}

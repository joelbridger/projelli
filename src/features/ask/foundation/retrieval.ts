import type {
  AskAnswerProjection,
  AskCitation,
  AskOwnerIdentityAdapter,
  AskRetrievalPlan,
  AskSourceDescriptor,
  AskSourceKind,
  ResolvedAskScope,
} from './contracts';
import { askScopeSnapshotsMatch, askSourceBelongsToScope } from './scope';

export function buildAskRetrievalPlan<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  requestedSourceKinds: readonly AskSourceKind[],
  candidates: readonly AskSourceDescriptor<ClientReference, MeetingReference>[],
  owners: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): AskRetrievalPlan<ClientReference, MeetingReference> {
  const kinds = [...new Set(requestedSourceKinds)];
  const references = candidates
    .filter((source) => source.availability === 'available')
    .filter((source) => kinds.includes(source.kind))
    .filter((source) => askSourceBelongsToScope(scope, source, owners))
    .map((source) => ({
      sourceId: source.sourceId,
      reason: `Eligible ${source.kind} in resolved ${scope.kind} scope.`,
    }));
  return { scope, requestedSourceKinds: kinds, references };
}

export function buildAskCitation<ClientReference, MeetingReference>(
  claimId: string,
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  source: AskSourceDescriptor<ClientReference, MeetingReference>,
  owners: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): AskCitation<ClientReference, MeetingReference> {
  if (!claimId.trim() || !askSourceBelongsToScope(scope, source, owners)) {
    throw new Error('Ask citation source is outside the resolved scope.');
  }
  return {
    claimId,
    sourceId: source.sourceId,
    sourceKind: source.kind,
    client: source.client,
    scope,
    opener: source.citationOpenPath,
    label: source.label,
    ...(source.kind === 'meeting-artifact'
      ? {
          meeting: source.meeting,
          occurredOn: source.occurredOn,
          meetingType: source.meetingType,
        }
      : {}),
  };
}

/** Re-check this just before an opener or answer action uses a saved citation. */
export function askCitationBelongsToScope<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  citation: AskCitation<ClientReference, MeetingReference>,
  owners: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): boolean {
  if (!askScopeSnapshotsMatch(scope, citation.scope, owners)) return false;
  const base = {
    sourceId: citation.sourceId,
    workspaceId: citation.scope.workspaceId,
    client: citation.client,
    label: citation.label,
    availability: 'available' as const,
    citationOpenPath: citation.opener,
  };
  const source: AskSourceDescriptor<ClientReference, MeetingReference> | null =
    citation.sourceKind === 'meeting-artifact'
      ? citation.meeting && citation.occurredOn && citation.meetingType
        ? {
            ...base,
            kind: 'meeting-artifact',
            meeting: citation.meeting,
            occurredOn: citation.occurredOn,
            meetingType: citation.meetingType,
          }
        : null
      : citation.sourceKind === 'email-descriptor'
        ? { ...base, kind: 'email-descriptor', date: '' }
        : citation.sourceKind === 'crm-contact'
          ? { ...base, kind: 'crm-contact' }
          : { ...base, kind: 'document' };
  return source ? askSourceBelongsToScope(scope, source, owners) : false;
}

export function noLocalAnswer<
  ClientReference = never,
  MeetingReference = never,
>(
  message = 'No local answer is available for this scope.'
): AskAnswerProjection<ClientReference, MeetingReference> {
  return { kind: 'no-local-answer', message, citations: [] };
}

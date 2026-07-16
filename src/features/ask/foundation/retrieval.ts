import type {
  AskAnswerProjection,
  AskCitation,
  AskCitationOpenPath,
  AskClientUseAccess,
  AskRetrievalPlan,
  AskSourceDescriptor,
  AskSourceKind,
  ResolvedAskScope,
} from './contracts';
import {
  assertAskScopeCurrent,
  askScopeIsCurrent,
  askScopeSnapshotsMatch,
  askSourceBelongsToScope,
} from './scope';

const citationOpenPaths = new WeakMap<object, AskCitationOpenPath>();

export function buildAskRetrievalPlan<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  requestedSourceKinds: readonly AskSourceKind[],
  candidates: readonly AskSourceDescriptor<ClientReference, MeetingReference>[],
  access: AskClientUseAccess<ClientReference, MeetingReference>
): AskRetrievalPlan<ClientReference, MeetingReference> {
  assertAskScopeCurrent(scope, access);
  const kinds = [...new Set(requestedSourceKinds)];
  const references = candidates
    .filter((source) => source.availability === 'available')
    .filter((source) => kinds.includes(source.kind))
    .filter((source) => askSourceBelongsToScope(scope, source, access))
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
  access: AskClientUseAccess<ClientReference, MeetingReference>
): AskCitation<ClientReference, MeetingReference> {
  if (!claimId.trim() || !askSourceBelongsToScope(scope, source, access)) {
    throw new Error('Ask citation source is outside the resolved scope.');
  }
  const citation: AskCitation<ClientReference, MeetingReference> = {
    claimId,
    sourceId: source.sourceId,
    sourceKind: source.kind,
    client: source.client,
    scope,
    label: source.label,
    ...(source.kind === 'meeting-artifact'
      ? {
          meeting: source.meeting,
          occurredOn: source.occurredOn,
          meetingType: source.meetingType,
        }
      : {}),
  };
  citationOpenPaths.set(citation, source.citationOpenPath);
  return citation;
}

/** Re-check this just before an opener or answer action uses a saved citation. */
export function askCitationBelongsToScope<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  citation: AskCitation<ClientReference, MeetingReference>,
  access: AskClientUseAccess<ClientReference, MeetingReference>
): boolean {
  const owners = access.owners;
  if (!askScopeIsCurrent(scope, access)) return false;
  if (!askScopeSnapshotsMatch(scope, citation.scope, owners)) return false;
  const openPath = citationOpenPaths.get(citation);
  if (!openPath) return false;
  const base = {
    sourceId: citation.sourceId,
    workspaceId: citation.scope.workspaceId,
    client: citation.client,
    label: citation.label,
    availability: 'available' as const,
    citationOpenPath: openPath,
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
  return source ? askSourceBelongsToScope(scope, source, access) : false;
}

/** The only public path from a saved citation to actionable opener metadata. */
export function resolveAskCitationOpenPath<
  ClientReference,
  MeetingReference,
>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  citation: AskCitation<ClientReference, MeetingReference>,
  access: AskClientUseAccess<ClientReference, MeetingReference>
): AskCitationOpenPath {
  if (!askCitationBelongsToScope(scope, citation, access)) {
    throw new Error('Ask citation is stale or outside the current client.');
  }
  const openPath = citationOpenPaths.get(citation);
  if (!openPath) {
    throw new Error('Ask citation has no validated opener capability.');
  }
  return openPath;
}

export function noLocalAnswer<
  ClientReference = never,
  MeetingReference = never,
>(
  message = 'No local answer is available for this scope.'
): AskAnswerProjection<ClientReference, MeetingReference> {
  return { kind: 'no-local-answer', message, citations: [] };
}

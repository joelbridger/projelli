import type {
  AskAnswerProjection,
  AskCitation,
  AskCitationOpenPath,
  AskRetrievalPlan,
  AskSealedOpenPath,
  AskSourceDescriptor,
  AskSourceKind,
  ResolvedAskScope,
} from './contracts';
import {
  assertAskScopeCurrent,
  askScopeIsCurrent,
  askScopeSnapshotsMatch,
  askSourceBelongsToScope,
  readBoundAskOwners,
} from './scope';

/**
 * The real actionable opener metadata lives ONLY here, keyed by an opaque sealed
 * ref. A source carries the sealed ref (non-actionable); the raw token is
 * released only through the use-time-guarded `resolveAskCitationOpenPath`.
 */
const sealedOpenPaths = new Map<string, AskCitationOpenPath>();
let sealCounter = 0;

/**
 * Seal actionable opener metadata into an opaque, non-actionable reference for a
 * source descriptor. The raw token never appears as a plain source field or in a
 * persisted record.
 */
export function sealAskOpenPath(open: AskCitationOpenPath): AskSealedOpenPath {
  if (!open.token.trim()) {
    throw new Error('Ask opener metadata requires a token to seal.');
  }
  sealCounter += 1;
  const ref = `ask-open:${String(sealCounter)}:${Math.random()
    .toString(36)
    .slice(2)}`;
  sealedOpenPaths.set(ref, { kind: open.kind, token: open.token });
  return { kind: open.kind, ref: ref as AskSealedOpenPath['ref'] };
}

function unsealAskOpenPath(
  sealed: AskSealedOpenPath
): AskCitationOpenPath | null {
  const actual = sealedOpenPaths.get(sealed.ref);
  return actual ? { kind: actual.kind, token: actual.token } : null;
}

const citationOpenPaths = new WeakMap<object, AskSealedOpenPath>();

export function buildAskRetrievalPlan<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  requestedSourceKinds: readonly AskSourceKind[],
  candidates: readonly AskSourceDescriptor<ClientReference, MeetingReference>[]
): AskRetrievalPlan<ClientReference, MeetingReference> {
  assertAskScopeCurrent(scope);
  const kinds = [...new Set(requestedSourceKinds)];
  const references = candidates
    .filter((source) => source.availability === 'available')
    .filter((source) => kinds.includes(source.kind))
    .filter((source) => askSourceBelongsToScope(scope, source))
    .map((source) => ({
      sourceId: source.sourceId,
      reason: `Eligible ${source.kind} in resolved ${scope.kind} scope.`,
    }));
  return { scope, requestedSourceKinds: kinds, references };
}

export function buildAskCitation<ClientReference, MeetingReference>(
  claimId: string,
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  source: AskSourceDescriptor<ClientReference, MeetingReference>
): AskCitation<ClientReference, MeetingReference> {
  if (!claimId.trim() || !askSourceBelongsToScope(scope, source)) {
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
  citation: AskCitation<ClientReference, MeetingReference>
): boolean {
  if (!askScopeIsCurrent(scope)) return false;
  const owners = readBoundAskOwners<ClientReference, MeetingReference>();
  if (!owners) return false;
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
  return source ? askSourceBelongsToScope(scope, source) : false;
}

/** The only public path from a saved citation to actionable opener metadata. */
export function resolveAskCitationOpenPath<
  ClientReference,
  MeetingReference,
>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  citation: AskCitation<ClientReference, MeetingReference>
): AskCitationOpenPath {
  if (!askCitationBelongsToScope(scope, citation)) {
    throw new Error('Ask citation is stale or outside the current client.');
  }
  const sealed = citationOpenPaths.get(citation);
  if (!sealed) {
    throw new Error('Ask citation has no validated opener capability.');
  }
  const actual = unsealAskOpenPath(sealed);
  if (!actual) {
    throw new Error('Ask citation opener metadata is unavailable.');
  }
  return actual;
}

export function noLocalAnswer<
  ClientReference = never,
  MeetingReference = never,
>(
  message = 'No local answer is available for this scope.'
): AskAnswerProjection<ClientReference, MeetingReference> {
  return { kind: 'no-local-answer', message, citations: [] };
}

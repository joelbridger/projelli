import type {
  AskAnswerProjection,
  AskCitation,
  AskRetrievalPlan,
  AskSourceDescriptor,
  AskSourceKind,
  ResolvedAskScope,
} from './contracts';
import { askSourceBelongsToScope } from './scope';

export function buildAskRetrievalPlan(
  scope: ResolvedAskScope,
  requestedSourceKinds: readonly AskSourceKind[],
  candidates: readonly AskSourceDescriptor[]
): AskRetrievalPlan {
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

export function buildAskCitation(
  claimId: string,
  scope: ResolvedAskScope,
  source: AskSourceDescriptor
): AskCitation {
  if (!claimId.trim() || !askSourceBelongsToScope(scope, source)) {
    throw new Error('Ask citation source is outside the resolved scope.');
  }
  return {
    claimId,
    sourceId: source.sourceId,
    sourceKind: source.kind,
    matterId: source.matterId,
    ...(source.contactRef ? { contactRef: source.contactRef } : {}),
    scope,
    opener: source.citationOpenPath,
    label: source.label,
  };
}

/** Re-check this just before an opener or answer action uses a saved citation. */
export function askCitationBelongsToScope(
  scope: ResolvedAskScope,
  citation: AskCitation
): boolean {
  if (
    citation.scope.workspaceId !== scope.workspaceId ||
    citation.matterId === ''
  )
    return false;
  return askSourceBelongsToScope(scope, {
    sourceId: citation.sourceId,
    kind: citation.sourceKind,
    workspaceId: citation.scope.workspaceId,
    matterId: citation.matterId,
    ...(citation.contactRef ? { contactRef: citation.contactRef } : {}),
    label: citation.label,
    availability: 'available',
    citationOpenPath: citation.opener,
  });
}

export function noLocalAnswer(
  message = 'No local answer is available for this scope.'
): AskAnswerProjection {
  return { kind: 'no-local-answer', message, citations: [] };
}

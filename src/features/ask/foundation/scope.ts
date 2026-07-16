import type {
  AskClientContext,
  AskScope,
  AskScopeBuilder,
  AskSourceDescriptor,
  ContactRef,
  MeetingRef,
  ResolvedAskScope,
} from './contracts';

export class AskScopeError extends Error {}

function required(value: string, label: string): string {
  if (!value.trim()) throw new AskScopeError(`Ask scope requires ${label}.`);
  return value;
}

function sameContact(left: ContactRef, right: ContactRef): boolean {
  return (
    left.kind === right.kind &&
    left.id === right.id &&
    left.matterId === right.matterId
  );
}

function validateContact(contact: ContactRef, matterId: string): void {
  required(contact.kind, 'a contact kind');
  required(contact.id, 'a contact id');
  if (contact.matterId !== matterId) {
    throw new AskScopeError(
      'Ask contact context must belong to the selected matter.'
    );
  }
}

function validateMeeting(meeting: MeetingRef): void {
  required(meeting.id, 'a meeting id');
  required(meeting.matterId, 'a meeting matter');
}

function validateScope(scope: AskScope): void {
  required(scope.workspaceId, 'a workspace boundary');
  switch (scope.kind) {
    case 'whole-firm':
      return;
    case 'current-client':
      required(scope.revision, 'a client revision');
      required(scope.matterId, 'a client matter');
      validateContact(scope.contactRef, scope.matterId);
      return;
    case 'chosen-sources':
      required(scope.matterId, 'a source matter');
      if (!scope.sourceIds.length || scope.sourceIds.some((id) => !id.trim())) {
        throw new AskScopeError(
          'Ask chosen-source scope requires stable source ids.'
        );
      }
      if (scope.contactRef) validateContact(scope.contactRef, scope.matterId);
      return;
    case 'single-meeting':
      validateMeeting(scope.meeting);
      return;
    case 'selected-meetings':
      if (!scope.meetings.length)
        throw new AskScopeError('Ask selected-meetings scope cannot be empty.');
      scope.meetings.forEach(validateMeeting);
      return;
    case 'meeting-range':
      required(scope.matterId, 'a meeting matter');
      required(scope.startsOn, 'a range start');
      required(scope.endsOn, 'a range end');
      if (scope.startsOn > scope.endsOn)
        throw new AskScopeError('Ask meeting range ends before it starts.');
      return;
  }
}

/** Resolve only structurally valid local scopes. Missing client context fails closed. */
export function resolveAskScope(
  scope: AskScope,
  currentClient: AskClientContext | null = null
): ResolvedAskScope {
  validateScope(scope);
  if (scope.kind === 'current-client') {
    if (
      !currentClient ||
      currentClient.revision !== scope.revision ||
      currentClient.matterId !== scope.matterId ||
      !sameContact(currentClient.contactRef, scope.contactRef)
    ) {
      throw new AskScopeError(
        'Ask current-client scope is stale or unavailable.'
      );
    }
  }
  return { ...scope, resolved: true };
}

/** A reference must remain in the resolved scope at use time, not just selection time. */
export function askSourceBelongsToScope(
  scope: ResolvedAskScope,
  source: AskSourceDescriptor
): boolean {
  if (source.workspaceId !== scope.workspaceId) return false;
  if (scope.kind === 'whole-firm') return true;
  if (scope.kind === 'current-client') {
    return (
      source.matterId === scope.matterId &&
      !!source.contactRef &&
      sameContact(source.contactRef, scope.contactRef)
    );
  }
  if (scope.kind === 'chosen-sources') {
    return (
      source.matterId === scope.matterId &&
      scope.sourceIds.includes(source.sourceId) &&
      (!scope.contactRef ||
        (!!source.contactRef &&
          sameContact(source.contactRef, scope.contactRef)))
    );
  }
  if (scope.kind === 'single-meeting') {
    return (
      source.kind === 'meeting-artifact' &&
      source.matterId === scope.meeting.matterId &&
      source.sourceId === scope.meeting.id
    );
  }
  if (scope.kind === 'selected-meetings') {
    return (
      source.kind === 'meeting-artifact' &&
      scope.meetings.some(
        (meeting) =>
          meeting.matterId === source.matterId && meeting.id === source.sourceId
      )
    );
  }
  return (
    source.kind === 'meeting-artifact' && source.matterId === scope.matterId
  );
}

export const askScopeBuilder: AskScopeBuilder = {
  wholeFirm: (workspaceId) => ({ workspaceId, kind: 'whole-firm' }),
  currentClient: (workspaceId, context) => {
    if (!context)
      throw new AskScopeError(
        'Ask current-client scope is unavailable without the shared client.'
      );
    return { workspaceId, kind: 'current-client', ...context };
  },
  chosenSources: (workspaceId, matterId, sourceIds, contactRef) => ({
    workspaceId,
    kind: 'chosen-sources',
    matterId,
    sourceIds,
    ...(contactRef ? { contactRef } : {}),
  }),
  singleMeeting: (workspaceId, meeting) => ({
    workspaceId,
    kind: 'single-meeting',
    meeting,
  }),
  selectedMeetings: (workspaceId, meetings) => ({
    workspaceId,
    kind: 'selected-meetings',
    meetings,
  }),
  meetingRange: (workspaceId, matterId, startsOn, endsOn, meetingTypes) => ({
    workspaceId,
    kind: 'meeting-range',
    matterId,
    startsOn,
    endsOn,
    ...(meetingTypes ? { meetingTypes } : {}),
  }),
};

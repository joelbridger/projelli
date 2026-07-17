import type {
  AskClientSnapshot,
  AskClientUseAccess,
  AskOwnerIdentityAdapter,
  AskScope,
  AskScopeBuilder,
  AskSourceDescriptor,
  ResolvedAskScope,
} from './contracts';
import { readOwnerBoundAccess } from './owner';

export class AskScopeError extends Error {}

function required(value: string, label: string): string {
  if (!value.trim()) throw new AskScopeError(`Ask scope requires ${label}.`);
  return value;
}

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

function sameClientSnapshot<ClientReference, MeetingReference>(
  left: AskClientSnapshot<ClientReference>,
  right: AskClientSnapshot<ClientReference>,
  owners: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): boolean {
  return (
    left.matterId === right.matterId &&
    left.revision === right.revision &&
    owners.sameClient(left.contactRef, right.contactRef)
  );
}

function validateClient<ClientReference, MeetingReference>(
  client: AskClientSnapshot<ClientReference>,
  owners: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): void {
  required(client.matterId, 'a client matter');
  required(client.revision, 'a client revision');
  if (!owners.isClientReference(client.contactRef)) {
    throw new AskScopeError(
      'Ask scope has an invalid owner contact reference.'
    );
  }
  if (owners.clientMatterId(client.contactRef) !== client.matterId) {
    throw new AskScopeError(
      'Ask contact context must belong to the selected matter.'
    );
  }
}

function validateScope<ClientReference, MeetingReference>(
  scope: AskScope<ClientReference, MeetingReference>,
  owners?: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): void {
  required(scope.workspaceId, 'a workspace boundary');
  if (scope.kind === 'whole-firm') return;
  if (!owners) {
    throw new AskScopeError(
      'Ask client scopes are unavailable until owner identity contracts are supplied.'
    );
  }
  validateClient(scope.client, owners);
  switch (scope.kind) {
    case 'current-client':
      return;
    case 'chosen-sources':
      if (!scope.sourceIds.length || scope.sourceIds.some((id) => !id.trim())) {
        throw new AskScopeError(
          'Ask chosen-source scope requires stable source ids.'
        );
      }
      return;
    case 'single-meeting':
      if (
        !owners.isMeetingReference(scope.meeting) ||
        !required(owners.meetingId(scope.meeting), 'a meeting id') ||
        owners.meetingMatterId(scope.meeting) !== scope.client.matterId
      ) {
        throw new AskScopeError(
          'Ask meeting scope must stay inside the selected client.'
        );
      }
      return;
    case 'selected-meetings':
      if (!scope.meetings.length) {
        throw new AskScopeError('Ask selected-meetings scope cannot be empty.');
      }
      if (
        scope.meetings.some(
          (meeting) =>
            !owners.isMeetingReference(meeting) ||
            !owners.meetingId(meeting).trim() ||
            owners.meetingMatterId(meeting) !== scope.client.matterId
        )
      ) {
        throw new AskScopeError(
          'Ask selected meetings must share one client boundary.'
        );
      }
      return;
    case 'meeting-range':
      if (!validDay(scope.startsOn) || !validDay(scope.endsOn)) {
        throw new AskScopeError(
          'Ask meeting range requires real calendar dates.'
        );
      }
      if (scope.startsOn > scope.endsOn) {
        throw new AskScopeError('Ask meeting range ends before it starts.');
      }
      if (scope.meetingTypes?.some((meetingType) => !meetingType.trim())) {
        throw new AskScopeError('Ask meeting types cannot be blank.');
      }
  }
}

/** Resolve only structurally valid scopes bound to the current shared client. */
export function resolveAskScope<ClientReference, MeetingReference>(
  scope: AskScope<ClientReference, MeetingReference>,
  currentClient: AskClientSnapshot<ClientReference> | null = null,
  owners?: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): ResolvedAskScope<ClientReference, MeetingReference> {
  validateScope(scope, owners);
  if (scope.kind !== 'whole-firm') {
    if (currentClient && owners) validateClient(currentClient, owners);
    if (
      !owners ||
      !currentClient ||
      !sameClientSnapshot(scope.client, currentClient, owners)
    ) {
      throw new AskScopeError('Ask client scope is stale or unavailable.');
    }
  }
  return { ...scope, resolved: true };
}

/**
 * The current shared client comes from the foundation-owned binding in
 * `./owner`, which an ordinary consumer cannot reach or replace. Every use-time
 * doorway reads through `liveAskAccess()`; there is no caller-supplied current
 * client to freeze, and no public way to set the reader. When no owner is
 * established (the current base), every client-scoped doorway fails closed.
 */
function liveAskAccess<ClientReference, MeetingReference>():
  | AskClientUseAccess<ClientReference, MeetingReference>
  | null {
  return readOwnerBoundAccess<ClientReference, MeetingReference>();
}

/** The owner identity adapter from the single binding, or null when unbound. */
export function readBoundAskOwners<ClientReference, MeetingReference>():
  | AskOwnerIdentityAdapter<ClientReference, MeetingReference>
  | null {
  return (
    liveAskAccess<ClientReference, MeetingReference>()?.owners ?? null
  );
}

/**
 * Re-read and validate the active shared client immediately before use, from
 * the single live binding. Fails closed when nothing is bound.
 */
export function assertAskScopeCurrent<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>
): void {
  if (scope.kind === 'whole-firm') {
    // A whole-firm scope is not client-scoped, so it needs no bound client;
    // just re-validate its workspace boundary.
    resolveAskScope(scope);
    return;
  }
  const access = liveAskAccess<ClientReference, MeetingReference>();
  if (!access || typeof access.readCurrentClient !== 'function') {
    throw new AskScopeError(
      'Ask shared-client owner is not bound; client-scoped state is unavailable.'
    );
  }
  let currentClient: AskClientSnapshot<ClientReference> | null;
  try {
    currentClient = access.readCurrentClient();
  } catch {
    throw new AskScopeError(
      'Ask could not read the current shared client at use time.'
    );
  }
  resolveAskScope(scope, currentClient, access.owners);
}

/** Boolean form for filtering doorways that must fail closed without data. */
export function askScopeIsCurrent<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>
): boolean {
  try {
    assertAskScopeCurrent(scope);
    return true;
  } catch {
    return false;
  }
}

function sameScopeSnapshot<ClientReference, MeetingReference>(
  left: AskScope<ClientReference, MeetingReference>,
  right: AskScope<ClientReference, MeetingReference>,
  owners: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): boolean {
  if (left.workspaceId !== right.workspaceId || left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'whole-firm' || right.kind === 'whole-firm') return true;
  if (!sameClientSnapshot(left.client, right.client, owners)) return false;
  if (left.kind === 'current-client' && right.kind === 'current-client') {
    return true;
  }
  if (left.kind === 'chosen-sources' && right.kind === 'chosen-sources') {
    return (
      left.sourceIds.length === right.sourceIds.length &&
      left.sourceIds.every((id, index) => id === right.sourceIds[index])
    );
  }
  if (left.kind === 'single-meeting' && right.kind === 'single-meeting') {
    return owners.sameMeeting(left.meeting, right.meeting);
  }
  if (left.kind === 'selected-meetings' && right.kind === 'selected-meetings') {
    return (
      left.meetings.length === right.meetings.length &&
      left.meetings.every((meeting, index) =>
        owners.sameMeeting(meeting, right.meetings[index] as MeetingReference)
      )
    );
  }
  if (left.kind === 'meeting-range' && right.kind === 'meeting-range') {
    const leftTypes = left.meetingTypes ?? [];
    const rightTypes = right.meetingTypes ?? [];
    return (
      left.startsOn === right.startsOn &&
      left.endsOn === right.endsOn &&
      leftTypes.length === rightTypes.length &&
      leftTypes.every((meetingType, index) => meetingType === rightTypes[index])
    );
  }
  return false;
}

/**
 * Pure membership: does the source sit inside this scope for these owners?
 *
 * This makes no currency decision. The reactive persistence store uses it with
 * its own reactive client/owners; the imperative doorway wraps it with the live
 * use-time client guard below.
 */
export function askSourceMembership<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  source: AskSourceDescriptor<ClientReference, MeetingReference>,
  owners: AskOwnerIdentityAdapter<ClientReference, MeetingReference>
): boolean {
  if (
    source.workspaceId !== scope.workspaceId ||
    !owners.isClientReference(source.client.contactRef) ||
    source.client.matterId !== owners.clientMatterId(source.client.contactRef)
  ) {
    return false;
  }
  if (scope.kind === 'whole-firm') return true;
  if (!sameClientSnapshot(scope.client, source.client, owners)) return false;
  if (scope.kind === 'current-client') return true;
  if (scope.kind === 'chosen-sources') {
    return scope.sourceIds.includes(source.sourceId);
  }
  if (source.kind !== 'meeting-artifact') return false;
  if (
    !owners.isMeetingReference(source.meeting) ||
    owners.meetingMatterId(source.meeting) !== scope.client.matterId
  ) {
    return false;
  }
  if (scope.kind === 'single-meeting') {
    return owners.sameMeeting(source.meeting, scope.meeting);
  }
  if (scope.kind === 'selected-meetings') {
    return scope.meetings.some((meeting) =>
      owners.sameMeeting(source.meeting, meeting)
    );
  }
  if (!validDay(source.occurredOn) || !source.meetingType.trim()) return false;
  return (
    source.occurredOn >= scope.startsOn &&
    source.occurredOn <= scope.endsOn &&
    (!scope.meetingTypes?.length ||
      scope.meetingTypes.includes(source.meetingType))
  );
}

/** A reference must remain in the resolved scope at the current live client. */
export function askSourceBelongsToScope<ClientReference, MeetingReference>(
  scope: ResolvedAskScope<ClientReference, MeetingReference>,
  source: AskSourceDescriptor<ClientReference, MeetingReference>
): boolean {
  if (!askScopeIsCurrent(scope)) return false;
  const owners = liveAskAccess<ClientReference, MeetingReference>()?.owners;
  if (!owners) return false;
  return askSourceMembership(scope, source, owners);
}

export { sameScopeSnapshot as askScopeSnapshotsMatch };

export const askScopeBuilder: AskScopeBuilder = {
  wholeFirm: (workspaceId) => ({ workspaceId, kind: 'whole-firm' }),
  currentClient: (workspaceId, client) => {
    if (!client) {
      throw new AskScopeError(
        'Ask current-client scope is unavailable without the shared client.'
      );
    }
    return { workspaceId, kind: 'current-client', client };
  },
  chosenSources: (workspaceId, client, sourceIds) => ({
    workspaceId,
    kind: 'chosen-sources',
    client,
    sourceIds,
  }),
  singleMeeting: (workspaceId, client, meeting) => ({
    workspaceId,
    kind: 'single-meeting',
    client,
    meeting,
  }),
  selectedMeetings: (workspaceId, client, meetings) => ({
    workspaceId,
    kind: 'selected-meetings',
    client,
    meetings,
  }),
  meetingRange: (workspaceId, client, startsOn, endsOn, meetingTypes) => ({
    workspaceId,
    kind: 'meeting-range',
    client,
    startsOn,
    endsOn,
    ...(meetingTypes ? { meetingTypes } : {}),
  }),
};

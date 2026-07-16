import type {
  AskClientUseAccess,
  AskOwnerIdentityAdapter,
} from '@/features/ask';

export interface FixtureClientRef {
  readonly owner: 'fixture-client-owner';
  readonly id: string;
  readonly matterId: string;
}

export interface FixtureMeetingRef {
  readonly owner: 'fixture-meeting-owner';
  readonly id: string;
  readonly matterId: string;
}

export const fixtureClient = {
  contactRef: {
    owner: 'fixture-client-owner',
    id: 'client-1',
    matterId: 'matter-1',
  },
  matterId: 'matter-1',
  revision: 'client-1:1',
} as const;

export const fixtureMeeting = {
  owner: 'fixture-meeting-owner',
  id: 'meeting-1',
  matterId: 'matter-1',
} as const;

export const fixtureOwners: AskOwnerIdentityAdapter<
  FixtureClientRef,
  FixtureMeetingRef
> = {
  isClientReference: (value): value is FixtureClientRef =>
    !!value &&
    typeof value === 'object' &&
    'owner' in value &&
    value.owner === 'fixture-client-owner',
  clientMatterId: (reference) => reference.matterId,
  sameClient: (left, right) =>
    left.id === right.id && left.matterId === right.matterId,
  isMeetingReference: (value): value is FixtureMeetingRef =>
    !!value &&
    typeof value === 'object' &&
    'owner' in value &&
    value.owner === 'fixture-meeting-owner',
  meetingId: (reference) => reference.id,
  meetingMatterId: (reference) => reference.matterId,
  sameMeeting: (left, right) =>
    left.id === right.id && left.matterId === right.matterId,
};

export const fixtureAccess: AskClientUseAccess<
  FixtureClientRef,
  FixtureMeetingRef
> = {
  readCurrentClient: () => fixtureClient,
  owners: fixtureOwners,
};

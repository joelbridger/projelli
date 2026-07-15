import { describe, expect, it } from 'vitest';
import { SYSTEM_ROLES, type TeamsRolesState } from '@/features/crm-firm/teams-roles';
import { filterOwnClientRecords } from './ownClientsOnly';

const teamsRoles: TeamsRolesState = {
  roles: SYSTEM_ROLES,
  teams: [],
  memberships: [
    { memberId: 'maya', roleId: 'advisor', teamIds: [] },
    { memberId: 'compliance', roleId: 'compliance-admin', teamIds: [] },
  ],
  updatedAt: '2026-07-15T00:00:00.000Z',
};

const records = [
  { id: 'owned', kind: 'household', ownerMemberId: 'maya' },
  { id: 'assigned', kind: 'household', assignedMemberIds: ['maya'] },
  { id: 'other', kind: 'household', ownerMemberId: 'noah' },
  { id: 'label-only', kind: 'household', primaryAdvisor: 'Maya' },
];

describe('own-clients-only display mirror', () => {
  it('shows only owned or assigned households to an assigned-scope advisor', () => {
    expect(
      filterOwnClientRecords(records, {
        memberId: 'maya',
        teamsRoles,
        operation: 'read',
      }).map((record) => record.id)
    ).toEqual(['owned', 'assigned']);
  });

  it('shows all households to a firm-wide reader', () => {
    expect(
      filterOwnClientRecords(records, {
        memberId: 'compliance',
        teamsRoles,
        operation: 'read',
      }).map((record) => record.id)
    ).toEqual(['owned', 'assigned', 'other', 'label-only']);
  });
});

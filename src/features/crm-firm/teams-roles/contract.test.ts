import { describe, expect, it } from 'vitest';
import {
  emptyTeamsRolesState,
  resolveMemberAccess,
  roleForMember,
  SYSTEM_ROLES,
} from './contract';

describe('teams and roles contract', () => {
  it('keeps the four frozen system roles and explicit client scopes', () => {
    expect(SYSTEM_ROLES.map((role) => [role.id, role.clientAccess])).toEqual([
      ['advisor', 'assigned'],
      ['client-service', 'assigned'],
      ['compliance-admin', 'firm-read'],
      ['guest-planner', 'shared'],
    ]);
  });
  it('resolves a member role without inferring from a display label', () => {
    const state = {
      ...emptyTeamsRolesState(),
      memberships: [
        {
          memberId: 'm-1',
          roleId: 'guest-planner' as const,
          teamIds: ['team-1'],
        },
      ],
    };
    expect(roleForMember(state, 'm-1')?.clientAccess).toBe('shared');
  });
  it('keeps team membership separate from the role that grants access', () => {
    const state = {
      ...emptyTeamsRolesState(),
      memberships: [
        { memberId: 'm-1', roleId: 'advisor' as const, teamIds: ['planning'] },
      ],
    };
    expect(resolveMemberAccess(state, 'm-1')).toEqual(
      expect.objectContaining({
        memberId: 'm-1',
        teamIds: ['planning'],
        role: expect.objectContaining({ clientAccess: 'assigned' }),
      })
    );
  });
});

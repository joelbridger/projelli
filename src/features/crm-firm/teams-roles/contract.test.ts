import { describe, expect, it } from 'vitest';
import {
  resolveMemberAccess,
  roleForMember,
  SYSTEM_ROLE_PERMISSIONS,
} from './contract';

describe('teams and roles contract', () => {
  it('keeps the four frozen system roles and explicit client scopes', () => {
    expect(
      SYSTEM_ROLE_PERMISSIONS.map((role) => [role.id, role.clientAccess])
    ).toEqual([
      ['advisor', 'assigned'],
      ['client-service', 'assigned'],
      ['compliance-admin', 'firm-read'],
      ['guest-planner', 'shared'],
    ]);
  });
  it('resolves a member role without inferring from a display label', () => {
    const memberships = [
      {
        memberId: 'm-1',
        roleId: 'guest-planner' as const,
        teamIds: ['team-1'],
      },
    ];
    expect(
      roleForMember(SYSTEM_ROLE_PERMISSIONS, memberships, 'm-1')?.clientAccess
    ).toBe('shared');
  });
  it('keeps team membership separate from the role that grants access', () => {
    const memberships = [
      { memberId: 'm-1', roleId: 'advisor' as const, teamIds: ['planning'] },
    ];
    const access = resolveMemberAccess(
      SYSTEM_ROLE_PERMISSIONS,
      memberships,
      'm-1'
    );
    expect(access.memberId).toBe('m-1');
    expect(access.teamIds).toEqual(['planning']);
    expect(access.role?.clientAccess).toBe('assigned');
  });
});

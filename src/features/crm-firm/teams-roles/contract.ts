/**
 * Frozen teams-and-roles contract consumed by firm features.
 *
 * `own-clients-permissions` must import this type and resolve a member's
 * `clientAccess` from the assigned role. It must not create a second role
 * vocabulary or infer access from a display label. This is intentionally
 * narrow: names, descriptions, and system bookkeeping stay internal to the
 * Teams & Roles feature.
 */
export type SystemRoleId =
  | 'advisor'
  | 'client-service'
  | 'compliance-admin'
  | 'guest-planner';
export type RoleId = SystemRoleId | (string & {});
export type ClientAccessScope = 'assigned' | 'shared' | 'firm-read' | 'none';
export type CapabilityId =
  | 'clients:read'
  | 'clients:write'
  | 'ask:use'
  | 'meetings:read'
  | 'meetings:write'
  | 'tasks:manage'
  | 'workflows:manage'
  | 'reports:read'
  | 'exports:run'
  | 'audit:read'
  | 'retention:manage'
  | 'firm:manage';

export interface RoleDefinition {
  id: RoleId;
  capabilities: readonly CapabilityId[];
  clientAccess: ClientAccessScope;
}

/** A member has exactly one primary role and may belong to many teams. */
export interface MemberAssignment {
  memberId: string;
  roleId: RoleId;
  teamIds: readonly string[];
}

/**
 * Frozen read contract for `own-clients-permissions` and later consumers.
 *
 * Read a person's assignment with `roleForMember`, then enforce
 * `role.clientAccess` and the named capability.  A team is an organizational
 * grouping only; it never grants client access by itself.  This keeps a team
 * assignment from accidentally becoming a permissions bypass.
 */
export interface ResolvedMemberAccess {
  memberId: string;
  role: RoleDefinition | undefined;
  teamIds: readonly string[];
}

export const SYSTEM_ROLE_PERMISSIONS: readonly RoleDefinition[] = [
  {
    id: 'advisor',
    clientAccess: 'assigned',
    capabilities: [
      'clients:read',
      'clients:write',
      'ask:use',
      'meetings:read',
      'meetings:write',
      'reports:read',
    ],
  },
  {
    id: 'client-service',
    clientAccess: 'assigned',
    capabilities: [
      'clients:read',
      'clients:write',
      'tasks:manage',
      'workflows:manage',
      'meetings:read',
      'meetings:write',
    ],
  },
  {
    id: 'compliance-admin',
    clientAccess: 'firm-read',
    capabilities: [
      'clients:read',
      'reports:read',
      'exports:run',
      'audit:read',
      'retention:manage',
      'firm:manage',
    ],
  },
  {
    id: 'guest-planner',
    clientAccess: 'shared',
    capabilities: ['clients:read', 'ask:use', 'meetings:read'],
  },
] as const;

export function roleForMember(
  roles: readonly RoleDefinition[],
  memberships: readonly MemberAssignment[],
  memberId: string
): RoleDefinition | undefined {
  const membership = memberships.find((item) => item.memberId === memberId);
  return membership
    ? roles.find((role) => role.id === membership.roleId)
    : undefined;
}

export function resolveMemberAccess(
  roles: readonly RoleDefinition[],
  memberships: readonly MemberAssignment[],
  memberId: string
): ResolvedMemberAccess {
  const assignment = memberships.find((item) => item.memberId === memberId);
  return {
    memberId,
    role: roleForMember(roles, memberships, memberId),
    teamIds: assignment?.teamIds ?? [],
  };
}

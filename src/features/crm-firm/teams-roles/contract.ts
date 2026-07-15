/**
 * Frozen teams-and-roles contract consumed by firm features.
 *
 * `own-clients-permissions` must import these types and resolve a member's
 * `clientAccess` from the assigned role. It must not create a second role
 * vocabulary or infer access from a display label.
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
  name: string;
  description: string;
  clientAccess: ClientAccessScope;
  capabilities: readonly CapabilityId[];
  system: boolean;
}

export interface TeamDefinition {
  id: string;
  name: string;
  description?: string;
}

/** A member has exactly one primary role and may belong to many teams. */
export interface MemberAssignment {
  memberId: string;
  roleId: RoleId;
  teamIds: readonly string[];
}

export interface TeamsRolesState {
  roles: readonly RoleDefinition[];
  teams: readonly TeamDefinition[];
  memberships: readonly MemberAssignment[];
  updatedAt: string;
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

export const SYSTEM_ROLES: readonly RoleDefinition[] = [
  {
    id: 'advisor',
    name: 'Advisors',
    description: 'Assigned clients, Ask, meetings, and reports.',
    clientAccess: 'assigned',
    capabilities: [
      'clients:read',
      'clients:write',
      'ask:use',
      'meetings:read',
      'meetings:write',
      'reports:read',
    ],
    system: true,
  },
  {
    id: 'client-service',
    name: 'Client service',
    description: 'Assigned households, tasks, workflows, and meetings.',
    clientAccess: 'assigned',
    capabilities: [
      'clients:read',
      'clients:write',
      'tasks:manage',
      'workflows:manage',
      'meetings:read',
      'meetings:write',
    ],
    system: true,
  },
  {
    id: 'compliance-admin',
    name: 'Compliance admin',
    description: 'Firm-wide read access, exports, retention, and audit.',
    clientAccess: 'firm-read',
    capabilities: [
      'clients:read',
      'reports:read',
      'exports:run',
      'audit:read',
      'retention:manage',
      'firm:manage',
    ],
    system: true,
  },
  {
    id: 'guest-planner',
    name: 'Guest planner',
    description:
      'Only households shared directly with this planner. No exports.',
    clientAccess: 'shared',
    capabilities: ['clients:read', 'ask:use', 'meetings:read'],
    system: true,
  },
] as const;

export function emptyTeamsRolesState(): TeamsRolesState {
  return {
    roles: SYSTEM_ROLES,
    teams: [],
    memberships: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function roleForMember(
  state: TeamsRolesState,
  memberId: string
): RoleDefinition | undefined {
  const membership = state.memberships.find(
    (item) => item.memberId === memberId
  );
  return membership
    ? state.roles.find((role) => role.id === membership.roleId)
    : undefined;
}

export function resolveMemberAccess(
  state: TeamsRolesState,
  memberId: string
): ResolvedMemberAccess {
  const assignment = state.memberships.find(
    (item) => item.memberId === memberId
  );
  return {
    memberId,
    role: roleForMember(state, memberId),
    teamIds: assignment?.teamIds ?? [],
  };
}

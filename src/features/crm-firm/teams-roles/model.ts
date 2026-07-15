import {
  SYSTEM_ROLE_PERMISSIONS,
  type MemberAssignment,
  type RoleDefinition,
} from './contract';

/** Feature-private role details used only to manage the Organization screen. */
export interface ManagedRole extends RoleDefinition {
  name: string;
  description: string;
  system: boolean;
}

export interface TeamDefinition {
  id: string;
  name: string;
  description?: string;
}

export interface TeamsRolesState {
  roles: readonly ManagedRole[];
  teams: readonly TeamDefinition[];
  memberships: readonly MemberAssignment[];
  updatedAt: string;
}

const ROLE_COPY: Readonly<
  Record<string, Pick<ManagedRole, 'name' | 'description'>>
> = {
  advisor: {
    name: 'Advisors',
    description: 'Assigned clients, Ask, meetings, and reports.',
  },
  'client-service': {
    name: 'Client service',
    description: 'Assigned households, tasks, workflows, and meetings.',
  },
  'compliance-admin': {
    name: 'Compliance admin',
    description: 'Firm-wide read access, exports, retention, and audit.',
  },
  'guest-planner': {
    name: 'Guest planner',
    description:
      'Only households shared directly with this planner. No exports.',
  },
};

export const SYSTEM_ROLES: readonly ManagedRole[] = SYSTEM_ROLE_PERMISSIONS.map(
  (role) => {
    const copy = ROLE_COPY[role.id];
    if (copy === undefined) {
      throw new Error(`Missing management copy for system role ${role.id}`);
    }
    return { ...role, ...copy, system: true };
  }
);

export function emptyTeamsRolesState(): TeamsRolesState {
  return {
    roles: SYSTEM_ROLES,
    teams: [],
    memberships: [],
    updatedAt: new Date(0).toISOString(),
  };
}

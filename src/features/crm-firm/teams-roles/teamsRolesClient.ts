import { invoke, isTauri } from '@tauri-apps/api/core';
import type { MemberAssignment } from './contract';
import type { ManagedRole, TeamDefinition, TeamsRolesState } from './model';

function nativeOnly<T>(
  command: string,
  payload?: Record<string, unknown>
): Promise<T> {
  if (!isTauri())
    return Promise.reject(
      new Error('Teams and roles can only be changed in the desktop app.')
    );
  return invoke<T>(command, payload);
}

export const teamsRolesClient = {
  get: () => nativeOnly<TeamsRolesState>('crm_teams_roles_get'),
  createRole: (role: ManagedRole) =>
    nativeOnly<TeamsRolesState>('crm_teams_roles_create_role', { role }),
  updateRole: (role: ManagedRole) =>
    nativeOnly<TeamsRolesState>('crm_teams_roles_update_role', { role }),
  deleteRole: (roleId: string) =>
    nativeOnly<TeamsRolesState>('crm_teams_roles_delete_role', { roleId }),
  createTeam: (team: TeamDefinition) =>
    nativeOnly<TeamsRolesState>('crm_teams_roles_create_team', { team }),
  updateTeam: (team: TeamDefinition) =>
    nativeOnly<TeamsRolesState>('crm_teams_roles_update_team', { team }),
  deleteTeam: (teamId: string) =>
    nativeOnly<TeamsRolesState>('crm_teams_roles_delete_team', { teamId }),
  assignMember: (assignment: MemberAssignment) =>
    nativeOnly<TeamsRolesState>('crm_teams_roles_assign_member', {
      assignment,
    }),
};

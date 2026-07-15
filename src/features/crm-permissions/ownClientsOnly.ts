import type {
  MemberAssignment,
  RoleDefinition,
  TeamsRolesState,
} from '@/features/crm-firm/teams-roles';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  ownClientsOnlyPolicy,
  type PermissionOperation,
} from './registry/permissionPolicyRegistry';

export interface OwnClientsContext {
  memberId: string;
  teamsRoles: Pick<TeamsRolesState, 'roles' | 'memberships'>;
  operation: PermissionOperation;
}

function roleForMember(
  roles: readonly RoleDefinition[],
  memberships: readonly MemberAssignment[],
  memberId: string
): RoleDefinition | undefined {
  const membership = memberships.find((item) => item.memberId === memberId);
  return membership
    ? roles.find((role) => role.id === membership.roleId)
    : undefined;
}

/** Display mirror for the native authority rule. */
export function filterOwnClientRecords(
  records: readonly LiveCrmRecord[],
  context: OwnClientsContext
): readonly LiveCrmRecord[] {
  return ownClientsOnlyPolicy.filterRecords(records, {
    memberId: context.memberId,
    role: roleForMember(
      context.teamsRoles.roles,
      context.teamsRoles.memberships,
      context.memberId
    ),
    operation: context.operation,
  });
}

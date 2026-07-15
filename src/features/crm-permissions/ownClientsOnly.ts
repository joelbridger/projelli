import type { RoleDefinition } from '@/features/crm-firm/teams-roles';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { isEnabled } from '@/platform/flags/router';
import {
  ownClientsOnlyPolicy,
  type PermissionOperation,
} from './registry/permissionPolicyRegistry';

export interface OwnClientsContext {
  memberId: string;
  /** Resolved by the frozen teams-and-roles doorway before this policy runs. */
  role:
    | Pick<RoleDefinition, 'id' | 'clientAccess' | 'capabilities'>
    | undefined;
  operation: PermissionOperation;
}

/** Display mirror for the native authority rule. */
export function filterOwnClientRecords(
  records: readonly LiveCrmRecord[],
  context: OwnClientsContext
): readonly LiveCrmRecord[] {
  if (!isEnabled('own-clients-permissions')) return records;
  return ownClientsOnlyPolicy.filterRecords(records, {
    memberId: context.memberId,
    role: context.role,
    operation: context.operation,
  });
}

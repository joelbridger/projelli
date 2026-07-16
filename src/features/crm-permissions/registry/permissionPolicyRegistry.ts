import type {
  ClientAccessScope,
  RoleDefinition,
} from '@/features/crm-firm/teams-roles';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

export type PermissionOperation = 'read' | 'write';

export interface PermissionPolicyContext {
  memberId: string;
  /**
   * The complete frozen role surface this policy may consume. Do not widen
   * this to display or management fields from teams-and-roles.
   */
  role:
    | Pick<RoleDefinition, 'id' | 'clientAccess' | 'capabilities'>
    | undefined;
  operation: PermissionOperation;
}

export interface PermissionPolicyDescriptor {
  /** Stable kebab-case policy identifier. Never reuse an id. */
  id: string;
  name: string;
  description: string;
  /** Native enforcement is authoritative; this mirror protects display paths. */
  authority: string;
  filterRecords(
    records: readonly LiveCrmRecord[],
    context: PermissionPolicyContext
  ): readonly LiveCrmRecord[];
  permitsRecord(
    record: LiveCrmRecord,
    context: PermissionPolicyContext
  ): boolean;
}

function isStableId(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function requiredText(value: string, field: string, policyId: string): void {
  if (!value.trim())
    throw new Error(`Permission policy ${policyId} requires ${field}.`);
}

/**
 * Validates an append-only policy registry before consumers can use it.
 * Keep this exported so future policy lanes get the same duplicate-id gate.
 */
export function validatePermissionPolicyRegistry(
  policies: readonly PermissionPolicyDescriptor[]
): void {
  const ids = new Set<string>();
  for (const policy of policies) {
    requiredText(policy.id, 'an id', policy.id || '(missing id)');
    if (!isStableId(policy.id))
      throw new Error(`Permission policy id is invalid: ${policy.id}.`);
    if (ids.has(policy.id))
      throw new Error(`Duplicate permission policy id: ${policy.id}.`);
    ids.add(policy.id);
    requiredText(policy.name, 'a name', policy.id);
    requiredText(policy.description, 'a description', policy.id);
    if (policy.authority !== 'native-command-layer')
      throw new Error(
        `Permission policy ${policy.id} must name native-command-layer as authority.`
      );
    if (typeof policy.filterRecords !== 'function')
      throw new Error(`Permission policy ${policy.id} requires filterRecords.`);
    if (typeof policy.permitsRecord !== 'function')
      throw new Error(`Permission policy ${policy.id} requires permitsRecord.`);
  }
}

function hasClientCapability(
  role: Pick<RoleDefinition, 'capabilities'> | undefined,
  operation: PermissionOperation
): boolean {
  return role?.capabilities.includes(`clients:${operation}`) ?? false;
}

function memberIdList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter(
        (memberId): memberId is string =>
          typeof memberId === 'string' && memberId.trim().length > 0
      )
    : [];
}

/**
 * Only durable member ids count here. In particular, `primaryAdvisor` is
 * display copy in the legacy CRM surface and must never authorize access.
 */
function recordAssignment(record: LiveCrmRecord) {
  return {
    ownerMemberId:
      typeof record['ownerMemberId'] === 'string' &&
      record['ownerMemberId'].trim()
        ? record['ownerMemberId']
        : undefined,
    assignedMemberIds: memberIdList(record['assignedMemberIds']),
  };
}

function permitsClientScope(
  scope: ClientAccessScope | undefined,
  record: LiveCrmRecord,
  memberId: string
): boolean {
  if (scope === 'firm-read') return true;
  if (!memberId.trim() || scope === 'none' || !scope) return false;
  const assignment = recordAssignment(record);
  if (scope === 'shared')
    return assignment.assignedMemberIds.includes(memberId);
  return (
    assignment.ownerMemberId === memberId ||
    assignment.assignedMemberIds.includes(memberId)
  );
}

export const ownClientsOnlyPolicy: PermissionPolicyDescriptor = {
  id: 'own-clients-only',
  name: 'Own clients only',
  description:
    'Allows client records only for a member who owns or is explicitly assigned to the household, unless the role has firm-wide read scope.',
  authority: 'native-command-layer',
  permitsRecord(record, context) {
    return (
      hasClientCapability(context.role, context.operation) &&
      permitsClientScope(context.role?.clientAccess, record, context.memberId)
    );
  },
  filterRecords(records, context) {
    return records.filter((record) => this.permitsRecord(record, context));
  },
};

/** Append new policies here. Keep existing entries ordered and unchanged. */
export const permissionPolicyRegistry = [ownClientsOnlyPolicy] as const;

validatePermissionPolicyRegistry(permissionPolicyRegistry);

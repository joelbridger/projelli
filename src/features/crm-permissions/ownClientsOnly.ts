import type { RoleDefinition } from '@/features/crm-firm/teams-roles';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
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

/**
 * Display mirror for the native authority rule.
 *
 * SECURITY (re-review B Finding 6): whether to filter is decided by the
 * NATIVE-resolved enforcement state, which the caller MUST obtain from
 * `permissionsClient.enforcementActive()` — the single source of truth (item 6) —
 * and pass in as `enforcementActive`. The mirror deliberately does NOT read the
 * renderer feature flag: a renderer flag must never decide a security-visible
 * state, or the UI could show clients as isolated ("protected") while the native
 * layer has enforcement OFF (a doorway is unguarded, or the native flag is
 * absent) — the FE-on / native-off desync. Native enforcement is authoritative
 * regardless of this function; the mirror only reflects what native already
 * applies, so it must reflect native's answer, not the renderer's.
 */
export function filterOwnClientRecords(
  records: readonly LiveCrmRecord[],
  context: OwnClientsContext,
  enforcementActive: boolean
): readonly LiveCrmRecord[] {
  if (!enforcementActive) return records;
  return ownClientsOnlyPolicy.filterRecords(records, {
    memberId: context.memberId,
    role: context.role,
    operation: context.operation,
  });
}

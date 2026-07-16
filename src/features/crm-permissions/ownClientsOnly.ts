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
 * The single source of truth for whether native own-clients enforcement is
 * active — the value a consumer MUST pass to the display mirrors below, and
 * MUST NOT derive from the renderer feature flag (re-review Finding 6: a
 * renderer flag deciding a security-visible state is the FE-on / native-off
 * desync, where the UI claims clients are isolated while the native layer has
 * enforcement off).
 *
 * DEFERRED-ENFORCEMENT STUB: the native enforcement engine is NOT present in
 * this build, so enforcement is definitionally inactive and this resolves
 * `false` unconditionally. This is the browser-safe half of the eventual
 * native-resolved read; when the enforcement engine lands, that lane replaces
 * this body with the native interlock (`crm_permissions_enforcement_active`)
 * without changing this signature or any consumer call site. Consuming features
 * stay flag-off until then — a dark mirror returns every record, so a live
 * consumer would show unscoped data.
 */
export function ownClientsEnforcementActive(): Promise<boolean> {
  return Promise.resolve(false);
}

/**
 * Display mirror for the native authority rule — batch form.
 *
 * SECURITY (re-review Finding 6): whether to filter is decided by the
 * NATIVE-resolved enforcement state, which the caller MUST obtain from
 * `ownClientsEnforcementActive()` — the single source of truth — and pass in as
 * `enforcementActive`. The mirror deliberately does NOT read the renderer
 * feature flag: a renderer flag must never decide a security-visible state, or
 * the UI could show clients as isolated ("protected") while the native layer
 * has enforcement OFF — the FE-on / native-off desync. Native enforcement is
 * authoritative regardless of this function; the mirror only reflects what
 * native already applies, so it must reflect native's answer, not the
 * renderer's.
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

/**
 * Display mirror for the native authority rule — single-record form. This is
 * the predicate the merge / permission-validation consumers use to ask "may
 * this member see or act on THIS household?" (e.g. refusing a merge across a
 * household the member cannot access). It is gated by the same native-resolved
 * `enforcementActive` as the batch mirror: while enforcement is inactive it
 * permits every record (today's unscoped behavior), so it never blocks a dark
 * consumer, and — like the batch mirror — it must reflect native's answer, not
 * the renderer's feature flag.
 */
export function permitsOwnClientRecord(
  record: LiveCrmRecord,
  context: OwnClientsContext,
  enforcementActive: boolean
): boolean {
  if (!enforcementActive) return true;
  return ownClientsOnlyPolicy.permitsRecord(record, {
    memberId: context.memberId,
    role: context.role,
    operation: context.operation,
  });
}

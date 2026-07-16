/**
 * Public read-side permission doorway.
 *
 * This is the pure front-end policy contract that permission/visibility
 * features consume to scope what a member sees. It carries NO security
 * guarantee: native enforcement is authoritative and is deferred (see
 * `registry/SKILL.md`). The mirrors are inert until `ownClientsEnforcementActive`
 * reports active, so every consuming feature must stay flag-off until the
 * native enforcement engine lands and is proven on. The native permissions
 * client (`getCurrentMember` / data RPCs) intentionally ships WITH that engine,
 * not here.
 */
export {
  filterOwnClientRecords,
  permitsOwnClientRecord,
  ownClientsEnforcementActive,
} from './ownClientsOnly';
export type { OwnClientsContext } from './ownClientsOnly';
export {
  ownClientsOnlyPolicy,
  permissionPolicyRegistry,
  validatePermissionPolicyRegistry,
} from './registry/permissionPolicyRegistry';
export type {
  PermissionOperation,
  PermissionPolicyContext,
  PermissionPolicyDescriptor,
} from './registry/permissionPolicyRegistry';

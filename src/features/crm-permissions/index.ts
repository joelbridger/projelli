export { filterOwnClientRecords } from './ownClientsOnly';
export { permissionsClient } from './permissionsClient';
export type { CurrentMember } from './permissionsClient';
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

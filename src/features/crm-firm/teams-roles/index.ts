/**
 * Public Teams & Roles doorway.
 *
 * Downstream features, including own-clients-permissions, import the frozen
 * contract from here. They must not reach into this feature's implementation
 * files or create a second roles vocabulary.
 */
export {
  SYSTEM_ROLES,
  emptyTeamsRolesState,
  resolveMemberAccess,
  roleForMember,
} from './contract';
export type {
  CapabilityId,
  ClientAccessScope,
  MemberAssignment,
  ResolvedMemberAccess,
  RoleDefinition,
  RoleId,
  SystemRoleId,
  TeamDefinition,
  TeamsRolesState,
} from './contract';
export { teamsRolesSettingsModule } from './settingsModule';

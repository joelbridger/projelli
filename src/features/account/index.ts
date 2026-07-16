export type {
  AccountSectionDescriptor,
  AccountSectionRenderProps,
} from './accountRegistryTypes';
export type {
  ConnectionCardDescriptor,
  ConnectionCardPlacement,
} from '@/platform/types/account';

/**
 * Canonical Account connection-card doorway for feature consumers.
 *
 * Use each returned descriptor's `renderStatus()` for its connector-owned
 * status UI and `renderSafeDisconnect()` for its connector-owned safe
 * disconnect UI. This doorway exposes neither credentials nor mutable
 * registry access, raw connector modules, or a synthetic disconnect action.
 */
export { getConnectionCardDescriptors } from './connectionCardRegistry';

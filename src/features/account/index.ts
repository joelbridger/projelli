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
 * Use each descriptor's `isConnected()` as the truth gate, then mount its one
 * connector-owned `render()` surface for status and safe disconnect controls.
 * This doorway exposes neither credentials nor mutable
 * registry access, raw connector modules, or a synthetic disconnect action.
 */
export { getConnectionCardDescriptors } from './connectionCardRegistry';

// React Hooks
// Custom hooks for the application

export {
  useDragDrop,
  type DragItem,
  type DropTarget,
  type UseDragDropOptions,
  type UseDragDropReturn,
} from './useDragDrop';

export {
  useKeyboardShortcuts,
  formatShortcut,
  DEFAULT_SHORTCUTS,
  type KeyboardShortcut,
  type UseKeyboardShortcutsOptions,
} from './useKeyboardShortcuts';

export {
  useLicense,
  tierHasFeature,
  hasPack,
  type LicenseTier,
  type LicenseState,
  type ProfessionPack,
} from './useLicense';

export {
  useTrial,
  useTrialGate,
  type TrialState,
} from './useTrial';

export { useEntitlement } from './useEntitlement';

export {
  decideEntitlement,
  isGrandfatheredLicense,
  entitlementMessage,
  type Entitlement,
  type EntitlementState,
  type LicenseRecord,
} from '@/platform/licensing';

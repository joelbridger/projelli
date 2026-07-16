/**
 * Public doorway for reusable firm tags.
 *
 * Other feature lanes must import only from `@/features/crm-tags`. React
 * surfaces use `useFirmTagStore()` so their catalog always comes from the
 * current canonical live-record snapshot. The public contract intentionally
 * contains just tag identity, current display data, lifecycle state, and
 * catalog administration operations. Every `FirmTagStore` method is async
 * because tags use the canonical encrypted CRM record store. Consumers must
 * save only tag IDs and await reads or updates; storage details, timestamps,
 * parsing, and UI details remain private implementation choices.
 * Contract changes require a COORDINATOR decision before dependents adopt them.
 */
export { useFirmTagStore } from './useFirmTagStore';
export {
  type CreateFirmTagInput,
  type FirmTag,
  type FirmTagCatalog,
  type FirmTagColor,
  type FirmTagErrorCode,
  type FirmTagStatus,
  type FirmTagStore,
  FirmTagError,
} from './contract';
export { universalTagsSettingsPanel } from './settingsModuleDescriptor';

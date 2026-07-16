/**
 * Public doorway for reusable firm tags.
 *
 * Other feature lanes must import only from `@/features/crm-tags`. The public
 * contract intentionally contains just tag identity, current display data,
 * lifecycle state, and the catalog administration operations. Storage keys,
 * timestamps, parsing, and UI details are private implementation choices.
 * Contract changes require a COORDINATOR decision before dependents adopt them.
 */
export { createFirmTagStore } from './tagCatalog';
export {
  type CreateFirmTagInput,
  type FirmTag,
  type FirmTagCatalog,
  type FirmTagColor,
  type FirmTagStatus,
  type FirmTagStore,
} from './contract';
export { universalTagsSettingsPanel } from './settingsModuleDescriptor';

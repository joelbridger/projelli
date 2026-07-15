/** Public contact-source doorway for later directory/contact writers. */
export {
  createContactSourceReference,
  type ContactSource,
  type ContactSourceCatalog,
  type ContactSourceReference,
  type ContactSourceStatus,
} from './contract';
export {
  CONTACT_SOURCES_STORAGE_KEY,
  createContactSourceCatalogStore,
  parseContactSourceCatalog,
  type ContactSourceCatalogStore,
} from './catalog';
export { contactSourcesSettingsPanel } from './settingsModuleDescriptor';

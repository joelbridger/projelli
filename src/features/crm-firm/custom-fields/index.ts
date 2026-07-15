/** Public contract and Organization settings descriptor for firm custom fields. */
export {
  defineField,
  renameField,
  reorderFields,
  retireField,
  validateFieldCatalog,
  validateFieldCatalogField,
} from './fieldCatalog';
export type {
  CustomFieldAppliesTo,
  CustomFieldKind,
  FieldCatalog,
  FieldCatalogDraft,
  FieldCatalogField,
} from './fieldCatalog';
export {
  createLiveFieldCatalogPersistence,
  type FieldCatalogPersistence,
  type LiveFieldCatalogStore,
} from './fieldCatalogPersistence';
export { customFieldsSettingsModule } from './settingsModuleDescriptor';

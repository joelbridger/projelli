// Public CRM-firm doorway. Feature consumers must cross this boundary instead
// of importing a private CRM-firm implementation path.
export { teamsRolesSettingsModule } from './teams-roles';
export { customFieldsSettingsModule } from './custom-fields';
export { contactSourcesSettingsPanel } from './contact-sources';
export {
  createLiveFieldCatalogPersistence,
  defineField,
  renameField,
  reorderFields,
  retireField,
  validateFieldCatalog,
  validateFieldCatalogField,
} from './custom-fields';
export type {
  CustomFieldAppliesTo,
  CustomFieldKind,
  FieldCatalog,
  FieldCatalogDraft,
  FieldCatalogField,
  FieldCatalogPersistence,
  LiveFieldCatalogStore,
} from './custom-fields';

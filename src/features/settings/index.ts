export { ApiKeySettings } from './ApiKeySettings';
export { LicenseSettings } from './LicenseSettings';
export { McpApprovalModal } from './McpApprovalModal';
export { McpSettingsSection } from './McpSettingsSection';
export { OllamaSettingsSection } from './OllamaSettingsSection';
export { SettingsModal } from './SettingsModal';
export { VoiceSettingsSection } from './VoiceSettingsSection';
export { SettingsV1Surface } from './v1-frame';
// Feature settings modules use this small public doorway rather than reaching
// into Settings internals. It keeps the registry contract stable for lanes
// that mount a Settings section.
export {
  registerSettingsSectionRenderer,
  renderRegisteredSettingsPanels,
} from './registry/sectionRendererBindings';
export {
  settingsModuleRegistry,
  validateSettingsModuleDescriptors,
} from './registry/settingsModuleRegistry';
export type { SettingsModuleDescriptor } from './registry/settingsModuleRegistry';
export type {
  SettingsPanelDescriptor,
  SettingsSectionRenderProps,
} from './registry/types';

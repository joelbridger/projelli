export { ApiKeySettings } from './ApiKeySettings';
export { LicenseSettings } from './LicenseSettings';
export { McpApprovalModal } from './McpApprovalModal';
export { McpSettingsSection } from './McpSettingsSection';
export { OllamaSettingsSection } from './OllamaSettingsSection';
export { SettingsModal } from './SettingsModal';
export { VoiceSettingsSection } from './VoiceSettingsSection';
// Feature settings modules use this small public doorway rather than reaching
// into Settings internals. It keeps the registry contract stable for lanes
// that mount a Settings section.
export { registerSettingsSectionRenderer } from './registry/sectionRendererBindings';
export type {
  SettingsModuleDescriptor,
  SettingsSectionRenderProps,
} from './registry/types';

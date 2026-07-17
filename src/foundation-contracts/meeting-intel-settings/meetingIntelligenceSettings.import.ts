import {
  meetingIntelligenceSettingsPanel,
} from '@/features/meetings';
import {
  settingsModuleRegistry,
  type SettingsModuleDescriptor,
} from '@/features/settings';

/** Outside-module import proof for the public Meeting + Settings contribution. */
export function compileMeetingIntelligenceSettingsImport(): () => void {
  const descriptor: SettingsModuleDescriptor = meetingIntelligenceSettingsPanel;
  return settingsModuleRegistry.register(descriptor);
}

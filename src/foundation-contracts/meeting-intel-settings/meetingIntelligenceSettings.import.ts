import { meetingIntelligenceSettingsPanel } from '@/features/meetings';
import { type SettingsModuleDescriptor } from '@/features/settings';

/** Outside-module import proof for the production-owned Settings contribution. */
export function compileMeetingIntelligenceSettingsImport(): SettingsModuleDescriptor {
  const descriptor: SettingsModuleDescriptor = meetingIntelligenceSettingsPanel;
  return descriptor;
}

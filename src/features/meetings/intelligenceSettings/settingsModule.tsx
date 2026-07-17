import {
  settingsModuleRegistry,
  type SettingsModuleDescriptor,
} from '@/features/settings';
import { MeetingIntelligenceSettingsPanel } from './MeetingIntelligenceSettingsPanel';

/** A dark, feature-owned panel in the existing Scheduling Settings section. */
export const meetingIntelligenceSettingsPanel: SettingsModuleDescriptor = {
  id: 'meeting-intelligence-settings',
  section: 'scheduling',
  order: 20,
  labelKey: 'meeting-intelligence-settings.title',
  flagId: 'settings-shell-v1',
  searchTerms: [
    'meeting intelligence',
    'keyword tracking',
    'client signals',
    'meeting type',
    'meeting template',
  ],
  render: MeetingIntelligenceSettingsPanel,
};

let registered = false;

/**
 * Uses the public Settings doorway rather than mutating the owner registry.
 * It is idempotent because the Meetings public index is imported by more than
 * one product surface.
 */
export function registerMeetingIntelligenceSettingsPanel(): () => void {
  if (registered) return () => undefined;
  const unregister = settingsModuleRegistry.register(meetingIntelligenceSettingsPanel);
  registered = true;
  return () => {
    unregister();
    registered = false;
  };
}

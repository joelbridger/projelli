import { MeetingIntelligenceSettingsPanel } from './MeetingIntelligenceSettingsPanel';

/**
 * Feature-owned descriptor for the existing Scheduling Settings section.
 * Settings owns the one production registration line; its public doorway
 * validates this shape from an outside consumer without a Meetings→Settings
 * feature dependency.
 */
export const meetingIntelligenceSettingsPanel = {
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
} as const;

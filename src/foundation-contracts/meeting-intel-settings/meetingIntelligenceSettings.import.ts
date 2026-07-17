import {
  meetingIntelligenceSettingsPanel,
  registerMeetingIntelligenceSettingsPanel,
} from '@/features/meetings';

/** Outside-module import proof for the public Meeting + Settings contribution. */
export function compileMeetingIntelligenceSettingsImport(): () => void {
  void meetingIntelligenceSettingsPanel.id;
  return registerMeetingIntelligenceSettingsPanel();
}

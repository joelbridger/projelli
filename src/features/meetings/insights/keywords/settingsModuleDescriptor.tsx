import { MeetingKeywordSettingsPanel } from './meetingKeywords';

/** Meetings owns this descriptor; Settings imports it through the public Meetings doorway. */
export const meetingKeywordsSettingsPanel = {
  id: 'meeting-keywords',
  section: 'organization',
  order: 60,
  flagId: 'meeting-keywords',
  searchTerms: ['meeting topic', 'meeting topics', 'keyword', 'keywords'],
  render: () => <MeetingKeywordSettingsPanel />,
} as const;

import type { MeetingPanelId } from './meetingPanelRegistry';

// Compile-time contract proof: registered ids work, while a typo must fail.
const registeredPanelId: MeetingPanelId = 'recording';
// @ts-expect-error A misspelled id must not widen to string.
const misspelledPanelId: MeetingPanelId = 'recroding';

void registeredPanelId;
void misspelledPanelId;

export { useMeetingStore, resolveMatterFolder, resolveWorkspaceRoot } from './meetingStore';
export type { MeetingMeta, StartOpts } from './meetingStore';
export { RecordPill } from './RecordPill';
export { ClientMeetingsTab, listClientMeetings } from './ClientMeetingsTab';
export type { MeetingSummary } from './ClientMeetingsTab';
export { MeetingEntry } from './MeetingEntry';
export { TranscriptViewer, renderNoteWithCitations } from './TranscriptViewer';
export { meetingSourceRef, parseMeetingRef, mmss } from './meetingSources';
export { meetingNoteFromTranscript } from './meetingNoteTemplate';
export { dictationToMeeting, buildPseudoTranscript } from './dictationToMeeting';
export { FileAsMeetingDialog, stripVoiceNoteFrontmatter } from './FileAsMeetingDialog';
export { detectMeetingType, typeDefaults, makeMeetingTypesStore, BUILT_IN_TYPES } from './meetingTypes';
export { ConsentDialog, isMacPermissionError } from './ConsentDialog';
export { makeConsentLedger } from './consentLedger';
export type { ConsentEntry } from './consentLedger';
export { consentModeFor, TWO_PARTY_STATES } from './recordingConsentLaw';
export {
  meetingsSharedClientContextAdapter,
  type MeetingsSharedClientContext,
} from './sharedClientContext';

// The local-first CRM meetings seam. New CRM meeting consumers import this
// doorway rather than the legacy capture screen or raw live-record store.
export * from './foundation/contract';

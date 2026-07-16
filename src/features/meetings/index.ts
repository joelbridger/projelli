export {
  useMeetingStore,
  resolveMatterFolder,
  resolveWorkspaceRoot,
} from './meetingStore';
export type { MeetingMeta, StartOpts } from './meetingStore';
export { RecordPill } from './RecordPill';
export { ClientMeetingsTab, listClientMeetings } from './ClientMeetingsTab';
export type { MeetingSummary } from './ClientMeetingsTab';
export { MeetingEntry } from './MeetingEntry';
export { TranscriptViewer, renderNoteWithCitations } from './TranscriptViewer';
export { meetingSourceRef, parseMeetingRef, mmss } from './meetingSources';
export { meetingNoteFromTranscript } from './meetingNoteTemplate';
export {
  dictationToMeeting,
  buildPseudoTranscript,
} from './dictationToMeeting';
export {
  FileAsMeetingDialog,
  stripVoiceNoteFrontmatter,
} from './FileAsMeetingDialog';
export {
  detectMeetingType,
  typeDefaults,
  makeMeetingTypesStore,
  BUILT_IN_TYPES,
} from './meetingTypes';
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
export * from './foundation/manifest';

// Meeting composition contracts. These are the append-only registries the real
// Meetings host (MeetingEntry) renders through its default composition, so a
// dependent's panel / header action / insight is load-bearing in the product.
// Contribute with `createMeeting*Composition(...descriptors)` (see SKILL.md).
export {
  meetingPanelRegistry,
  validateMeetingPanelDescriptors,
  getMeetingPanels,
  createMeetingPanelComposition,
  defaultMeetingPanelComposition,
  registerMeetingPanel,
  getMeetingPanelComposition,
  type MeetingPanelComposition,
  type MeetingPanelContext,
  type MeetingPanelDescriptor,
  type MeetingPanelId,
} from './meetingPanelRegistry';
export {
  meetingHeaderActionRegistry,
  validateMeetingHeaderActionDescriptors,
  getMeetingHeaderActions,
  createMeetingHeaderActionComposition,
  defaultMeetingHeaderActionComposition,
  registerMeetingHeaderAction,
  getMeetingHeaderActionComposition,
  type MeetingHeaderActionComposition,
  type MeetingHeaderActionContext,
  type MeetingHeaderActionDescriptor,
  type MeetingHeaderActionId,
  type MeetingHeaderActionPlacement,
} from './meetingHeaderActionRegistry';
export {
  meetingInsightRegistry,
  validateMeetingInsightDescriptors,
  getRegisteredMeetingInsights,
  getMeetingInsights,
  createMeetingInsightComposition,
  defaultMeetingInsightComposition,
  registerMeetingInsight,
  getMeetingInsightComposition,
  type MeetingInsightComposition,
  type MeetingInsightDescriptor,
  type MeetingInsightId,
  type MeetingInsightMeetingSummaryContext,
  type MeetingInsightClientSummaryContext,
} from './meetingInsightRegistry';

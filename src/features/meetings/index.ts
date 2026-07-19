export {
  MeetingIntelligenceSettingsContent,
  MeetingIntelligenceSettingsPanel,
  meetingIntelligenceSettingsPanel,
  type IntelligenceStores,
} from './intelligenceSettings';

export {
  useMeetingStore,
  resolveMatterFolder,
  resolveWorkspaceRoot,
} from './meetingStore';
export type { MeetingMeta, StartOpts } from './meetingStore';
export { readApprovedMeetingArtifacts } from './askArtifacts';
export { readReviewNeededMeetingArtifacts } from './reviewArtifacts';
export {
  STRUCTURED_MEETING_SUMMARY_SCHEMA_VERSION,
  createStructuredMeetingSummaryReader,
  type StructuredMeetingSummary,
  type StructuredMeetingSummaryPayload,
  type StructuredMeetingSummaryReadResult,
  type StructuredMeetingSummaryReader,
} from './structuredMeetingSummary';
export { RecordPill } from './RecordPill';
export {
  StructuredMeetingSummaryPanel,
  structuredSummaryFromText,
  type StructuredMeetingSummaryContent,
  type StructuredMeetingSummaryLoader,
  type StructuredMeetingSummaryPanelLoadResult,
} from './StructuredMeetingSummaryPanel';
export { ClientMeetingsTab, listClientMeetings } from './ClientMeetingsTab';
export type { MeetingSummary } from './ClientMeetingsTab';
export { MeetingEntry } from './MeetingEntry';
export {
  meetingEntryHostIdentity,
  type MeetingEntryHostIdentity,
  type MeetingEntryHostIdentityInput,
  type MeetingEntryTarget,
} from './meetingEntryHostIdentity';
export {
  projectMeetingDetailHeader,
  type MeetingCrmNavigationHandoff,
  type MeetingDetailAudioState,
  type MeetingDetailHeaderProjection,
  type MeetingDetailHeaderProjectionInput,
} from './meetingDetailHeaderProjection';
export {
  MeetingPrepPanel,
  projectMeetingPrepSections,
  type MeetingPrepHandoffs,
  type MeetingPrepPanelProps,
  type MeetingPrepSections,
} from './MeetingPrepPanel';
export {
  selectExactMeetingBrief,
  type ExactMeetingBriefTarget,
  type MeetingBrief,
} from './briefStore';
export { enqueueBriefs } from './briefQueue';
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
export { detectPlatform } from './noticeCard/meetingPlatform';
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
export {
  createMeetingKeywordCatalogueStore,
  useMeetingKeywordCatalogueStore,
  validateMeetingKeywordCatalogue,
} from './foundation/contract';
export type { MeetingKeywordCatalogueStore } from './foundation/contract';

// Meeting composition contracts. These are the append-only registries the real
// Meetings host (MeetingEntry) renders through its default composition, so a
// dependent's panel / header action / insight is load-bearing in the product.
// Contribute with `createMeeting*Composition(...descriptors)` (see SKILL.md).
export {
  BLESSED_MEETING_PANEL_IDS,
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
  type BlessedMeetingPanelId,
} from './meetingPanelRegistry';
export {
  MeetingAgendaPanel,
  type MeetingAgendaPanelState,
} from './agenda/MeetingAgendaPanel';
export {
  createMeetingAgendaPanelDescriptor,
  useMeetingAgendaCompatibility,
} from './agenda/meetingAgendaCompatibility';
export {
  createMeetingAgendaStore,
  deriveMeetingAgendaRecordId,
  meetingAgendaTarget,
  useMeetingAgendaStore,
  type MeetingAgenda,
  type MeetingAgendaReadResult,
  type MeetingAgendaStore,
  type MeetingAgendaTarget,
  type MeetingAgendaWriteResult,
} from './agenda/meetingAgendaStore';
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
export {
  detectCitedMeetingKeywordInsights,
  detectMeetingKeywordMatches,
  meetingKeywordsInsight,
  MeetingKeywordSettingsPanel,
  type MeetingKeywordMatch,
} from './insights/keywords/meetingKeywords';
export { meetingKeywordsSettingsPanel } from './insights/keywords/settingsModuleDescriptor';

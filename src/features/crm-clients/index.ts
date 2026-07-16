export { DirectorySurface } from './DirectorySurface';
export { ClientsSurface } from './ClientsSurface';
export { HouseholdRecordSurface } from './HouseholdRecordSurface';
export { IntakeSubmissionReview } from './IntakeSubmissionReview';
export { NoteEditor } from './NoteEditor';
export { ProposalCard } from './ProposalCard';
export { RecordMetadataEditor } from './RecordMetadataEditor';
export {
  crmClientsSharedClientContextAdapter,
  type CrmClientsSharedContext,
} from './sharedClientContext';
export type * from './adapters';
export {
  createDirectoryComposition,
  defaultDirectoryComposition,
  projectDirectoryResults,
  resolveDirectoryView,
  type DirectoryComposition,
  type DirectoryContext,
  type DirectoryContribution,
  type DirectoryQueryDescriptor,
  type DirectoryResult,
  type DirectoryViewDescriptor,
} from './directoryRegistry';
export {
  createDirectoryPreferenceStore,
  type DirectoryPreferenceStorage,
  type DirectoryPreferenceStore,
  type DirectoryPreferenceValue,
} from './directoryPreferences';

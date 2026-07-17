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
  type DirectoryFeatureContext,
  type DirectoryFeatureQueryDescriptor,
  type DirectoryFeatureState,
  type DirectoryFeatureStateValue,
  type DirectoryFeatureToolDescriptor,
  type DirectoryFeatureViewDescriptor,
  type DirectoryQueryDescriptor,
  type DirectoryLegacyRepository,
  type DirectoryRepository,
  type DirectoryResult,
  type DirectoryToolDescriptor,
  type DirectoryViewDescriptor,
} from './directoryRegistry';
export {
  createDirectoryPreferenceStore,
  type DirectoryPreferenceStorage,
  type DirectoryPreferenceStore,
  type DirectoryPreferenceValue,
} from './directoryPreferences';
export {
  householdSectionRegistry,
  getHouseholdSections,
  validateHouseholdSectionDescriptors,
} from './recordRegistry';
export {
  householdTabRegistry,
  validateHouseholdTabDescriptors,
} from './tabRegistry';
export {
  householdSectionContextFromRecordIdentity,
  toMeetingClientBoundary,
} from './clientBoundary';
export type {
  HouseholdAddActionDescriptor,
  HouseholdHeaderActionDescriptor,
  HouseholdRecordExtensionDescriptor,
  HouseholdRecordShellContext,
  HouseholdSectionContext,
  HouseholdSectionDescriptor,
} from './recordRegistry';
export type {
  HouseholdTab,
  HouseholdTabDescriptor,
  HouseholdTabSurfaceProps,
} from './tabRegistry';
export type { HouseholdRecordIdentity } from './clientBoundary';

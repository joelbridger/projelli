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
  registerHouseholdSection,
  validateHouseholdSectionDescriptors,
} from './recordRegistry';
export {
  householdTabRegistry,
  registerHouseholdTab,
  validateHouseholdTabDescriptors,
} from './tabRegistry';
export {
  resolveHouseholdMatterId,
  toHouseholdSectionContext,
  toMeetingClientBoundary,
} from './clientBoundary';
export type {
  HouseholdAddActionDescriptor,
  HouseholdHeaderActionDescriptor,
  HouseholdRecordExtensionDescriptor,
  HouseholdSectionContext,
  HouseholdSectionDescriptor,
} from './recordRegistry';
export type {
  HouseholdTab,
  HouseholdTabDescriptor,
  HouseholdTabSurfaceProps,
} from './tabRegistry';
export { memberRailTab } from './extensions/record-member-kebab';

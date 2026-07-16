export { HouseholdDocumentsTab } from './HouseholdDocumentsTab';
export { documentsTab } from './surface';
export { addDocumentRef, linkedDocumentsForHousehold, removeDocumentRef } from './documentLinks';
/** Public existing-document pointer contract; no file or raw-native API crosses this doorway. */
export {
  WorkspaceDocumentRefError,
  addWorkspaceDocumentRef,
  listWorkspaceDocumentRefs,
  removeWorkspaceDocumentRef,
  resolveWorkspaceDocumentRef,
} from './documentLinks';
export type {
  ResolveWorkspaceDocumentRefInput,
  WorkspaceDocumentRef,
  WorkspaceDocumentRefErrorCode,
} from './documentLinks';

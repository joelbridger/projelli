/**
 * Public doorway for explainable, review-only CRM duplicate detection.
 * No merge, persistence, data-loading, selection, or bulk-action contract is exposed.
 */
export { crmDuplicatesDirectoryTool } from './directoryTool';
export {
  findLikelyDuplicateHouseholds,
  findLikelyDuplicateContacts,
  normalizeDuplicateHouseholdName,
  type DuplicateContactMatch,
  type DuplicateContactRecord,
  type DuplicateHouseholdMatch,
  type DuplicateHouseholdRecord,
} from './duplicateDetection';

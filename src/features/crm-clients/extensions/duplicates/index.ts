/**
 * Public doorway for explainable, review-only CRM duplicate detection.
 * No merge, persistence, data-loading, selection, or bulk-action contract is exposed.
 */
export { crmDuplicatesDirectoryTool } from './directoryTool';
export {
  findLikelyDuplicateHouseholds,
  normalizeDuplicateHouseholdName,
  type DuplicateHouseholdMatch,
  type DuplicateHouseholdRecord,
} from './duplicateDetection';

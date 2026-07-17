/**
 * Outside-Meetings compile proof for the firm keyword catalogue paved path.
 * Consumers import only the public Meetings doorway; they cannot reach into
 * the foundation implementation directly.
 */
import {
  createMeetingKeywordCatalogueStore,
  useMeetingKeywordCatalogueStore,
  validateMeetingKeywordCatalogue,
  type MeetingKeywordCatalogueStore,
} from '@/features/meetings';

export function normalizeMeetingKeywordTerms(
  terms: readonly string[]
): readonly string[] {
  return validateMeetingKeywordCatalogue(terms);
}

void createMeetingKeywordCatalogueStore;
void useMeetingKeywordCatalogueStore;

export type MeetingKeywordCatalogueImportProof = MeetingKeywordCatalogueStore;

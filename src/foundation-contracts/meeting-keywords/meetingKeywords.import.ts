/** Outside-Meetings compile proof for the keyword insight and Settings descriptor. */
import {
  detectCitedMeetingKeywordInsights,
  detectMeetingKeywordMatches,
  meetingKeywordsInsight,
  meetingKeywordsSettingsPanel,
  validateMeetingKeywordCatalogue,
  type MeetingKeywordMatch,
} from '@/features/meetings';

void detectCitedMeetingKeywordInsights;
void detectMeetingKeywordMatches;
void meetingKeywordsInsight;
void meetingKeywordsSettingsPanel;

export function normalizeMeetingKeywordTerms(
  terms: readonly string[]
): readonly string[] {
  return validateMeetingKeywordCatalogue(terms);
}

export type MeetingKeywordsImportProof = MeetingKeywordMatch;

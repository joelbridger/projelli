import { describe, expect, it } from 'vitest';
import {
  type MeetingKeywordsImportProof,
  normalizeMeetingKeywordTerms,
} from './meetingKeywords.import';

describe('meeting keywords public import fixture', () => {
  it('uses the public Meetings doorway from outside the feature', () => {
    const terms: MeetingKeywordsImportProof = {
      term: 'Retirement',
      count: 1,
      sourceArtifactIds: ['artifact-1'],
    };
    expect(normalizeMeetingKeywordTerms([' Retirement '])).toEqual([
      'Retirement',
    ]);
    expect(terms.sourceArtifactIds).toEqual(['artifact-1']);
  });
});

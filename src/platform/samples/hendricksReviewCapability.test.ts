import { describe, expect, it } from 'vitest';
import { HENDRICKS_CRM_ARTIFACT_ID, HENDRICKS_TASK_ARTIFACT_ID, hendricksReviewArtifactInputs, hendricksReviewProposals } from './hendricksReviewCapability';

const binding = { workspaceRoot: '/sample', workspaceGeneration: 1, matterId: 'matter-hendricks', meetingId: 'meeting-hendricks' };

describe('Hendricks review capability', () => {
  it('contains exactly one task and exactly one one-field local CRM proposal', () => {
    const proposals = hendricksReviewProposals(binding);
    expect(proposals).toHaveLength(2);
    expect(proposals.map((proposal) => proposal.id)).toEqual([HENDRICKS_TASK_ARTIFACT_ID, HENDRICKS_CRM_ARTIFACT_ID]);
    expect(proposals[0].kind).toBe('task');
    expect(proposals[1]).toMatchObject({ kind: 'crm-update', fields: [expect.objectContaining({ field: 'annualReviewFollowUp' })] });
    expect(hendricksReviewArtifactInputs(binding).map((artifact) => artifact.id)).toEqual([HENDRICKS_TASK_ARTIFACT_ID, HENDRICKS_CRM_ARTIFACT_ID]);
  });
});

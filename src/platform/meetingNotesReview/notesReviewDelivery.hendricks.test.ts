import { describe, expect, it } from 'vitest';
import { hendricksReviewProposals, isHendricksReviewArtifact } from '@/platform/samples/hendricksReviewCapability';

describe('Hendricks review reader', () => {
  it('refuses a forged accountless artifact', () => {
    const binding = { workspaceRoot: '/sample', workspaceGeneration: 1, matterId: 'matter-hendricks', meetingId: 'meeting-hendricks' };
    const proposal = hendricksReviewProposals(binding)[0];
    expect(isHendricksReviewArtifact({ id: proposal.id, meetingId: binding.meetingId, householdRef: 'sample-hendricks-household', matterId: binding.matterId, schemaVersion: 2, meetingVisibility: { lineage: 'accountless-unrestricted' }, payload: { proposal } })).toBe(true);
    expect(isHendricksReviewArtifact({ id: proposal.id, meetingId: binding.meetingId, householdRef: 'sample-hendricks-household', matterId: binding.matterId, schemaVersion: 2, meetingVisibility: { lineage: 'accountless-unrestricted' }, payload: { proposal: { ...proposal, title: 'forged' } } })).toBe(false);
  });
});

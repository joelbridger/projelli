import { describe, expect, it } from 'vitest';
import { hendricksReviewArtifactInputs } from '@/platform/samples/hendricksReviewCapability';

describe('Hendricks artifact contract', () => {
  it('uses stable IDs and the sealed sample lineage', () => {
    expect(hendricksReviewArtifactInputs({ workspaceRoot: '/sample', workspaceGeneration: 1, matterId: 'matter-hendricks', meetingId: 'meeting-hendricks' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ provenance: 'hendricks-sample-capability', schemaVersion: 2 })]));
  });
});

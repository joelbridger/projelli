import { describe, expect, it } from 'vitest';
import { resolveMeetingVisibility } from '@/platform/meeting-visibility';

describe('Hendricks review visibility', () => {
  it('does not convert a sample marker into a general meeting visibility grant', () => {
    expect(resolveMeetingVisibility({ subject: { id: 'sample-hendricks-annual-review', kind: 'meeting-note', lineage: 'hendricks-sample-capability' }, viewerId: null, policies: [], resolveParent: () => null }).visible).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDevFlagOverride } from '@/platform/flags';
import { getHouseholdSections } from '../../recordRegistry';

// This lives in a NEW file alongside the record-kinds feature (not in the shared
// recordRegistry.test.tsx) so the record-kinds acceptance stays within its own
// fence. It proves the Details cards section is dark by default and only mounts
// when its own flag is enabled.
describe('record-kinds section flag gating', () => {
  beforeEach(() => {
    setDevFlagOverride('record-kinds-v1', false);
  });

  afterEach(() => {
    setDevFlagOverride('record-kinds-v1', undefined);
  });

  it('adds the record Details cards only when their own dark flag is enabled', () => {
    expect(
      getHouseholdSections().map((descriptor) => descriptor.id)
    ).not.toContain('record-kinds-details');

    setDevFlagOverride('record-kinds-v1', true);
    expect(getHouseholdSections().map((descriptor) => descriptor.id)).toContain(
      'record-kinds-details'
    );
  });
});

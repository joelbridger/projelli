import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdRecord } from './adapters';

const household: HouseholdRecord = {
  id: 'h-registry',
  name: 'Jordan family',
  lifecycle: 'active',
  primaryAdvisor: 'Ada',
  ownership: 'mine',
  serviceTier: 'standard',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
};
afterEach(() => {
  cleanup();
  setDevFlagOverride('schwab-prefill', undefined);
});
describe('Schwab Reviews registry swap', () => {
  it('keeps the exact legacy descriptor while dark', async () => {
    setDevFlagOverride('schwab-prefill', false);
    vi.resetModules();
    const [{ householdTabRegistry }, { reviewsTab }] = await Promise.all([
      import('./tabRegistry'),
      import('./reviewsTab'),
    ]);
    expect(householdTabRegistry.filter((tab) => tab.id === 'reviews')).toEqual([
      reviewsTab,
    ]);
  });
  it('mounts one populated Reviews packet while enabled', async () => {
    setDevFlagOverride('schwab-prefill', true);
    vi.resetModules();
    const { householdTabRegistry } = await import('./tabRegistry');
    const reviews = householdTabRegistry.find((tab) => tab.id === 'reviews');
    if (!reviews) throw new Error('reviews descriptor missing');
    render(
      <reviews.Component
        household={household}
        proposals={[]}
        timelineRecords={[]}
        renderLegacySurface={() => null}
      />
    );
    expect(
      await screen.findByTestId('schwab-prefill-review')
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId('schwab-prefill-review')).toHaveLength(1);
  });
});

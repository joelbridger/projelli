import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdRecord } from './adapters';

const schwabLiveReaders = vi.hoisted(() => ({
  household: vi.fn(),
  privateFacts: vi.fn(),
  proposal: vi.fn(),
  packet: vi.fn(),
}));
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
  vi.restoreAllMocks();
  vi.doUnmock('@/features/accounts');
  setDevFlagOverride('schwab-prefill', undefined);
});
describe('Schwab Reviews registry swap', () => {
  it('keeps the exact legacy descriptor and mounts no Schwab readers while dark', async () => {
    vi.doMock('@/features/accounts', () => ({
      SchwabPrefillReview: ({
        household: nextHousehold,
      }: {
        household: HouseholdRecord;
      }) => {
        schwabLiveReaders.household(nextHousehold.id);
        schwabLiveReaders.privateFacts();
        schwabLiveReaders.proposal();
        schwabLiveReaders.packet();
        return <div data-testid="schwab-prefill-review" />;
      },
    }));
    setDevFlagOverride('schwab-prefill', false);
    vi.resetModules();
    const [{ householdTabRegistry }, { reviewsTab }] = await Promise.all([
      import('./tabRegistry'),
      import('./reviewsTab'),
    ]);
    expect(householdTabRegistry.filter((tab) => tab.id === 'reviews')).toEqual([
      reviewsTab,
    ]);
    render(
      <reviewsTab.Component
        household={household}
        proposals={[]}
        timelineRecords={[]}
        renderLegacySurface={() => null}
      />
    );
    expect(screen.getByTestId('client-reviews-tab')).toBeInTheDocument();
    expect(
      screen.queryByTestId('schwab-prefill-review')
    ).not.toBeInTheDocument();
    expect(schwabLiveReaders.household).not.toHaveBeenCalled();
    expect(schwabLiveReaders.privateFacts).not.toHaveBeenCalled();
    expect(schwabLiveReaders.proposal).not.toHaveBeenCalled();
    expect(schwabLiveReaders.packet).not.toHaveBeenCalled();
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

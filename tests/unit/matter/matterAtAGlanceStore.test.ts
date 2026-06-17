/**
 * matterAtAGlanceStore.test.ts
 *
 * Tests for the Zustand cache store: setEntry, getEntry, invalidate,
 * clearAll, and that a refresh (invalidate) forces fresh generation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useMatterAtAGlanceStore } from '@/stores/matterAtAGlanceStore';
import type { MatterAtAGlanceResult } from '@/features/matters/logic/matterAtAGlance';

const sampleResult: MatterAtAGlanceResult = {
  openIssues: ['Lease dispute unresolved'],
  deadlines: ['Response due July 1'],
  nextActions: ['Request title search'],
  generatedAt: '2026-06-15T10:00:00.000Z',
};

function resetStore() {
  useMatterAtAGlanceStore.setState({ cache: {} });
}

describe('matterAtAGlanceStore', () => {
  beforeEach(resetStore);

  it('starts with an empty cache', () => {
    expect(useMatterAtAGlanceStore.getState().cache).toEqual({});
  });

  it('setEntry stores a result keyed by matterId', () => {
    useMatterAtAGlanceStore.getState().setEntry('matter_123', sampleResult);
    const entry = useMatterAtAGlanceStore.getState().getEntry('matter_123');
    expect(entry).toBeDefined();
    expect(entry!.result).toEqual(sampleResult);
    expect(entry!.cachedAt).toBeTruthy();
    expect(typeof entry!.cachedAt).toBe('string');
  });

  it('getEntry returns undefined for unknown matter', () => {
    expect(useMatterAtAGlanceStore.getState().getEntry('unknown_matter')).toBeUndefined();
  });

  it('setEntry sets cachedAt to a recent ISO timestamp', () => {
    const before = Date.now();
    useMatterAtAGlanceStore.getState().setEntry('matter_123', sampleResult);
    const after = Date.now();
    const entry = useMatterAtAGlanceStore.getState().getEntry('matter_123');
    const ts = new Date(entry!.cachedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('invalidate removes the entry for the given matter', () => {
    useMatterAtAGlanceStore.getState().setEntry('matter_123', sampleResult);
    expect(useMatterAtAGlanceStore.getState().getEntry('matter_123')).toBeDefined();

    useMatterAtAGlanceStore.getState().invalidate('matter_123');
    expect(useMatterAtAGlanceStore.getState().getEntry('matter_123')).toBeUndefined();
  });

  it('invalidate does not affect other matters', () => {
    useMatterAtAGlanceStore.getState().setEntry('matter_aaa', sampleResult);
    useMatterAtAGlanceStore.getState().setEntry('matter_bbb', sampleResult);

    useMatterAtAGlanceStore.getState().invalidate('matter_aaa');

    expect(useMatterAtAGlanceStore.getState().getEntry('matter_aaa')).toBeUndefined();
    expect(useMatterAtAGlanceStore.getState().getEntry('matter_bbb')).toBeDefined();
  });

  it('clearAll empties the entire cache', () => {
    useMatterAtAGlanceStore.getState().setEntry('matter_aaa', sampleResult);
    useMatterAtAGlanceStore.getState().setEntry('matter_bbb', sampleResult);

    useMatterAtAGlanceStore.getState().clearAll();

    expect(useMatterAtAGlanceStore.getState().cache).toEqual({});
  });

  it('overwriting an entry replaces the result and refreshes cachedAt', async () => {
    useMatterAtAGlanceStore.getState().setEntry('matter_123', sampleResult);
    const firstEntry = useMatterAtAGlanceStore.getState().getEntry('matter_123');

    // Small delay to ensure cachedAt timestamps differ
    await new Promise((r) => { setTimeout(r, 5); });

    const updatedResult: MatterAtAGlanceResult = {
      openIssues: ['New issue found'],
      deadlines: [],
      nextActions: [],
      generatedAt: new Date().toISOString(),
    };
    useMatterAtAGlanceStore.getState().setEntry('matter_123', updatedResult);
    const secondEntry = useMatterAtAGlanceStore.getState().getEntry('matter_123');

    expect(secondEntry!.result.openIssues).toEqual(['New issue found']);
    // cachedAt should be at or after the first cachedAt
    expect(new Date(secondEntry!.cachedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(firstEntry!.cachedAt).getTime(),
    );
  });
});

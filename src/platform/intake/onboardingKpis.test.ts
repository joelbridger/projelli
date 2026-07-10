import { describe, expect, it } from 'vitest';

import type { IntakeRecord } from './intakeStore';
import type { OnboardingRow } from './onboardingModel';
import { computeOnboardingKpis } from './onboardingKpis';

function row(overrides: Partial<OnboardingRow> = {}): OnboardingRow {
  return {
    matterId: 'matter-1',
    requestId: 'intake-1',
    clientFirstName: 'Sarah',
    kind: 'onboarding',
    requiredCount: 3,
    receivedCount: 1,
    missingItemIds: [],
    missingItemLabels: [],
    stalledDays: 0,
    isStalled: false,
    pendingReviewCount: 0,
    status: 'active',
    linkSignals: [],
    nudgeEligibility: {
      eligible: false,
      reason: 'nothing_missing',
      nextSequence: 1,
      suggestCall: false,
    },
    sortBucket: 4,
    ...overrides,
  };
}

function record(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    intakeId: 'intake-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    firmName: 'North Star Planning',
    status: 'active',
    expiresAt: '2026-08-01T00:00:00.000Z',
    checklistVersion: 1,
    items: [],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
    ...overrides,
  };
}

describe('computeOnboardingKpis', () => {
  it('averages days to complete from completed intakes with known timestamps', () => {
    const kpis = computeOnboardingKpis([], [
      record({
        intakeId: 'completed-2-days',
        status: 'completed',
        createdAt: '2026-07-01T00:00:00.000Z',
        completedAt: '2026-07-03T00:00:00.000Z',
      }),
      record({
        intakeId: 'completed-4-days',
        status: 'completed',
        createdAt: '2026-07-01T00:00:00.000Z',
        completedAt: '2026-07-05T00:00:00.000Z',
      }),
    ]);

    expect(kpis.avgDaysToComplete).toBe(3);
    expect(kpis.completedCount).toBe(2);
  });

  it('counts only rows that are currently stalled', () => {
    const kpis = computeOnboardingKpis([
      row({ requestId: 'stalled-1', isStalled: true, stalledDays: 7 }),
      row({ requestId: 'active-1' }),
      row({ requestId: 'stalled-2', isStalled: true, stalledDays: 5 }),
    ], []);

    expect(kpis.stalledCount).toBe(2);
  });

  it('calculates a rounded completion rate without producing NaN', () => {
    const kpis = computeOnboardingKpis([], [
      record({ intakeId: 'completed-1', status: 'completed' }),
      record({ intakeId: 'completed-2', status: 'completed' }),
      record({ intakeId: 'active-1', status: 'active' }),
    ]);

    expect(kpis.completionRate).toBe(0.67);
    expect(kpis.completedCount).toBe(2);
    expect(kpis.activeCount).toBe(1);
    expect(Number.isNaN(kpis.completionRate)).toBe(false);
  });

  it('returns an honest empty result when there is no intake data', () => {
    const kpis = computeOnboardingKpis([], []);

    expect(kpis).toEqual({
      avgDaysToComplete: null,
      stalledCount: 0,
      completionRate: 0,
      completedCount: 0,
      activeCount: 0,
    });
    expect(Number.isNaN(kpis.completionRate)).toBe(false);
  });

  it('excludes in-progress intakes from the average completion time', () => {
    const kpis = computeOnboardingKpis([], [
      record({
        intakeId: 'completed',
        status: 'completed',
        createdAt: '2026-07-01T00:00:00.000Z',
        completedAt: '2026-07-04T00:00:00.000Z',
      }),
      record({
        intakeId: 'active',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-07-10T00:00:00.000Z',
      }),
    ]);

    expect(kpis.avgDaysToComplete).toBe(3);
  });
});

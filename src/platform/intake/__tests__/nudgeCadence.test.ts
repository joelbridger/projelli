import { describe, expect, it } from 'vitest';

import {
  deriveNudgeEligibility,
  deriveOnboardingRow,
} from '../onboardingModel';
import {
  migratePersistedIntakeState,
  partializeIntakeStateForPersistence,
  type IntakeRecord,
  useIntakeStore,
} from '../intakeStore';
import { DEFAULT_ONBOARDING_CONFIG } from '../nudgeTypes';

const now = new Date('2026-07-10T12:00:00.000Z');
const cfg = DEFAULT_ONBOARDING_CONFIG;

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    intakeId: overrides.intakeId ?? 'intake-1',
    matterId: overrides.matterId ?? 'matter-1',
    clientFirstName: overrides.clientFirstName ?? 'Sarah',
    clientEmail: overrides.clientEmail ?? 'sarah@example.test',
    firmName: overrides.firmName ?? 'North Star Planning',
    status: overrides.status ?? 'active',
    link: overrides.link ?? 'https://forms.example.test/i/intake-1#safe-link',
    expiresAt: overrides.expiresAt ?? '2026-08-09T00:00:00.000Z',
    checklistVersion: 1,
    items: overrides.items ?? [
      { itemId: 'license-back', label: 'License back', state: 'not_started' },
      { itemId: 'income-docs', label: 'Income documents', state: 'needs_followup' },
    ],
    receivedItems: overrides.receivedItems ?? [],
    flags: overrides.flags ?? [],
    knownSessionIds: overrides.knownSessionIds ?? [],
    knownSubmissionIds: overrides.knownSubmissionIds ?? [],
    nudges: overrides.nudges ?? [],
    publicKeyRawB64: overrides.publicKeyRawB64 ?? 'public-key',
    ...overrides,
  };
}

describe('nudge cadence', () => {
  it('allows at most one email draft nudge per cadence window', () => {
    expect(deriveNudgeEligibility(intake(), now, cfg)).toMatchObject({
      eligible: true,
      reason: 'ok',
      nextSequence: 1,
    });

    expect(deriveNudgeEligibility(intake({
      nudges: [{
        sequence: 1,
        at: '2026-07-08T12:00:00.000Z',
        missingItemIds: ['license-back'],
        auditPairId: 'audit-1',
        channel: 'email_draft',
      }],
    }), now, cfg)).toMatchObject({
      eligible: false,
      reason: 'cadence_wait',
      daysUntilEligible: 2,
      nextSequence: 2,
    });

    expect(deriveNudgeEligibility(intake({
      nudges: [{
        sequence: 1,
        at: '2026-07-06T12:00:00.000Z',
        missingItemIds: ['license-back'],
        auditPairId: 'audit-1',
        channel: 'email_draft',
      }],
    }), now, cfg)).toMatchObject({
      eligible: true,
      reason: 'ok',
      nextSequence: 2,
    });
  });

  it('suggests a call after three unanswered email draft nudges', () => {
    const threeUnanswered = intake({
      lastClientActivityAt: '2026-07-01T12:00:00.000Z',
      nudges: [1, 2, 3].map((sequence) => ({
        sequence,
        at: `2026-07-0${String(sequence + 1)}T12:00:00.000Z`,
        missingItemIds: ['license-back'],
        auditPairId: `audit-${String(sequence)}`,
        channel: 'email_draft' as const,
      })),
    });

    expect(deriveNudgeEligibility(threeUnanswered, now, cfg)).toMatchObject({
      eligible: false,
      reason: 'max_unanswered_suggest_call',
      suggestCall: true,
      nextSequence: 4,
    });
  });

  it('resets unanswered count after newer client activity lands', () => {
    const withReply = intake({
      lastClientActivityAt: '2026-07-05T12:00:01.000Z',
      nudges: [1, 2, 3].map((sequence) => ({
        sequence,
        at: `2026-07-0${String(sequence + 1)}T12:00:00.000Z`,
        missingItemIds: ['license-back'],
        auditPairId: `audit-${String(sequence)}`,
        channel: 'email_draft' as const,
      })),
    });

    expect(deriveNudgeEligibility(withReply, now, cfg)).toMatchObject({
      eligible: true,
      reason: 'ok',
      suggestCall: false,
      nextSequence: 4,
    });
  });

  it('reads durable nudge attempts after store rehydrate', () => {
    useIntakeStore.getState().resetForTests();
    useIntakeStore.getState().upsertIntake(intake({
      intakeId: 'intake-rehydrate',
      nudges: [{
        sequence: 1,
        at: '2026-07-08T12:00:00.000Z',
        missingItemIds: ['license-back'],
        auditPairId: 'audit-1',
        channel: 'email_draft',
      }],
    }));
    const persisted = partializeIntakeStateForPersistence(useIntakeStore.getState());

    useIntakeStore.getState().resetForTests();
    const rehydrated = migratePersistedIntakeState(persisted, 2);
    useIntakeStore.setState({ intakesById: rehydrated.intakesById as Record<string, IntakeRecord> });

    const stored = useIntakeStore.getState().intakesById['intake-rehydrate'];
    expect(stored).toBeTruthy();
    if (!stored) throw new Error('Missing rehydrated intake.');
    expect(deriveOnboardingRow(stored, now, cfg).nudgeEligibility).toMatchObject({
      eligible: false,
      reason: 'cadence_wait',
      daysUntilEligible: 2,
    });
  });
});

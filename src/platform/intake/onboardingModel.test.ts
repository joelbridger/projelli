import { describe, expect, it } from 'vitest';

import type { IntakeRecord } from './intakeStore';
import {
  DEFAULT_ONBOARDING_CONFIG,
  type OnboardingConfig,
} from './nudgeTypes';
import {
  deriveLinkSignals,
  deriveNudgeEligibility,
  deriveOnboardingRow,
  sortOnboardingRows,
  type OnboardingRow,
} from './onboardingModel';

const cfg: OnboardingConfig = DEFAULT_ONBOARDING_CONFIG;
const now = new Date('2026-07-10T12:00:00.000Z');

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    intakeId: overrides.intakeId ?? 'intake-1',
    matterId: overrides.matterId ?? 'matter-1',
    clientFirstName: overrides.clientFirstName ?? 'Sarah',
    firmName: 'North Star',
    status: overrides.status ?? 'active',
    expiresAt: overrides.expiresAt ?? '2026-08-09T00:00:00.000Z',
    checklistVersion: 1,
    items: overrides.items ?? [
      { itemId: 'ssn', label: 'Social Security number', state: 'not_started' },
      { itemId: 'income', label: 'Income', state: 'received' },
      { itemId: 'license', label: "Driver's license", state: 'accepted' },
    ],
    receivedItems: overrides.receivedItems ?? [],
    flags: overrides.flags ?? [],
    knownSessionIds: overrides.knownSessionIds ?? [],
    knownSubmissionIds: overrides.knownSubmissionIds ?? [],
    nudges: overrides.nudges ?? [],
    ...overrides,
  };
}

describe('onboardingModel', () => {
  it('derives missing, received, pending review, and stall math from labels and timestamps', () => {
    const row = deriveOnboardingRow(intake({
      lastClientActivityAt: '2026-07-04T12:00:00.000Z',
    }), now, cfg);

    expect(row).toMatchObject({
      matterId: 'matter-1',
      requestId: 'intake-1',
      clientFirstName: 'Sarah',
      kind: 'onboarding',
      requiredCount: 3,
      receivedCount: 2,
      missingItemIds: ['ssn'],
      missingItemLabels: ['Social Security number'],
      stalledDays: 6,
      isStalled: true,
      pendingReviewCount: 1,
      status: 'active',
    });
  });

  it('sorts a five-client board by review, stalled, link action, quiet, then complete', () => {
    const rows = [
      deriveOnboardingRow(intake({
        intakeId: 'quiet',
        matterId: 'quiet',
        clientFirstName: 'Quiet',
        lastClientActivityAt: '2026-07-09T12:00:00.000Z',
        items: [{ itemId: 'ssn', label: 'SSN', state: 'not_started' }],
      }), now, cfg),
      deriveOnboardingRow(intake({
        intakeId: 'complete',
        matterId: 'complete',
        clientFirstName: 'Complete',
        items: [{ itemId: 'ssn', label: 'SSN', state: 'accepted' }],
      }), now, cfg),
      deriveOnboardingRow(intake({
        intakeId: 'stalled-older',
        matterId: 'stalled-older',
        clientFirstName: 'Stalled older',
        lastClientActivityAt: '2026-06-30T12:00:00.000Z',
        items: [{ itemId: 'ssn', label: 'SSN', state: 'not_started' }],
      }), now, cfg),
      deriveOnboardingRow(intake({
        intakeId: 'review',
        matterId: 'review',
        clientFirstName: 'Review',
        items: [{ itemId: 'ssn', label: 'SSN', state: 'received' }],
      }), now, cfg),
      deriveOnboardingRow(intake({
        intakeId: 'link',
        matterId: 'link',
        clientFirstName: 'Link',
        expiresAt: '2026-07-12T12:00:00.000Z',
        items: [{ itemId: 'ssn', label: 'SSN', state: 'not_started' }],
      }), now, cfg),
    ];

    expect(sortOnboardingRows(rows).map((row) => row.requestId)).toEqual([
      'review',
      'stalled-older',
      'link',
      'quiet',
      'complete',
    ]);
  });

  it('derives each local link signal state without relay data', () => {
    expect(deriveLinkSignals(intake(), now, cfg)[0]).toMatchObject({
      kind: 'active',
      severity: 'info',
      dismissible: true,
    });
    expect(deriveLinkSignals(intake({ expiresAt: '2026-07-12T12:00:00.000Z' }), now, cfg)[0]).toMatchObject({
      kind: 'expires_soon',
      severity: 'attention',
    });
    expect(deriveLinkSignals(intake({ expiresAt: '2026-07-09T12:00:00.000Z' }), now, cfg)[0]).toMatchObject({
      kind: 'expired',
      severity: 'attention',
    });
    expect(deriveLinkSignals(intake({ status: 'revoked' }), now, cfg)[0]).toMatchObject({
      kind: 'revoked',
      severity: 'attention',
    });
    const flagged = deriveLinkSignals(intake({
      flags: [
        { id: 'f1', kind: 'new_device', message: 'New device', at: '2026-07-10T10:00:00.000Z' },
        { id: 'f2', kind: 'duplicate', message: 'Duplicate', at: '2026-07-10T10:01:00.000Z' },
        { id: 'f3', kind: 'integrity_mismatch', message: 'Mismatch', at: '2026-07-10T10:02:00.000Z' },
      ],
    }), now, cfg);
    expect(flagged.map((signal) => signal.kind)).toEqual([
      'active',
      'new_device',
      'duplicate',
      'integrity_mismatch',
    ]);
    expect(flagged.at(-1)).toMatchObject({
      severity: 'integrity',
      dismissible: false,
    });
  });

  it('adds regenerate_available when an inactive link already has received client items', () => {
    expect(deriveLinkSignals(intake({
      expiresAt: '2026-07-09T12:00:00.000Z',
      items: [
        { itemId: 'income', label: 'Income', state: 'received' },
        { itemId: 'ssn', label: 'SSN', state: 'not_started' },
      ],
    }), now, cfg).map((signal) => signal.kind)).toEqual([
      'expired',
      'regenerate_available',
    ]);

    expect(deriveLinkSignals(intake({
      status: 'revoked',
      items: [{ itemId: 'income', label: 'Income', state: 'not_started' }],
      receivedItems: [{
        itemId: 'license',
        label: "Driver's license",
        filePath: '/clients/Sarah/license.jpg',
        receivedAt: '2026-07-10T00:00:00.000Z',
        provenance: { channel: 'intake_link', label: 'provided by client', at: '2026-07-10T00:00:00.000Z' },
      }],
    }), now, cfg).map((signal) => signal.kind)).toEqual([
      'revoked',
      'regenerate_available',
    ]);

    expect(deriveLinkSignals(intake({
      expiresAt: '2026-07-09T12:00:00.000Z',
      items: [{ itemId: 'ssn', label: 'SSN', state: 'not_started' }],
      receivedItems: [],
    }), now, cfg).map((signal) => signal.kind)).toEqual(['expired']);
  });

  it('applies nudge cadence, max-unanswered call suggestion, reset on client activity, and next sequence', () => {
    expect(deriveNudgeEligibility(intake(), now, cfg)).toMatchObject({
      eligible: true,
      reason: 'ok',
      nextSequence: 1,
      suggestCall: false,
    });
    expect(deriveNudgeEligibility(intake({
      nudges: [{
        sequence: 1,
        at: '2026-07-08T12:00:00.000Z',
        missingItemIds: ['ssn'],
        auditPairId: 'audit-1',
        channel: 'email_draft',
      }],
    }), now, cfg)).toMatchObject({
      eligible: false,
      reason: 'cadence_wait',
      nextSequence: 2,
      daysUntilEligible: 2,
    });
    expect(deriveNudgeEligibility(intake({
      nudges: [{
        sequence: 1,
        at: '2026-07-05T12:00:00.000Z',
        missingItemIds: ['ssn'],
        auditPairId: 'audit-1',
        channel: 'email_draft',
      }],
    }), now, cfg)).toMatchObject({
      eligible: true,
      reason: 'ok',
      nextSequence: 2,
    });
    expect(deriveNudgeEligibility(intake({
      nudges: [1, 2, 3].map((sequence) => ({
        sequence,
        at: `2026-07-0${String(sequence)}T12:00:00.000Z`,
        missingItemIds: ['ssn'],
        auditPairId: `audit-${String(sequence)}`,
        channel: 'email_draft' as const,
      })),
    }), now, cfg)).toMatchObject({
      eligible: false,
      reason: 'max_unanswered_suggest_call',
      suggestCall: true,
      nextSequence: 4,
    });
    expect(deriveNudgeEligibility(intake({
      lastClientActivityAt: '2026-07-04T12:00:01.000Z',
      nudges: [1, 2, 3].map((sequence) => ({
        sequence,
        at: `2026-07-0${String(sequence)}T12:00:00.000Z`,
        missingItemIds: ['ssn'],
        auditPairId: `audit-${String(sequence)}`,
        channel: 'email_draft' as const,
      })),
    }), now, cfg)).toMatchObject({
      eligible: true,
      reason: 'ok',
      suggestCall: false,
      nextSequence: 4,
    });
  });

  it('blocks nudges when nothing is missing or the link is inactive', () => {
    expect(deriveNudgeEligibility(intake({
      items: [{ itemId: 'ssn', label: 'SSN', state: 'accepted' }],
    }), now, cfg)).toMatchObject({
      eligible: false,
      reason: 'nothing_missing',
    });
    expect(deriveNudgeEligibility(intake({
      status: 'revoked',
    }), now, cfg)).toMatchObject({
      eligible: false,
      reason: 'link_inactive',
    });
  });

  it('does not expose fact values, last-four values, or file names in the read model', () => {
    type ForbiddenRowKeys = Extract<keyof OnboardingRow, 'value' | 'displayValue' | 'fileName' | 'filePath' | 'last4'>;
    const forbiddenRowKeyCheck: Record<ForbiddenRowKeys, never> = {};
    expect(Object.keys(forbiddenRowKeyCheck)).toEqual([]);
    const row = deriveOnboardingRow(intake({
      items: [{
        itemId: 'ssn',
        label: 'Social Security number',
        state: 'received',
        factId: 'fact-ssn',
        filePath: '/clients/Sarah/license-front.png',
        value: '123-45-6789',
        fileName: 'license-front.png',
      } as never],
      receivedItems: [{
        itemId: 'ssn',
        label: 'Social Security number',
        factId: 'fact-ssn',
        filePath: '/clients/Sarah/license-front.png',
        receivedAt: '2026-07-10T00:00:00.000Z',
        provenance: { channel: 'intake_link', label: 'typed by client', at: '2026-07-10T00:00:00.000Z' },
      }],
    }), now, cfg);

    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('123-45-6789');
    expect(serialized).not.toContain('6789');
    expect(serialized).not.toContain('license-front.png');
  });
});

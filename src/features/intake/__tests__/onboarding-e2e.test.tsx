import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '@/platform/types/audit';
import {
  deriveLinkSignals,
  deriveNudgeEligibility,
  deriveOnboardingRow,
  type OnboardingRow,
} from '@/platform/intake/onboardingModel';
import {
  migratePersistedIntakeState,
  partializeIntakeStateForPersistence,
  type IntakeRecord,
  useIntakeStore,
} from '@/platform/intake/intakeStore';
import { DEFAULT_ONBOARDING_CONFIG } from '@/platform/intake/nudgeTypes';
import { buildNudgeDraft } from '@/platform/intake/nudgeDraft';
import { setIntakeNudgeAuditEmitter } from '@/platform/intake/nudgeAudit';
import { OnboardingBoard } from '../OnboardingBoard';
import { NudgeDraftCard } from '../NudgeDraftCard';
import { NudgeReviewModal } from '../NudgeReviewModal';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: invokeMock,
}));

vi.mock('@/features/email/resolveEmailProvider', () => ({
  assertLocalOnlyAllowsSend: vi.fn(),
  resolveEmailProvider: vi.fn(() => Promise.resolve({
    provider: {
      structuredOutput: vi.fn(),
      getMetadata: () => ({ model: 'test-model', providerId: 'openai' }),
    },
    providerId: 'openai',
    assuredAvailable: false,
  })),
}));

const now = new Date('2026-07-10T12:00:00.000Z');

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    intakeId: overrides.intakeId ?? 'intake-e2e',
    matterId: overrides.matterId ?? 'matter-e2e',
    clientFirstName: overrides.clientFirstName ?? 'Sarah',
    clientEmail: overrides.clientEmail ?? 'sarah@example.test',
    firmName: overrides.firmName ?? 'North Star Planning',
    status: overrides.status ?? 'active',
    link: overrides.link ?? 'https://forms.example.test/i/intake-e2e#safe-link',
    expiresAt: overrides.expiresAt ?? '2026-08-09T00:00:00.000Z',
    lastClientActivityAt: overrides.lastClientActivityAt ?? '2026-07-01T12:00:00.000Z',
    checklistVersion: 1,
    items: overrides.items ?? [
      { itemId: 'ssn', label: 'Social Security number', state: 'not_started', factId: 'fact-ssn' },
      { itemId: 'license-back', label: 'License back', state: 'needs_followup', filePath: '/clients/Sarah/license-back-secret.png' },
      { itemId: 'income', label: 'Income documents', state: 'not_started' },
    ],
    receivedItems: overrides.receivedItems ?? [{
      itemId: 'license-front',
      label: 'License front',
      filePath: '/clients/Sarah/license-front-123-45-6789.png',
      factId: 'fact-license',
      receivedAt: '2026-07-09T12:00:00.000Z',
      provenance: { channel: 'intake_link', label: 'typed by client', at: '2026-07-09T12:00:00.000Z' },
    }],
    flags: overrides.flags ?? [],
    knownSessionIds: overrides.knownSessionIds ?? [],
    knownSubmissionIds: overrides.knownSubmissionIds ?? [],
    nudges: overrides.nudges ?? [],
    publicKeyRawB64: overrides.publicKeyRawB64 ?? 'public-key',
    ...overrides,
  };
}

function Harness({ auditSpy }: { auditSpy: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void }) {
  const [openRow, setOpenRow] = useState<OnboardingRow | null>(null);
  const intakesById = useIntakeStore((state) => state.intakesById);
  const intakeForOpenRow = openRow ? intakesById[openRow.requestId] : null;
  setIntakeNudgeAuditEmitter(auditSpy);

  return (
    <>
      <OnboardingBoard
        now={now}
        onOpenNudge={setOpenRow}
        renderNudgeSlot={(row) => {
          const record = intakesById[row.requestId];
          if (!record) return null;
          return (
            <NudgeDraftCard
              row={row}
              intake={record}
              now={now}
              onOpenReview={() => {
                setOpenRow(row);
              }}
            />
          );
        }}
      />
      {openRow && intakeForOpenRow ? (
        <NudgeReviewModal
          open
          row={openRow}
          intake={intakeForOpenRow}
          now={now}
          onOpenChange={() => {
            setOpenRow(null);
          }}
        />
      ) : null}
    </>
  );
}

describe('onboarding nudge cross-lane E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useIntakeStore.getState().resetForTests();
    setIntakeNudgeAuditEmitter(null);
    invokeMock.mockImplementation((command: string) => {
      if (command === 'mail_connected_accounts') {
        return Promise.resolve([{ provider: 'm365', account: 'default', label: 'Microsoft 365' }]);
      }
      if (command === 'mail_save_draft') return Promise.resolve('draft-id-e2e');
      if (command === 'mail_send') return Promise.reject(new Error('mail_send must never be called'));
      return Promise.resolve(null);
    });
  });

  it('runs store to model to board to draft save to audit, then blocks again after restart', async () => {
    const record = intake();
    useIntakeStore.getState().upsertIntake(record);
    const auditSpy = vi.fn((entry: Omit<AuditEntry, 'id' | 'timestamp'>) => entry);

    const row = deriveOnboardingRow(record, now, DEFAULT_ONBOARDING_CONFIG);
    expect(row.nudgeEligibility).toMatchObject({ eligible: true, reason: 'ok' });

    render(<Harness auditSpy={auditSpy} />);
    fireEvent.click(screen.getByTestId('onboarding-row-nudge-intake-e2e'));
    await screen.findByTestId('nudge-review-body');
    fireEvent.click(screen.getByTestId('nudge-save-draft'));

    await waitFor(() => {
      expect(invokeMock.mock.calls.some((call) => call[0] === 'mail_save_draft')).toBe(true);
    });
    expect(invokeMock.mock.calls.some((call) => call[0] === 'mail_send')).toBe(false);
    await waitFor(() => {
      expect(auditSpy).toHaveBeenCalledTimes(2);
    });

    const stored = useIntakeStore.getState().intakesById['intake-e2e'];
    expect(stored?.nudges).toHaveLength(1);
    if (!stored) throw new Error('Missing stored intake.');
    expect(deriveNudgeEligibility(stored, now, DEFAULT_ONBOARDING_CONFIG)).toMatchObject({
      eligible: false,
      reason: 'cadence_wait',
    });

    const persisted = partializeIntakeStateForPersistence(useIntakeStore.getState());
    useIntakeStore.getState().resetForTests();
    const rehydrated = migratePersistedIntakeState(persisted, 2);
    useIntakeStore.setState({ intakesById: rehydrated.intakesById as Record<string, IntakeRecord> });
    const afterRestart = useIntakeStore.getState().intakesById['intake-e2e'];

    if (!afterRestart) throw new Error('Missing rehydrated intake.');
    expect(deriveNudgeEligibility(afterRestart, now, DEFAULT_ONBOARDING_CONFIG)).toMatchObject({
      eligible: false,
      reason: 'cadence_wait',
    });
  });

  it('keeps restricted facts out of board rows, nudge drafts, and link signals', () => {
    const record = intake({
      items: [
        {
          itemId: 'ssn',
          label: 'Social Security number',
          state: 'not_started',
          factId: 'fact-ssn',
          value: '123-45-6789',
          last4: '6789',
        } as never,
        {
          itemId: 'license-back',
          label: 'License back',
          state: 'needs_followup',
          filePath: '/clients/Sarah/license-back-secret.png',
          fileName: 'license-back-secret.png',
        } as never,
        {
          itemId: 'assets',
          label: 'Asset statement',
          state: 'not_started',
          amount: '$987,654.32',
        } as never,
      ],
      flags: [{
        id: 'flag-1',
        kind: 'new_device',
        message: 'New device for client',
        at: '2026-07-10T10:00:00.000Z',
      }],
    });
    const row = deriveOnboardingRow(record, now, DEFAULT_ONBOARDING_CONFIG);
    const draft = buildNudgeDraft(row, record, DEFAULT_ONBOARDING_CONFIG);
    const linkSignals = deriveLinkSignals(record, now, DEFAULT_ONBOARDING_CONFIG);
    const combined = JSON.stringify({ row, draft, linkSignals });

    expect(combined).not.toContain('123-45-6789');
    expect(combined).not.toContain('6789');
    expect(combined).not.toContain('$987,654.32');
    expect(combined).not.toContain('license-back-secret.png');
  });
});

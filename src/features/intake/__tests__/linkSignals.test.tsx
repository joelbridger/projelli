import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { IntakeRecord } from '@/platform/intake/intakeStore';
import type {
  LinkSignal,
  LinkSignalKind,
} from '@/platform/intake/onboardingModel';
import { IntakeRelayClient } from '@/platform/intake/IntakeRelayClient';
import { OnboardingTab } from '../OnboardingTab';
import { LinkLifecyclePanel } from '../LinkLifecyclePanel';
import { LinkSignalBadge } from '../LinkSignalBadge';

const relaySpies = vi.hoisted(() => ({
  fetchInbox: vi.fn(),
}));

vi.mock('@/platform/intake/IntakeRelayClient', () => ({
  IntakeRelayClient: vi.fn(() => ({
    fetchInbox: relaySpies.fetchInbox,
  })),
}));

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactList: vi.fn(() => Promise.resolve([])),
  intakeFactReveal: vi.fn(),
  intakeFactPurge: vi.fn(),
  intakeFactUpsert: vi.fn(),
}));

const now = new Date('2026-07-10T12:00:00.000Z');

function intake(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  const { lastClientActivityAt, ...rest } = overrides;
  return {
    intakeId: overrides.intakeId ?? 'intake-1',
    matterId: overrides.matterId ?? 'matter-1',
    clientFirstName: overrides.clientFirstName ?? 'Sarah',
    firmName: 'North Star Planning',
    status: overrides.status ?? 'active',
    link: overrides.link ?? 'https://forms.example.test/i/intake-1#secret',
    expiresAt: overrides.expiresAt ?? '2026-08-09T00:00:00.000Z',
    ...(lastClientActivityAt !== undefined ? { lastClientActivityAt } : {}),
    checklistVersion: 1,
    items: overrides.items ?? [
      { itemId: 'tax-return', label: 'Tax return', state: 'not_started' },
    ],
    receivedItems: overrides.receivedItems ?? [],
    flags: overrides.flags ?? [],
    knownSessionIds: overrides.knownSessionIds ?? [],
    knownSubmissionIds: overrides.knownSubmissionIds ?? [],
    nudges: overrides.nudges ?? [],
    publicKeyRawB64: 'public-key',
    checklistCiphertextB64: 'checklist',
    stateCiphertextB64: 'state',
    ...rest,
  };
}

const signalCases: Array<{
  kind: LinkSignalKind;
  severity: LinkSignal['severity'];
  label: string;
  badgeClass: string;
}> = [
  {
    kind: 'active',
    severity: 'info',
    label: 'Link active',
    badgeClass: 'kp-badge--neutral',
  },
  {
    kind: 'expires_soon',
    severity: 'attention',
    label: 'Link expiring soon',
    badgeClass: 'kp-badge--warning',
  },
  {
    kind: 'expired',
    severity: 'attention',
    label: 'Link expired',
    badgeClass: 'kp-badge--warning',
  },
  {
    kind: 'revoked',
    severity: 'attention',
    label: 'Link turned off',
    badgeClass: 'kp-badge--warning',
  },
  {
    kind: 'new_device',
    severity: 'attention',
    label: 'New device',
    badgeClass: 'kp-badge--warning',
  },
  {
    kind: 'duplicate',
    severity: 'attention',
    label: 'Duplicate received',
    badgeClass: 'kp-badge--warning',
  },
  {
    kind: 'integrity_mismatch',
    severity: 'integrity',
    label: 'Check submission',
    badgeClass: 'kp-badge--danger',
  },
  {
    kind: 'regenerate_available',
    severity: 'info',
    label: 'New link available',
    badgeClass: 'kp-badge--neutral',
  },
];

describe('link lifecycle signals', () => {
  it.each(signalCases)(
    'renders the $kind badge with the right tone and copy',
    ({ kind, severity, label, badgeClass }) => {
      render(
        <LinkSignalBadge
          signal={{
            kind,
            severity,
            dismissible: severity === 'info',
            at: '2026-07-10T12:00:00.000Z',
          }}
        />
      );

      const badge = screen.getByTestId(`link-signal-badge-${kind}`);
      expect(badge.textContent).toContain(label);
      expect(badge.className).toContain(badgeClass);
    }
  );

  it('lets dismissible info signals hide from the local notes list', () => {
    render(
      <LinkLifecyclePanel
        intake={intake()}
        now={now}
        onCopyLink={vi.fn()}
      />
    );

    expect(screen.getByTestId('link-signal-detail-active')).toBeTruthy();
    fireEvent.click(
      within(screen.getByTestId('link-signal-detail-active')).getByLabelText(
        'Dismiss'
      )
    );

    expect(screen.queryByTestId('link-signal-detail-active')).toBeNull();
  });

  it('keeps revoked and integrity signals visible until the link state changes', () => {
    render(
      <LinkLifecyclePanel
        intake={intake({
          status: 'revoked',
          receivedItems: [
            {
              itemId: 'tax-return',
              label: 'Tax return',
              receivedAt: '2026-07-10T00:00:00.000Z',
              provenance: {
                channel: 'intake_link',
                label: 'typed by client',
                at: '2026-07-10T00:00:00.000Z',
              },
            },
          ],
          flags: [
            {
              id: 'flag-integrity',
              kind: 'integrity_mismatch',
              message: 'Sealed payload did not match.',
              at: '2026-07-10T10:00:00.000Z',
            },
          ],
        })}
        now={now}
        onCopyLink={vi.fn()}
      />
    );

    expect(
      within(screen.getByTestId('link-signal-detail-revoked')).queryByLabelText(
        'Dismiss'
      )
    ).toBeNull();
    expect(
      within(
        screen.getByTestId('link-signal-detail-integrity_mismatch')
      ).queryByLabelText('Dismiss')
    ).toBeNull();
    expect(screen.getByTestId('link-signal-detail-regenerate_available')).toBeTruthy();
  });

  it('renders details without submitted values, file names, or last four fragments', () => {
    render(
      <LinkLifecyclePanel
        intake={intake({
          expiresAt: '2026-07-10T11:59:00.000Z',
          items: [
            {
              itemId: 'ssn',
              label: 'Social Security number',
              state: 'received',
              filePath: '/clients/Sarah/secret-ssn-1234.pdf',
              factId: 'fact-ssn',
              provenance: {
                channel: 'intake_link',
                label: 'typed by client',
                at: '2026-07-10T00:00:00.000Z',
              },
            },
          ],
          receivedItems: [
            {
              itemId: 'ssn',
              label: 'Social Security number',
              filePath: '/clients/Sarah/secret-ssn-1234.pdf',
              factId: 'fact-ssn',
              receivedAt: '2026-07-10T00:00:00.000Z',
              provenance: {
                channel: 'intake_link',
                label: 'typed by client',
                at: '2026-07-10T00:00:00.000Z',
              },
            },
          ],
        })}
        now={now}
        onCopyLink={vi.fn()}
      />
    );

    const text = screen.getByTestId('link-lifecycle-panel').textContent ?? '';
    expect(text).not.toContain('secret-ssn-1234.pdf');
    expect(text).not.toContain('1234');
    expect(text).not.toContain('/clients/Sarah');
  });

  it('keeps the Wave 1 link controls one click from the onboarding tab', async () => {
    const onCopyLink = vi.fn(() => Promise.resolve());
    const onExtend = vi.fn(() => Promise.resolve());
    const onRegenerate = vi.fn(() => Promise.resolve());
    const onRevoke = vi.fn(() => Promise.resolve());

    render(
      <LinkLifecyclePanel
        intake={intake()}
        now={now}
        onCopyLink={onCopyLink}
        onExtend={onExtend}
        onRegenerate={onRegenerate}
        onRevoke={onRevoke}
      />
    );

    fireEvent.click(screen.getByTestId('link-action-copy'));
    await waitFor(() => {
      expect(onCopyLink).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('link-action-extend'));
    await waitFor(() => {
      expect(onExtend).toHaveBeenCalledWith('intake-1');
    });

    fireEvent.click(screen.getByTestId('link-action-regenerate'));
    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith('intake-1');
    });

    fireEvent.click(screen.getByTestId('link-action-revoke'));
    await waitFor(() => {
      expect(onRevoke).toHaveBeenCalledWith('intake-1');
    });
  });

  it('mounts the lifecycle panel inside the per-client onboarding tab', async () => {
    render(<OnboardingTab matterId="matter-1" intake={intake()} />);

    expect(await screen.findByTestId('link-lifecycle-panel')).toBeTruthy();
    expect(screen.getByTestId('link-action-copy')).toBeTruthy();
    expect(screen.getByTestId('link-action-extend')).toBeTruthy();
    expect(screen.getByTestId('link-action-regenerate')).toBeTruthy();
    expect(screen.getByTestId('link-action-revoke')).toBeTruthy();
  });

  it('renders from local state without calling the intake relay', () => {
    render(
      <LinkLifecyclePanel
        intake={intake({
          flags: [
            {
              id: 'flag-device',
              kind: 'new_device',
              message: 'New device.',
              at: '2026-07-10T10:00:00.000Z',
            },
          ],
        })}
        now={now}
        onCopyLink={vi.fn()}
      />
    );

    expect(IntakeRelayClient).not.toHaveBeenCalled();
    expect(relaySpies.fetchInbox).not.toHaveBeenCalled();
  });
});

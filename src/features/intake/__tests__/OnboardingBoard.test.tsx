import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { EV_MATTER_LAUNCH } from '@/config/identity';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  useIntakeStore,
  type IntakeRecord,
} from '@/platform/intake/intakeStore';
import { OnboardingBoard } from '../OnboardingBoard';

const now = new Date('2026-07-10T12:00:00.000Z');

function intake(overrides: Partial<IntakeRecord>): IntakeRecord {
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
    items: overrides.items ?? [],
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

function seedBoard(): void {
  const store = useIntakeStore.getState();
  store.upsertIntake(intake({
    intakeId: 'intake-complete',
    matterId: 'matter-priya',
    clientFirstName: 'Priya',
    lastClientActivityAt: '2026-07-10T09:00:00.000Z',
    items: [
      { itemId: 'dob', label: 'Date of birth', state: 'accepted' },
      { itemId: 'income', label: 'Income', state: 'accepted' },
    ],
  }));
  store.upsertIntake(intake({
    intakeId: 'intake-stalled',
    matterId: 'matter-ruiz',
    clientFirstName: 'Marcus and Lena',
    lastClientActivityAt: '2026-07-01T12:00:00.000Z',
    items: [
      {
        itemId: 'ssn-lena',
        label: 'Social Security number for Lena',
        state: 'not_started',
        factId: 'fact-ssn-lena',
      },
      {
        itemId: 'license-back',
        label: 'License back',
        state: 'needs_followup',
        filePath: '/clients/Ruiz/license-back-123-45-6789.png',
      },
      {
        itemId: 'income-docs',
        label: 'Income documents',
        state: 'not_started',
      },
    ],
    receivedItems: [{
      itemId: 'license-front',
      label: 'License front',
      filePath: '/clients/Ruiz/marcus-license-front.png',
      receivedAt: '2026-07-02T12:00:00.000Z',
      provenance: {
        channel: 'intake_link',
        label: 'typed by client',
        at: '2026-07-02T12:00:00.000Z',
      },
    }],
  }));
  store.upsertIntake(intake({
    intakeId: 'intake-review',
    matterId: 'matter-sarah',
    clientFirstName: 'Sarah',
    lastClientActivityAt: '2026-07-08T12:00:00.000Z',
    items: [
      {
        itemId: 'license-front',
        label: 'License front',
        state: 'received',
        factId: 'fact-license',
        filePath: '/clients/Sarah/secret-license-front.png',
      },
      { itemId: 'spending', label: 'Spending', state: 'not_started' },
    ],
  }));
}

describe('OnboardingBoard', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    useMatterStore.setState({
      activeMatterId: null,
      clientMapHubId: null,
      clientMapHubTab: null,
    });
  });

  it('sorts active onboarding rows, shows safe labels, and exposes row actions', () => {
    seedBoard();

    render(<OnboardingBoard now={now} />);

    const rows = screen.getAllByTestId(/^onboarding-board-row-/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual([
      'onboarding-board-row-intake-review',
      'onboarding-board-row-intake-stalled',
      'onboarding-board-row-intake-complete',
    ]);

    expect(screen.getByText('Spending')).toBeTruthy();
    expect(screen.getByText('License back')).toBeTruthy();
    expect(screen.getByText('Income documents')).toBeTruthy();
    expect(
      screen
        .getByTestId('onboarding-board-row-intake-stalled')
        .getAttribute('data-stalled'),
    ).toBe('true');
    expect(screen.getByText('STALLED 9 days')).toBeTruthy();
    expect(screen.getByText('review 1 new item')).toBeTruthy();
    expect(screen.getByText('nudge ready')).toBeTruthy();

    for (const id of ['intake-review', 'intake-stalled', 'intake-complete']) {
      expect(screen.getByTestId(`onboarding-row-open-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`onboarding-row-review-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`onboarding-row-nudge-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`onboarding-row-copy-link-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`onboarding-row-link-signals-${id}`)).toBeTruthy();
    }

    const boardText = screen.getByTestId('onboarding-board').textContent ?? '';
    expect(boardText).not.toContain('123-45-6789');
    expect(boardText).not.toContain('6789');
    expect(boardText).not.toContain('secret-license-front.png');
    expect(boardText).not.toContain('marcus-license-front.png');
  });

  it('opens the clicked client on the Onboarding tab', () => {
    seedBoard();
    const launches: Array<{ matterId?: string; surface?: string }> = [];
    const onLaunch = (event: Event) => {
      launches.push((event as CustomEvent<{ matterId?: string; surface?: string }>).detail);
    };
    window.addEventListener(EV_MATTER_LAUNCH, onLaunch);

    render(<OnboardingBoard now={now} />);
    fireEvent.click(screen.getByTestId('onboarding-board-row-intake-stalled'));

    expect(useMatterStore.getState().clientMapHubTab).toBe('onboarding');
    expect(launches).toEqual([{ matterId: 'matter-ruiz', surface: 'matters' }]);

    window.removeEventListener(EV_MATTER_LAUNCH, onLaunch);
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EV_MATTER_LAUNCH } from '@/config/identity';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  useIntakeStore,
  type IntakeRecord,
} from '@/platform/intake/intakeStore';
import { reconstructAdvisorIntakeLink } from '@/platform/intake/advisorIntakeLink';
import { OnboardingBoard } from '../OnboardingBoard';

vi.mock('@/platform/intake/advisorIntakeLink', () => ({
  reconstructAdvisorIntakeLink: vi.fn(),
}));

const now = new Date('2026-07-10T12:00:00.000Z');
const reconstructAdvisorIntakeLinkMock = vi.mocked(
  reconstructAdvisorIntakeLink
);

function getButton(testId: string): HTMLButtonElement {
  const element = screen.getByTestId(testId);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`${testId} is not a button.`);
  }
  return element;
}

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
  store.upsertIntake(
    intake({
      intakeId: 'intake-complete',
      matterId: 'matter-priya',
      clientFirstName: 'Priya',
      lastClientActivityAt: '2026-07-10T09:00:00.000Z',
      items: [
        { itemId: 'dob', label: 'Date of birth', state: 'accepted' },
        { itemId: 'income', label: 'Income', state: 'accepted' },
      ],
    })
  );
  store.upsertIntake(
    intake({
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
      receivedItems: [
        {
          itemId: 'license-front',
          label: 'License front',
          filePath: '/clients/Ruiz/marcus-license-front.png',
          receivedAt: '2026-07-02T12:00:00.000Z',
          provenance: {
            channel: 'intake_link',
            label: 'typed by client',
            at: '2026-07-02T12:00:00.000Z',
          },
        },
      ],
    })
  );
  store.upsertIntake(
    intake({
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
    })
  );
}

describe('OnboardingBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        .getAttribute('data-stalled')
    ).toBe('true');
    expect(screen.getByText('STALLED 9 days')).toBeTruthy();
    expect(screen.getByText('review 1 new item')).toBeTruthy();
    expect(screen.getByText('nudge ready')).toBeTruthy();

    for (const id of ['intake-review', 'intake-stalled', 'intake-complete']) {
      expect(screen.getByTestId(`onboarding-row-open-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`onboarding-row-review-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`onboarding-row-nudge-${id}`)).toBeTruthy();
      expect(screen.getByTestId(`onboarding-row-copy-link-${id}`)).toBeTruthy();
      expect(
        screen.getByTestId(`onboarding-row-link-signals-${id}`)
      ).toBeTruthy();
    }
    expect(getButton('onboarding-row-nudge-intake-stalled').disabled).toBe(
      true
    );
    expect(
      getButton('onboarding-row-link-signals-intake-stalled').disabled
    ).toBe(true);

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
      launches.push(
        (event as CustomEvent<{ matterId?: string; surface?: string }>).detail
      );
      useMatterStore.getState().setClientMapHubTab('overview');
    };
    window.addEventListener(EV_MATTER_LAUNCH, onLaunch);

    render(<OnboardingBoard now={now} />);
    fireEvent.click(screen.getByTestId('onboarding-board-row-intake-stalled'));

    expect(useMatterStore.getState().clientMapHubTab).toBe('onboarding');
    expect(launches).toEqual([{ matterId: 'matter-ruiz', surface: 'matters' }]);

    window.removeEventListener(EV_MATTER_LAUNCH, onLaunch);
  });

  it('rebuilds and copies a saved intake link when the stored link is absent', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    reconstructAdvisorIntakeLinkMock.mockResolvedValue(
      'https://forms.example.test/i/intake-rebuild#rebuilt'
    );
    const savedRecord = intake({
      intakeId: 'intake-rebuild',
      matterId: 'matter-rebuild',
      clientFirstName: 'Devon',
      publicKeyRawB64: 'public-key-rebuild',
      items: [{ itemId: 'income', label: 'Income', state: 'not_started' }],
    });
    delete savedRecord.link;
    useIntakeStore.getState().upsertIntake(savedRecord);

    render(<OnboardingBoard now={now} />);
    fireEvent.click(
      screen.getByTestId('onboarding-row-copy-link-intake-rebuild')
    );

    await waitFor(() => {
      expect(reconstructAdvisorIntakeLinkMock).toHaveBeenCalledWith({
        intakeId: 'intake-rebuild',
        publicKeyRawB64: 'public-key-rebuild',
      });
      expect(writeText).toHaveBeenCalledWith(
        'https://forms.example.test/i/intake-rebuild#rebuilt'
      );
      expect(
        screen.getByTestId('onboarding-row-copy-link-intake-rebuild')
          .textContent
      ).toContain('Copied');
    });
  });

  it('keeps child button keyboard events from opening the row', () => {
    seedBoard();
    const launches: Array<{ matterId?: string; surface?: string }> = [];
    const onLaunch = (event: Event) => {
      launches.push(
        (event as CustomEvent<{ matterId?: string; surface?: string }>).detail
      );
    };
    window.addEventListener(EV_MATTER_LAUNCH, onLaunch);

    render(<OnboardingBoard now={now} />);
    fireEvent.keyDown(
      screen.getByTestId('onboarding-row-copy-link-intake-stalled'),
      {
        key: 'Enter',
      }
    );
    fireEvent.keyDown(
      screen.getByTestId('onboarding-row-copy-link-intake-stalled'),
      {
        key: ' ',
      }
    );

    expect(launches).toEqual([]);
    expect(useMatterStore.getState().clientMapHubTab).toBeNull();

    window.removeEventListener(EV_MATTER_LAUNCH, onLaunch);
  });

  it('enables future row actions when their handlers are wired', () => {
    seedBoard();

    render(
      <OnboardingBoard
        now={now}
        onOpenNudge={() => undefined}
        onOpenLinkSignals={() => undefined}
      />
    );

    expect(getButton('onboarding-row-nudge-intake-stalled').disabled).toBe(
      false
    );
    expect(
      getButton('onboarding-row-link-signals-intake-stalled').disabled
    ).toBe(false);
  });
});

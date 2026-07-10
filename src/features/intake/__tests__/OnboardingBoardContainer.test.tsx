import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIntakeStore, type IntakeRecord } from '@/platform/intake/intakeStore';
import { reconstructAdvisorIntakeLink } from '@/platform/intake/advisorIntakeLink';
import { OnboardingBoardContainer } from '../OnboardingBoardContainer';

vi.mock('@/platform/intake/advisorIntakeLink', () => ({
  reconstructAdvisorIntakeLink: vi.fn(),
}));

const now = new Date('2026-07-10T12:00:00.000Z');

function eligibleIntake(): IntakeRecord {
  return {
    intakeId: 'intake-nudge',
    matterId: 'matter-nudge',
    clientFirstName: 'Sarah',
    clientEmail: 'sarah@example.test',
    firmName: 'North Star Planning',
    status: 'active',
    link: 'https://forms.example.test/i/intake-nudge#secret',
    expiresAt: '2026-08-09T00:00:00.000Z',
    lastClientActivityAt: '2026-07-01T12:00:00.000Z', // stalled ~9 days
    checklistVersion: 1,
    items: [
      { itemId: 'ssn', label: 'Social Security number', state: 'not_started' },
      { itemId: 'income', label: 'Income', state: 'not_started' },
    ],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
    publicKeyRawB64: 'public-key',
    checklistCiphertextB64: 'checklist',
    stateCiphertextB64: 'state',
  };
}

describe('OnboardingBoardContainer', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    vi.mocked(reconstructAdvisorIntakeLink).mockResolvedValue(
      'https://forms.example.test/i/intake-nudge#secret'
    );
  });

  it('surfaces a nudge draft for an eligible row and opens the review modal', async () => {
    useIntakeStore.getState().upsertIntake(eligibleIntake());

    render(<OnboardingBoardContainer now={now} />);

    // The inline nudge card is reachable for the eligible client (Lane-3
    // integration: the board slot is wired, not a dead button).
    const openButton = await screen.findByTestId(
      'nudge-draft-card-open-intake-nudge'
    );
    fireEvent.click(openButton);

    // The review modal (draft-only; never sends) is now on screen.
    await waitFor(() => {
      expect(screen.getByTestId('nudge-review-modal')).toBeTruthy();
    });
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OnboardingTab } from './OnboardingTab';
import { intakeFactList, intakeFactPurge } from '@/platform/intake/factsStore';

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactList: vi.fn(() =>
    Promise.resolve([
      {
        fact_id: 'fact-1',
        matter_id: 'matter-1',
        subject: 'primary',
        kind: 'ssn',
        sensitivity: 'restricted',
        display_value: '•••-••-6789',
        provenance: {
          channel: 'intake_link',
          entered_by: 'client',
          at: '2026-07-10T00:00:00.000Z',
        },
        verification: 'client_stated',
        status: 'active',
      },
    ])
  ),
  intakeFactReveal: vi.fn(),
  intakeFactPurge: vi.fn(() => Promise.resolve(['fact-1'])),
  intakeFactUpsert: vi.fn(),
}));

describe('OnboardingTab', () => {
  it('renders provenance chips and masked facts', async () => {
    render(
      <OnboardingTab
        matterId="matter-1"
        intake={{
          intakeId: 'intake-1',
          matterId: 'matter-1',
          clientFirstName: 'Sarah',
          firmName: 'North Star',
          status: 'active',
          link: 'https://forms.example.test/i/intake-1#secret',
          expiresAt: '2026-08-09T00:00:00.000Z',
          checklistVersion: 1,
          items: [
            {
              itemId: 'ssn',
              label: 'Social Security number',
              state: 'received',
              provenance: {
                channel: 'intake_link',
                label: 'typed by client',
                at: '2026-07-10T00:00:00.000Z',
              },
              factId: 'fact-1',
            },
            {
              itemId: 'income',
              label: 'Income',
              state: 'received',
              provenance: {
                channel: 'manual',
                label: 'manual',
                at: '2026-07-10T00:00:00.000Z',
              },
            },
          ],
          receivedItems: [],
          flags: [],
          knownSessionIds: [],
          knownSubmissionIds: [],
          nudges: [],
        }}
      />
    );

    expect(await screen.findByText('•••-••-6789')).toBeTruthy();
    expect(screen.getAllByText('typed by client').length).toBeGreaterThan(0);
    expect(screen.getByText('manual')).toBeTruthy();
  });

  it('purges only the selected fact id', async () => {
    render(
      <OnboardingTab
        matterId="matter-1"
        intake={{
          intakeId: 'intake-1',
          matterId: 'matter-1',
          clientFirstName: 'Sarah',
          firmName: 'North Star',
          status: 'active',
          link: 'https://forms.example.test/i/intake-1#secret',
          expiresAt: '2026-08-09T00:00:00.000Z',
          checklistVersion: 1,
          items: [],
          receivedItems: [],
          flags: [],
          knownSessionIds: [],
          knownSubmissionIds: [],
          nudges: [],
        }}
      />
    );

    fireEvent.click(await screen.findByLabelText('Purge fact'));

    await waitFor(() => {
      expect(intakeFactPurge).toHaveBeenCalledWith('matter-1', 'fact-1');
    });
    expect(intakeFactPurge).not.toHaveBeenCalledWith('matter-2', 'fact-1');
  });

  it('labels phone-walkthrough facts as entered by you on a call', async () => {
    vi.mocked(intakeFactList).mockResolvedValueOnce([
      {
        fact_id: 'fact-phone-1', matter_id: 'matter-1', subject: 'primary',
        kind: 'income_annual', sensitivity: 'confidential', display_value: 'USD 120000',
        provenance: {
          channel: 'phone_walkthrough', entered_by: 'advisor-1', at: '2026-07-10T12:00:00.000Z',
        },
        verification: 'advisor_confirmed', status: 'active',
      },
    ]);

    render(<OnboardingTab matterId="matter-1" intake={{
      intakeId: 'intake-1', matterId: 'matter-1', clientFirstName: 'Sarah', firmName: 'North Star',
      status: 'active', expiresAt: '2026-08-09T00:00:00.000Z', checklistVersion: 1,
      items: [], receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [],
    }} />);

    expect(await screen.findByText('entered by you on a call')).toBeTruthy();
  });
});

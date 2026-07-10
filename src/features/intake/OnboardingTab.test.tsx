import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OnboardingTab } from './OnboardingTab';

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactList: vi.fn(async () => [
    {
      fact_id: 'fact-1',
      matter_id: 'matter-1',
      subject: 'primary',
      kind: 'ssn',
      sensitivity: 'restricted',
      display_value: '•••-••-6789',
      provenance: { channel: 'intake_link', entered_by: 'client', at: '2026-07-10T00:00:00.000Z' },
      verification: 'client_stated',
      status: 'active',
    },
  ]),
  intakeFactReveal: vi.fn(),
  intakeFactPurge: vi.fn(),
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
        }}
      />,
    );

    expect(await screen.findByText('•••-••-6789')).toBeTruthy();
    expect(screen.getAllByText('typed by client').length).toBeGreaterThan(0);
    expect(screen.getByText('manual')).toBeTruthy();
  });
});

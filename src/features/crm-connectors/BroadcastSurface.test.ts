import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const live = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  save: vi.fn(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: live.records,
    save: live.save,
    error: null,
  }),
}));

vi.mock('@/platform/utils/mail-commands', () => ({
  mailConnectedAccounts: vi.fn().mockResolvedValue([]),
  mailSend: vi.fn(),
}));

import {
  CrmBroadcastSurface,
  recipientsForHouseholds,
  verifyRecipientOnHousehold,
} from './BroadcastSurface';

describe('email broadcast recipients', () => {
  beforeEach(() => {
    live.records = [];
    live.save.mockReset();
    live.save.mockImplementation((record: LiveCrmRecord) => Promise.resolve(record));
  });

  it('includes only verified email recipients and removes duplicates', () => {
    const recipients = recipientsForHouseholds([
      {
        id: 'household-a',
        kind: 'household',
        name: 'Avery household',
        members: [
          {
            id: 'ava',
            name: 'Ava Avery',
            verifiedAt: '2026-07-12',
            emails: [{ address: 'ava@example.test' }],
          },
          {
            id: 'unverified',
            name: 'Unverified Avery',
            emails: [{ address: 'no@example.test' }],
          },
        ],
      },
      {
        id: 'household-b',
        kind: 'household',
        name: 'Baker household',
        externalParties: [
          {
            id: 'duplicate',
            name: 'Duplicate',
            verifiedAt: '2026-07-12',
            emails: [{ address: 'AVA@example.test' }],
          },
        ],
      },
    ]);
    expect(recipients).toEqual([
      expect.objectContaining({
        personName: 'Ava Avery',
        email: 'ava@example.test',
      }),
    ]);
  });

  it('accepts the newer verified-recipient link even when the person lacks legacy verification fields', () => {
    expect(
      recipientsForHouseholds([
        {
          id: 'household-a',
          kind: 'household',
          name: 'Avery household',
          members: [
            {
              id: 'ava',
              name: 'Ava Avery',
              verifiedRecipient: {
                verified: true,
                channel: 'email',
                address: 'ava@example.test',
              },
            },
          ],
        },
      ])
    ).toEqual([expect.objectContaining({ email: 'ava@example.test' })]);
  });

  it('persists an explicit recipient review into the household record that the send guard reads', async () => {
    const household = {
      id: 'household-a',
      kind: 'household',
      name: 'Avery household',
      members: [
        {
          id: 'ava',
          name: 'Ava Avery',
          emails: [{ address: 'ava@example.test', primary: true }],
        },
      ],
    };
    live.records = [
      household,
      {
        id: 'view-a',
        kind: 'savedView',
        surface: 'households',
        name: 'Avery list',
        query: { entity: 'household', filters: [], sort: [] },
      },
    ];

    render(createElement(CrmBroadcastSurface));
    fireEvent.change(screen.getByTestId('crm-broadcast-view'), {
      target: { value: 'view-a' },
    });
    fireEvent.click(screen.getByTestId('crm-broadcast-review-household-a:ava'));

    expect(screen.getByTestId('crm-broadcast-review-dialog')).toHaveTextContent(
      'ava@example.test'
    );
    fireEvent.click(screen.getByTestId('crm-broadcast-confirm-recipient'));

    await waitFor(() => {
      expect(live.save).toHaveBeenCalledTimes(1);
    });
    const saved = live.save.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(recipientsForHouseholds([saved as LiveCrmRecord])).toEqual([
      expect.objectContaining({
        personName: 'Ava Avery',
        email: 'ava@example.test',
      }),
    ]);
  });

  it('rejects a review write when the selected person is no longer in the household', () => {
    expect(() =>
      verifyRecipientOnHousehold(
        { id: 'household-a', kind: 'household', members: [] },
        {
          id: 'household-a:ava',
          personId: 'ava',
          householdId: 'household-a',
          householdName: 'Avery household',
          personName: 'Ava Avery',
          email: 'ava@example.test',
          collection: 'members',
        },
        '2026-07-13T00:00:00.000Z'
      )
    ).toThrow('no longer in the selected client list');
  });
});

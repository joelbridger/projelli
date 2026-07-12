import { describe, expect, it } from 'vitest';
import { recipientsForHouseholds } from './BroadcastSurface';

describe('email broadcast recipients', () => {
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
});

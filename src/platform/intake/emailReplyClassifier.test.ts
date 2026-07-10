import { describe, expect, it } from 'vitest';

import { isEmailReplyProposalItemSelectable } from './emailReplyProposalStore';
import { classifyEmailReplyCandidate } from './emailReplyClassifier';

const candidate = {
  kind: 'candidate' as const,
  messageId: 'message-1',
  provider: 'm365',
  account: 'advisor@example.com',
  received: '2026-07-10T10:00:00.000Z',
  sender: 'sarah@example.com',
  authResult: {
    dkim: 'pass' as const,
    spf: 'pass' as const,
    dmarc: 'pass' as const,
    aligned: true,
    source: 'graph' as const,
  },
  threadId: 'thread-1',
  matchedMatterId: 'matter-1',
  matchedRequestId: 'intake-1',
  targetOpenItemIds: ['license'],
  confidenceEligible: true,
  attachments: [],
};

describe('emailReplyClassifier', () => {
  it('routes a body-only match to manual review instead of offering an unfilable selection', async () => {
    const rows = await classifyEmailReplyCandidate({
      candidate,
      openItems: [
        {
          itemId: 'license',
          label: "Driver's license",
          state: 'not_started',
        },
      ],
      bodyText: 'I will send my driver license this afternoon.',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'body_fact',
      checkedByDefault: false,
    });
    expect(isEmailReplyProposalItemSelectable(rows[0]!)).toBe(false);
  });
});

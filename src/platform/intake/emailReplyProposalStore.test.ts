import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearInMemoryEmailReplyQueuesForTests,
  emailReplyProposalList,
  emailReplyProposalSave,
  emailReplyQuarantineList,
  emailReplyQuarantineSave,
  stableEmailReplyId,
  type EmailReplyProposalInput,
} from './emailReplyProposalStore';

const auth = {
  dkim: 'pass' as const,
  spf: 'pass' as const,
  dmarc: 'pass' as const,
  aligned: true,
  source: 'graph' as const,
};

function proposal(messageId = 'msg-1'): EmailReplyProposalInput {
  return {
    proposalId: stableEmailReplyId('proposal', {
      provider: 'm365',
      account: 'advisor@example.com',
      messageId,
    }),
    messageId,
    provider: 'm365',
    account: 'advisor@example.com',
    received: '2026-07-10T10:00:00.000Z',
    sender: 'sarah@example.com',
    authResult: auth,
    threadId: 'thread-1',
    matchedMatterId: 'matter-1',
    matchedRequestId: 'intake-1',
    targetOpenItemIds: ['ssn'],
    attachmentRefs: [],
    confidence: 'high',
    items: [
      {
        id: 'fact-row',
        kind: 'body_fact',
        itemId: 'ssn',
        label: 'Social Security number',
        confidence: 'high',
        checkedByDefault: false,
        bodyFact: {
          subject: 'primary',
          kind: 'ssn',
          sensitivity: 'restricted',
          displayValue: '',
          value: { t: 'string', v: '123-45-6789' },
        },
      },
    ],
  };
}

describe('emailReplyProposalStore', () => {
  beforeEach(() => {
    clearInMemoryEmailReplyQueuesForTests();
  });

  it('returns masked proposal reads without restricted values', async () => {
    await emailReplyProposalSave(proposal());

    const [saved] = await emailReplyProposalList('matter-1');

    expect(saved?.items[0]?.bodyFact?.displayValue).toBe('•••-••-6789');
    expect(JSON.stringify(saved)).not.toContain('123-45-6789');
    expect(saved?.items[0]?.bodyFact).not.toHaveProperty('value');
  });

  it('is idempotent by provider, account, and message id', async () => {
    const first = await emailReplyProposalSave(proposal('msg-1'));
    const second = await emailReplyProposalSave({
      ...proposal('msg-1'),
      proposalId: 'different-proposal-id',
    });

    expect(first?.proposalId).toBe(second?.proposalId);
    expect(await emailReplyProposalList('matter-1')).toHaveLength(1);
  });

  it('does not create a proposal after a quarantine row exists for the same message', async () => {
    await emailReplyQuarantineSave({
      quarantineId: stableEmailReplyId('quarantine', {
        provider: 'm365',
        account: 'advisor@example.com',
        messageId: 'msg-1',
      }),
      messageId: 'msg-1',
      provider: 'm365',
      account: 'advisor@example.com',
      received: '2026-07-10T10:00:00.000Z',
      sender: 'sarah@example.com',
      authResult: { ...auth, dmarc: 'fail', aligned: false },
      threadId: null,
      reason: 'auth_failed',
      matchedMatterId: 'matter-1',
      matchedRequestId: 'intake-1',
    });

    await expect(emailReplyProposalSave(proposal('msg-1'))).resolves.toBeNull();
    expect(await emailReplyProposalList('matter-1')).toHaveLength(0);
    expect(await emailReplyQuarantineList('matter-1')).toHaveLength(1);
  });
});

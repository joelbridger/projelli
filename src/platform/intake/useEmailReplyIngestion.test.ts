import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MailListItem, MailView } from '@/platform/utils/mail-commands';
import { useIntakeStore, type IntakeRecord } from './intakeStore';
import {
  clearInMemoryEmailReplyQueuesForTests,
  emailReplyProposalList,
  emailReplyQuarantineList,
} from './emailReplyProposalStore';
import { processEmailReplyMessages } from './useEmailReplyIngestion';

const authPass = {
  dkim: 'pass' as const,
  spf: 'pass' as const,
  dmarc: 'pass' as const,
  aligned: true,
  source: 'graph' as const,
};

function intake(): IntakeRecord {
  return {
    intakeId: 'intake-1',
    matterId: 'matter-1',
    clientFirstName: 'Sarah',
    clientEmail: 'sarah@example.com',
    firmName: 'North Star',
    status: 'active',
    expiresAt: '2026-08-10T00:00:00.000Z',
    checklistVersion: 1,
    items: [
      {
        itemId: 'drivers-license',
        label: "Driver's license",
        state: 'not_started',
      },
    ],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
  };
}

function mailListItem(id = 'msg-1'): MailListItem {
  return {
    id,
    subject: 'Re: onboarding',
    fromAddr: 'sarah@example.com',
    fromName: 'Sarah',
    snippet: 'License attached',
    receivedDateTime: '2026-07-10T10:00:00.000Z',
    provider: 'm365',
    account: 'advisor@example.com',
    folderId: 'inbox',
    hasAttachments: true,
  };
}

function mailView(overrides: Partial<MailView> = {}): MailView {
  return {
    id: 'msg-1',
    subject: 'Re: onboarding',
    from: 'Sarah <sarah@example.com>',
    to: ['advisor@example.com'],
    cc: [],
    date: '2026-07-10T10:00:00.000Z',
    provider: 'm365',
    account: 'advisor@example.com',
    threadId: 'thread-1',
    authResult: authPass,
    body: 'Here is my license.',
    hasAttachments: true,
    attachmentsUnsupported: false,
    attachments: [
      {
        id: 'att-1',
        name: 'drivers-license.pdf',
        filename: 'drivers-license.pdf',
        contentType: 'application/pdf',
        byteSize: 12,
        kind: 'file',
      },
    ],
    ...overrides,
  };
}

describe('useEmailReplyIngestion', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    clearInMemoryEmailReplyQueuesForTests();
    useIntakeStore.getState().upsertIntake(intake());
  });

  it('runs the matcher over synced mail and enqueues a proposal idempotently', async () => {
    const listMessages = vi.fn().mockResolvedValue({
      items: [mailListItem()],
      total: 1,
    });
    const getMessage = vi.fn().mockResolvedValue(mailView());

    await processEmailReplyMessages({ listMessages, getMessage });
    await processEmailReplyMessages({ listMessages, getMessage });

    const proposals = await emailReplyProposalList('matter-1');
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.items[0]).toMatchObject({
      kind: 'attachment',
      itemId: 'drivers-license',
      checkedByDefault: true,
    });
  });

  it('writes a durable quarantine row for authenticated-gate failures', async () => {
    const listMessages = vi.fn().mockResolvedValue({
      items: [mailListItem()],
      total: 1,
    });
    const getMessage = vi.fn().mockResolvedValue(
      mailView({
        authResult: { ...authPass, dmarc: 'fail', aligned: false },
      })
    );

    await processEmailReplyMessages({ listMessages, getMessage });

    expect(await emailReplyProposalList('matter-1')).toHaveLength(0);
    const quarantines = await emailReplyQuarantineList('matter-1');
    expect(quarantines).toHaveLength(1);
    expect(quarantines[0]?.reason).toBe('auth_failed');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  dismissQuarantinedEmail,
  manualFileQuarantinedEmail,
} from './emailReplyQuarantineManualFile';
import { setIntakeEmailReplyAuditEmitter } from './emailReplyAudit';
import { useIntakeStore } from './intakeStore';
import type { EmailReplyQuarantine } from './emailQuarantineStore';

const quarantine: EmailReplyQuarantine = {
  quarantineId: 'quarantine-1', messageId: 'message-1', provider: 'm365',
  account: 'advisor@example.com', received: null, sender: 'client@example.com',
  authResult: { dkim: 'fail', spf: 'fail', dmarc: 'fail', aligned: false, source: 'graph' },
  threadId: null, reason: 'auth_failed', matchedMatterId: 'matter-1',
  matchedRequestId: 'intake-1', status: 'pending', createdAt: '2026-07-10T00:00:00.000Z', updatedAt: '2026-07-10T00:00:00.000Z',
};

function seedOpenItem() {
  useIntakeStore.getState().upsertIntake({
    intakeId: 'intake-1', matterId: 'matter-1', clientFirstName: 'Sarah', firmName: 'North Star',
    status: 'active', expiresAt: '2026-12-01T00:00:00.000Z', checklistVersion: 1,
    items: [{ itemId: 'license', label: "Driver's license", state: 'not_started' }],
    receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [],
  });
}

describe('emailReplyQuarantineManualFile', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    setIntakeEmailReplyAuditEmitter(null);
    seedOpenItem();
  });

  it('writes the audit intent before the manual file effect, then records advisor-confirmed provenance', async () => {
    const events: Array<Record<string, unknown>> = [];
    const order: string[] = [];
    setIntakeEmailReplyAuditEmitter((entry) => { order.push(`audit:${String(entry.metadata['phase'])}`); events.push(entry); return Promise.resolve(); });
    const setStatus = vi.fn(() => Promise.resolve({ ...quarantine, status: 'manual_filed' as const }));
    const persistAttachment = vi.fn(() => { order.push('file'); return Promise.resolve({ path: 'Requests/onboarding/email-replies/message-1/file.pdf' }); });

    await expect(manualFileQuarantinedEmail({
      quarantineId: quarantine.quarantineId, targetMatterId: 'matter-1', targetRequestId: 'intake-1',
      targetItemId: 'license', attachmentId: 'attachment-1', advisorId: 'advisor-1', reviewed: true,
      now: new Date('2026-07-10T12:00:00.000Z'), getQuarantine: () => Promise.resolve(quarantine),
      getMessage: () => Promise.resolve({ attachmentsUnsupported: false, attachments: [{ id: 'attachment-1', name: 'file.pdf', filename: 'file.pdf', kind: 'file' }] } as never),
      persistAttachment: persistAttachment as never, setStatus: setStatus as never,
    })).resolves.toEqual({ filePath: 'Requests/onboarding/email-replies/message-1/file.pdf', status: 'manual_filed' });

    expect(order).toEqual(['audit:intent', 'file', 'audit:outcome']);
    expect(events[1]?.['description']).toContain('MANUALLY confirmed');
    expect(events[0]?.['inputs']).toMatchObject({ channel: 'email_reply' });
    expect(useIntakeStore.getState().intakesById['intake-1']?.items[0]?.provenance).toMatchObject({ channel: 'email_reply', enteredBy: 'advisor-1', confirmedBy: 'advisor-1', verification: 'advisor_confirmed' });
    expect(useIntakeStore.getState().intakesById['intake-1']?.items[0]?.provenance?.label).toContain('MANUALLY confirmed');
    expect(setStatus).toHaveBeenCalledWith('quarantine-1', 'manual_filed');
  });

  it('rejects an item that is not a real open item before any effect', async () => {
    const persistAttachment = vi.fn();
    await expect(manualFileQuarantinedEmail({
      quarantineId: quarantine.quarantineId, targetMatterId: 'matter-1', targetRequestId: 'intake-1', targetItemId: 'made-up',
      attachmentId: 'attachment-1', advisorId: 'advisor-1', reviewed: true, getQuarantine: () => Promise.resolve(quarantine),
      persistAttachment: persistAttachment as never,
    })).rejects.toThrow('real open onboarding item');
    expect(persistAttachment).not.toHaveBeenCalled();
  });

  it('audits an explicit dismissal as not intake material', async () => {
    const events: Array<Record<string, unknown>> = [];
    setIntakeEmailReplyAuditEmitter((entry) => { events.push(entry); return Promise.resolve(); });
    const inactiveQuarantine = { ...quarantine, reason: 'inactive_request' } as const;
    const setStatus = vi.fn(() => Promise.resolve({ ...inactiveQuarantine, status: 'dismissed' as const }));
    await dismissQuarantinedEmail({ quarantineId: quarantine.quarantineId, advisorId: 'advisor-1', getQuarantine: () => Promise.resolve(inactiveQuarantine), setStatus: setStatus as never });
    expect(setStatus).toHaveBeenCalledWith('quarantine-1', 'dismissed');
    expect(events).toHaveLength(2);
    expect(events[1]?.['description']).toContain('not intake material');
  });

  it('refuses to dismiss security quarantines even when called outside the UI', async () => {
    const setStatus = vi.fn();
    await expect(dismissQuarantinedEmail({
      quarantineId: quarantine.quarantineId,
      advisorId: 'advisor-1',
      getQuarantine: () => Promise.resolve(quarantine),
      setStatus: setStatus as never,
    })).rejects.toThrow('requires manual review');
    expect(setStatus).not.toHaveBeenCalled();
  });

  it('retries a failed status update from its durable receipt without saving the attachment twice', async () => {
    setIntakeEmailReplyAuditEmitter(() => Promise.resolve());
    const persistAttachment = vi.fn(() => Promise.resolve({ path: 'Requests/onboarding/email-replies/message-1/file.pdf' }));
    const getMessage = vi.fn(() => Promise.resolve({
      attachmentsUnsupported: false,
      attachments: [{ id: 'attachment-1', name: 'file.pdf', filename: 'file.pdf', kind: 'file' }],
    }));
    let attempts = 0;
    const setStatus = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('temporary status failure'));
      return Promise.resolve({ ...quarantine, status: 'manual_filed' as const });
    });
    const options = {
      quarantineId: quarantine.quarantineId,
      targetMatterId: 'matter-1',
      targetRequestId: 'intake-1',
      targetItemId: 'license',
      attachmentId: 'attachment-1',
      advisorId: 'advisor-1',
      reviewed: true,
      getQuarantine: () => Promise.resolve(quarantine),
      getMessage: getMessage as never,
      persistAttachment: persistAttachment as never,
      setStatus: setStatus as never,
    };

    await expect(manualFileQuarantinedEmail(options)).rejects.toThrow('temporary status failure');
    expect(useIntakeStore.getState().intakesById['intake-1']?.emailReplyManualFileReceipts).toEqual([
      expect.objectContaining({ quarantineId: 'quarantine-1', targetItemId: 'license' }),
    ]);

    await expect(manualFileQuarantinedEmail(options)).resolves.toEqual({
      filePath: 'Requests/onboarding/email-replies/message-1/file.pdf',
      status: 'manual_filed',
    });
    expect(persistAttachment).toHaveBeenCalledTimes(1);
    expect(getMessage).toHaveBeenCalledTimes(1);
    expect(useIntakeStore.getState().intakesById['intake-1']?.receivedItems).toHaveLength(1);
  });
});

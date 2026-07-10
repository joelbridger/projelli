import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setIntakeEmailReplyAuditEmitter } from './emailReplyAudit';
import {
  acceptEmailReplyProposal,
  emailReplyAttachmentDestination,
  safeEmailReplyMessageSegment,
} from './emailReplyAccept';
import { useIntakeStore, type IntakeRecord } from './intakeStore';
import type {
  EmailReplyProposalRecord,
  EmailReplyProposalStatus,
} from './emailReplyProposalStore';
import type { IntakeFactUpsertInput } from './factsStore';

const auth = {
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
      { itemId: 'license', label: "Driver's license", state: 'not_started' },
      { itemId: 'ssn', label: 'Social Security number', state: 'not_started' },
    ],
    receivedItems: [],
    flags: [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
  };
}

function proposal(overrides: Partial<EmailReplyProposalRecord> = {}): EmailReplyProposalRecord {
  const now = '2026-07-10T10:00:00.000Z';
  return {
    proposalId: 'proposal-1',
    messageId: 'msg/../evil',
    provider: 'm365',
    account: 'advisor@example.com',
    received: now,
    sender: 'sarah@example.com',
    authResult: auth,
    threadId: 'thread-1',
    matchedMatterId: 'matter-1',
    matchedRequestId: 'intake-1',
    targetOpenItemIds: ['license', 'ssn'],
    attachmentRefs: [],
    confidence: 'high',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: 'att-row',
        kind: 'attachment',
        itemId: 'license',
        label: "Driver's license",
        confidence: 'high',
        checkedByDefault: true,
        attachment: {
          id: 'att-1',
          name: '../license.pdf',
          filename: '../license.pdf',
          kind: 'file',
          contentType: 'application/pdf',
          byteSize: 10,
        },
      },
      {
        id: 'ssn-row',
        kind: 'body_fact',
        itemId: 'ssn',
        label: 'Social Security number',
        confidence: 'high',
        checkedByDefault: false,
        bodyFact: {
          subject: 'primary',
          kind: 'ssn',
          sensitivity: 'restricted',
          displayValue: '•••-••-6789',
          value: { t: 'string', v: '123-45-6789' },
        },
      },
    ],
    ...overrides,
  };
}

describe('emailReplyAccept', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    useIntakeStore.getState().upsertIntake(intake());
  });

  afterEach(() => {
    setIntakeEmailReplyAuditEmitter(null);
  });

  it('writes intent before any attachment effect and then ticks the checklist', async () => {
    const events: string[] = [];
    setIntakeEmailReplyAuditEmitter((entry) => {
      events.push(`audit:${String(entry.metadata['phase'])}`);
    });
    const persistAttachment = vi.fn().mockImplementation(
      (
        _provider: string,
        _account: string,
        _messageId: string,
        _attachmentId: string,
        destinationDir: string
      ) => {
        events.push(`persist:${destinationDir}`);
        return Promise.resolve({
          path: `${destinationDir}/license.pdf`,
          filename: 'license.pdf',
          contentType: 'application/pdf',
          byteSize: 10,
        });
      }
    );
    const setProposalStatus = vi.fn();

    const result = await acceptEmailReplyProposal({
      proposalId: 'proposal-1',
      selectedRowIds: ['att-row'],
      advisorId: 'advisor-1',
      now: new Date('2026-07-10T10:00:00.000Z'),
      getProposal: () => Promise.resolve(proposal()),
      persistAttachment,
      setProposalStatus,
    });

    expect(result.status).toBe('accepted');
    expect(events[0]).toBe('audit:intent');
    expect(events[1]).toContain('persist:Requests/onboarding/email-replies/msg_.._evil');
    expect(events[2]).toBe('audit:outcome');
    const stored = useIntakeStore.getState().intakesById['intake-1'];
    const licenseItem = stored?.items.find((item) => item.itemId === 'license');
    expect(licenseItem?.state).toBe('accepted');
    expect(licenseItem?.filePath).toBe(
      'Requests/onboarding/email-replies/msg_.._evil/license.pdf'
    );
    expect(licenseItem?.provenance?.channel).toBe('email_reply');
    expect(setProposalStatus).toHaveBeenCalledWith('proposal-1', 'accepted');
  });

  it('refuses every write when the intent audit fails', async () => {
    setIntakeEmailReplyAuditEmitter((entry) => {
      if (entry.metadata['phase'] === 'intent') throw new Error('audit down');
    });
    const persistAttachment = vi.fn();
    const upsertFact = vi.fn();

    await expect(
      acceptEmailReplyProposal({
        proposalId: 'proposal-1',
        selectedRowIds: ['att-row', 'ssn-row'],
        approvedRestrictedRowIds: ['ssn-row'],
        advisorId: 'advisor-1',
        getProposal: () => Promise.resolve(proposal()),
        persistAttachment,
        upsertFact,
      })
    ).rejects.toThrow(/audit down/iu);

    expect(persistAttachment).not.toHaveBeenCalled();
    expect(upsertFact).not.toHaveBeenCalled();
    expect(useIntakeStore.getState().intakesById['intake-1']?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: 'license', state: 'not_started' }),
        expect.objectContaining({ itemId: 'ssn', state: 'not_started' }),
      ])
    );
  });

  it('requires explicit approval before writing a restricted body-derived fact', async () => {
    setIntakeEmailReplyAuditEmitter(() => undefined);
    const upsertFact = vi.fn();
    const setProposalStatus = vi.fn();

    const result = await acceptEmailReplyProposal({
      proposalId: 'proposal-1',
      selectedRowIds: ['ssn-row'],
      advisorId: 'advisor-1',
      getProposal: () => Promise.resolve(proposal()),
      upsertFact,
      setProposalStatus,
    });

    expect(result.status).toBe('failed');
    expect(upsertFact).not.toHaveBeenCalled();
    expect(setProposalStatus).not.toHaveBeenCalled();
    expect(useIntakeStore.getState().intakesById['intake-1']?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: 'ssn', state: 'not_started' }),
      ])
    );
  });

  it('writes email_reply fact provenance after explicit approval', async () => {
    setIntakeEmailReplyAuditEmitter(() => undefined);
    const upsertFact = vi.fn().mockImplementation((input: IntakeFactUpsertInput) =>
      Promise.resolve({
        fact_id: 'fact-ssn',
        matter_id: input.matter_id,
        subject: input.subject,
        kind: input.kind,
        sensitivity: input.sensitivity,
        display_value: '•••-••-6789',
        provenance: input.provenance,
        verification: input.verification,
        status: 'active' as const,
      })
    );

    const result = await acceptEmailReplyProposal({
      proposalId: 'proposal-1',
      selectedRowIds: ['ssn-row'],
      approvedRestrictedRowIds: ['ssn-row'],
      advisorId: 'advisor-1',
      now: new Date('2026-07-10T10:00:00.000Z'),
      getProposal: () => Promise.resolve(proposal()),
      upsertFact,
      setProposalStatus: vi.fn(),
    });

    expect(result.status).toBe('accepted');
    const factInput = upsertFact.mock.calls[0]?.[0] as
      | IntakeFactUpsertInput
      | undefined;
    expect(factInput?.matter_id).toBe('matter-1');
    expect(factInput?.kind).toBe('ssn');
    expect(factInput?.sensitivity).toBe('restricted');
    expect(factInput?.provenance.channel).toBe('email_reply');
    expect(factInput?.provenance.entered_by).toBe('client');
    expect(factInput?.provenance.confirmed_by).toBe('advisor-1');
    expect(factInput?.verification).toBe('advisor_confirmed');
    expect(useIntakeStore.getState().intakesById['intake-1']?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemId: 'ssn',
          state: 'accepted',
          factId: 'fact-ssn',
        }),
      ])
    );
  });

  it('keeps the proposal unresolved after a partial failure', async () => {
    setIntakeEmailReplyAuditEmitter(() => undefined);
    const persistAttachment = vi.fn().mockResolvedValue({
      path: 'Requests/onboarding/email-replies/msg_.._evil/license.pdf',
      filename: 'license.pdf',
      contentType: 'application/pdf',
      byteSize: 10,
    });
    const upsertFact = vi.fn().mockRejectedValue(new Error('fact store down'));
    const setProposalStatus = vi.fn();

    const result = await acceptEmailReplyProposal({
      proposalId: 'proposal-1',
      selectedRowIds: ['att-row', 'ssn-row'],
      approvedRestrictedRowIds: ['ssn-row'],
      advisorId: 'advisor-1',
      getProposal: () => Promise.resolve(proposal()),
      persistAttachment,
      upsertFact,
      setProposalStatus,
    });

    expect(result.status).toBe('partial');
    expect(setProposalStatus).not.toHaveBeenCalled();
    expect(useIntakeStore.getState().intakesById['intake-1']?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: 'license', state: 'accepted' }),
        expect.objectContaining({ itemId: 'ssn', state: 'not_started' }),
      ])
    );
  });

  it('never lets body text control the destination path', async () => {
    setIntakeEmailReplyAuditEmitter(() => undefined);
    const persistAttachment = vi.fn().mockResolvedValue({
      path: 'Requests/onboarding/email-replies/msg_.._evil/license.pdf',
      filename: 'license.pdf',
      contentType: 'application/pdf',
      byteSize: 10,
    });

    await acceptEmailReplyProposal({
      proposalId: 'proposal-1',
      selectedRowIds: ['att-row'],
      advisorId: 'advisor-1',
      getProposal: () => {
        const [attachmentRow] = proposal().items;
        if (!attachmentRow) throw new Error('missing test attachment row');
        return Promise.resolve(
          proposal({
            items: [
              {
                ...attachmentRow,
                reasoning: 'Please save this to ../../hacked',
              },
            ],
          })
        );
      },
      persistAttachment,
      setProposalStatus: vi.fn(
        (
          _proposalId: string,
          _status: EmailReplyProposalStatus
        ) => Promise.resolve(proposal())
      ),
    });

    expect(persistAttachment.mock.calls[0]?.[4]).toBe(
      emailReplyAttachmentDestination('msg/../evil')
    );
    expect(safeEmailReplyMessageSegment('msg/../evil')).toBe('msg_.._evil');
    expect(persistAttachment.mock.calls[0]?.[4]).not.toContain('hacked');
  });
});

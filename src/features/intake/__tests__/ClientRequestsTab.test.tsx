import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIntakeStore, type IntakeRecord } from '@/platform/intake/intakeStore';
import type { EmailReplyProposalRecord } from '@/platform/intake/emailReplyProposalStore';
import { ClientRequestsTab } from '../ClientRequestsTab';

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactList: vi.fn(() => Promise.resolve([])), intakeFactReveal: vi.fn(), intakeFactPurge: vi.fn(), intakeFactUpsert: vi.fn(), intakeFactMatchList: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/platform/intake/emailReplyProposalStore', () => ({
  emailReplyProposalList: vi.fn(() => Promise.resolve([])),
  isEmailReplyProposalItemSelectable: vi.fn(() => true),
}));

vi.mock('@/platform/intake/emailQuarantineStore', () => ({
  listEmailQuarantines: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/platform/intake/documentExtractionProposalStore', () => ({
  documentExtractionProposalList: vi.fn(() => Promise.resolve([])),
}));

const { emailReplyProposalList } = await import('@/platform/intake/emailReplyProposalStore');

function intake(overrides: Partial<IntakeRecord>): IntakeRecord {
  return {
    intakeId: overrides.intakeId ?? 'request-1', matterId: 'matter-1', clientFirstName: 'Sarah', firmName: 'North Star',
    status: 'active', link: 'https://forms.example.test/i/request#secret', expiresAt: '2026-08-09T00:00:00.000Z', checklistVersion: 1,
    items: [{ itemId: 'item', label: 'Safe label', state: 'not_started' }], receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [], ...overrides,
  };
}

function replyProposal(): EmailReplyProposalRecord {
  return {
    proposalId: 'proposal-1', messageId: 'message-1', provider: 'm365', account: 'advisor@example.com',
    received: '2026-07-10T10:00:00.000Z', sender: 'sarah@example.com',
    authResult: { dkim: 'pass', spf: 'pass', dmarc: 'pass', aligned: true, source: 'graph' },
    threadId: 'thread-1', matchedMatterId: 'matter-1', matchedRequestId: 'request-1',
    targetOpenItemIds: ['item'], attachmentRefs: [], confidence: 'high', status: 'pending',
    completedRows: [], createdAt: '2026-07-10T10:00:00.000Z', updatedAt: '2026-07-10T10:00:00.000Z',
    items: [{
      id: 'proposal-item-1', kind: 'attachment', itemId: 'item', label: 'Safe label', confidence: 'high', checkedByDefault: true,
      attachment: { id: 'attachment-1', name: 'safe.pdf', filename: 'safe.pdf', kind: 'file' },
    }],
  };
}

describe('ClientRequestsTab', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    vi.mocked(emailReplyProposalList).mockResolvedValue([]);
  });

  it('pins onboarding first, keeps each request independent, and opens the request composer', () => {
    const store = useIntakeStore.getState();
    store.upsertIntake(intake({ intakeId: 'standing-old', kind: 'standing', requestTitle: 'Tax return', createdAt: '2026-07-01T00:00:00.000Z', receivedItems: [{ itemId: 'tax', label: 'Tax return', receivedAt: '2026-07-02T00:00:00.000Z', provenance: { channel: 'intake_link', label: 'typed by client', at: '2026-07-02T00:00:00.000Z' } }] }));
    store.upsertIntake(intake({ intakeId: 'onboarding', kind: 'onboarding', requestTitle: 'New client onboarding', createdAt: '2026-07-03T00:00:00.000Z' }));
    store.upsertIntake(intake({ intakeId: 'standing-new', kind: 'standing', requestTitle: 'Beneficiary update', createdAt: '2026-07-04T00:00:00.000Z' }));
    const onRevoke = vi.fn((intakeId: string) => { store.updateIntake(intakeId, { status: 'revoked' }); });

    render(<ClientRequestsTab matterId="matter-1" clientName="Sarah Smith" issueRequest={vi.fn()} onRevoke={onRevoke} activeRequestId="standing-new" />);
    expect(screen.getAllByTestId(/^client-request-/).filter((node) => node.getAttribute('data-testid')?.startsWith('client-request-') && !node.getAttribute('data-testid')?.startsWith('client-request-detail-')).map((node) => node.getAttribute('data-testid'))).toEqual([
      'client-request-onboarding', 'client-request-standing-old', 'client-request-standing-new',
    ]);
    expect(screen.getByTestId('client-request-standing-new').getAttribute('data-selected')).toBe('true');
    expect(within(screen.getByTestId('client-request-standing-old')).getAllByText('Tax return').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('client-request-onboarding')).queryByText('Tax return')).toBeNull();

    fireEvent.click(within(screen.getByTestId('client-request-standing-new')).getByTestId('link-action-revoke'));
    expect(onRevoke).toHaveBeenCalledWith('standing-new');
    expect(onRevoke).not.toHaveBeenCalledWith('onboarding');
    expect(useIntakeStore.getState().intakesById['onboarding']?.status).toBe('active');
    expect(useIntakeStore.getState().intakesById['standing-new']?.status).toBe('revoked');

    fireEvent.click(screen.getByRole('button', { name: /request from client/i }));
    expect(screen.getByTestId('request-from-client-dialog')).toBeTruthy();
  });

  it('renders one matter-wide email reply review card for two requests and opens its review', async () => {
    const store = useIntakeStore.getState();
    store.upsertIntake(intake({ intakeId: 'request-1', kind: 'onboarding' }));
    store.upsertIntake(intake({ intakeId: 'request-2', kind: 'standing', requestTitle: 'Tax return' }));
    vi.mocked(emailReplyProposalList).mockResolvedValue([replyProposal()]);

    render(<ClientRequestsTab matterId="matter-1" clientName="Sarah Smith" issueRequest={vi.fn()} />);

    expect(await screen.findByText('Email replies waiting')).toBeTruthy();
    expect(screen.getAllByText('Email replies waiting')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByRole('dialog', { name: 'Review email reply' })).toBeTruthy();
  });
});

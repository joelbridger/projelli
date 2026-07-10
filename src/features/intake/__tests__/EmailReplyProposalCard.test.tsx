import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailReplyProposalCard } from '../EmailReplyProposalCard';
import type { EmailReplyProposalRecord } from '@/platform/intake/emailReplyProposalStore';

vi.mock('@/platform/intake/emailReplyProposalStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/intake/emailReplyProposalStore')>();
  return {
    ...actual,
    emailReplyProposalList: vi.fn(),
  };
});

vi.mock('@/platform/intake/emailReplyAccept', () => ({
  acceptEmailReplyProposal: vi.fn(),
  dismissEmailReplyProposal: vi.fn(),
}));

const { emailReplyProposalList } = await import('@/platform/intake/emailReplyProposalStore');

const auth = {
  dkim: 'pass' as const,
  spf: 'pass' as const,
  dmarc: 'pass' as const,
  aligned: true,
  source: 'graph' as const,
};

function proposal(): EmailReplyProposalRecord {
  const now = '2026-07-10T10:00:00.000Z';
  return {
    proposalId: 'proposal-1',
    messageId: 'msg-1',
    provider: 'm365',
    account: 'advisor@example.com',
    received: now,
    sender: 'sarah@example.com',
    authResult: auth,
    threadId: 'thread-1',
    matchedMatterId: 'matter-1',
    matchedRequestId: 'intake-1',
    targetOpenItemIds: ['license', 'income', 'ssn'],
    attachmentRefs: [],
    confidence: 'high',
    status: 'pending',
    completedRows: [],
    createdAt: now,
    updatedAt: now,
    items: [
      {
        id: 'high-row',
        kind: 'attachment',
        itemId: 'license',
        label: "Driver's license",
        confidence: 'high',
        checkedByDefault: true,
        attachment: {
          id: 'att-1',
          name: 'drivers-license.pdf',
          filename: 'drivers-license.pdf',
          kind: 'file',
        },
      },
      {
        id: 'medium-row',
        kind: 'attachment',
        itemId: 'income',
        label: 'Income documents',
        confidence: 'medium',
        reasoning: 'The file name partly matches this open item.',
        checkedByDefault: true,
        attachment: {
          id: 'att-2',
          name: 'income.pdf',
          filename: 'income.pdf',
          kind: 'file',
        },
      },
      {
        id: 'low-row',
        kind: 'body_fact',
        itemId: 'ssn',
        label: 'Social Security number',
        confidence: 'low',
        reasoning: 'No strong match. Leave unchecked unless you verify it.',
        checkedByDefault: false,
        bodyFact: {
          subject: 'primary',
          kind: 'ssn',
          sensitivity: 'restricted',
          displayValue: '•••-••-6789',
        },
      },
    ],
  };
}

describe('EmailReplyProposalCard', () => {
  beforeEach(() => {
    vi.mocked(emailReplyProposalList).mockResolvedValue([proposal()]);
  });

  it('shows confidence defaults, non-E2EE labeling, reasoning, and masked restricted previews', async () => {
    render(<EmailReplyProposalCard matterId="matter-1" advisorId="advisor-1" />);

    expect(await screen.findByText('Email replies waiting')).toBeTruthy();
    expect(screen.getByTestId('email-reply-non-e2ee-label').textContent).toContain(
      'Email reply. Not end-to-end encrypted.'
    );
    expect(screen.getByText('The file name partly matches this open item.')).toBeTruthy();
    expect(screen.getByText('•••-••-6789')).toBeTruthy();
    expect(screen.queryByText('123-45-6789')).toBeNull();

    const rowChecks = screen.getAllByRole('checkbox', {
      name: 'Select this email reply item',
    });
    const [firstCheck, secondCheck, thirdCheck] = rowChecks as [
      HTMLInputElement,
      HTMLInputElement,
      HTMLInputElement,
    ];
    expect(firstCheck.checked).toBe(true);
    expect(secondCheck.checked).toBe(true);
    expect(thirdCheck.checked).toBe(false);
    expect(thirdCheck.disabled).toBe(true);
    expect(screen.getByText('Needs manual review. There is nothing safe to file from this email text.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('opens the review modal from the card', async () => {
    render(<EmailReplyProposalCard matterId="matter-1" advisorId="advisor-1" />);

    await screen.findByText('Email replies waiting');
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Review email reply' })).toBeTruthy();
    });
  });
});

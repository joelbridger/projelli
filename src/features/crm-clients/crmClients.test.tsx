import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DirectorySurface,
  HouseholdRecordSurface,
  IntakeSubmissionReview,
  NoteEditor,
  ProposalCard,
} from './index';
import type { CrmProposal, HouseholdRecord } from './adapters';

const household: HouseholdRecord = {
  id: 'h-1',
  name: 'Henderson household',
  lifecycle: 'Active',
  primaryAdvisor: 'Maya',
  ownership: 'mine',
  serviceTier: 'Platinum',
  nextReview: 'Sep 18',
  syncState: 'live',
  schedulingLinkUrl: 'https://calendar.example.test/henderson',
  facts: [
    {
      id: 'f-1',
      label: 'Income',
      value: '$240,000',
      status: 'Current',
      asOf: 'Jun 30',
      sources: [{ id: 's-1', label: 'Tax return' }],
    },
  ],
  accounts: [
    {
      id: 'a-1',
      custodian: 'Wells Fargo',
      type: 'Investment',
      lastFour: '4821',
      status: 'Open',
    },
  ],
  members: [
    {
      id: 'p-1',
      name: 'Dana',
      personType: 'person',
      roles: [],
      householdRole: 'Spouse',
      relatedHouseholds: 1,
    },
  ],
  externalParties: [
    {
      id: 'p-2',
      name: 'Omar Chen, CPA',
      personType: 'person',
      roles: ['CPA'],
      external: true,
      relatedHouseholds: 4,
      verifiedAt: 'Jun 1',
    },
  ],
  notes: [
    { id: 'n-1', body: 'Dana prefers a phone call.', audience: 'internal' },
    { id: 'n-2', body: 'Review summary.', audience: 'client_facing' },
  ],
  tags: ['priority'],
  customFields: [
    { id: 'cf-1', label: 'Referral source', value: 'Web', type: 'text' },
  ],
};
const pendingProposal: CrmProposal = {
  id: 'proposal-1',
  kind: 'fact_add',
  state: 'pending',
  rationale: 'The tax return supports this.',
  context: 'Income',
  sources: [{ id: 's-1', label: 'Tax return' }],
};

describe('crm clients surfaces', () => {
  it('shows the household truth, both note lanes, safe account masking, and opens scheduling through its adapter', () => {
    const onOpenSchedulingLink = vi.fn();
    render(
      <HouseholdRecordSurface
        household={household}
        actions={{ onOpenSchedulingLink }}
      />
    );
    expect(screen.getByText('Income: $240,000')).toBeInTheDocument();
    expect(screen.getByText('Needs a purpose')).toBeInTheDocument();
    expect(screen.getByText('Internal only')).toBeInTheDocument();
    expect(screen.getByText('Client-facing')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-household-schedule'));
    expect(onOpenSchedulingLink).toHaveBeenCalledWith(
      'https://calendar.example.test/henderson'
    );
  });

  it('keeps note audience fixed, reviews mention recipients, offers firm notification, and has no send affordance', () => {
    const onSaveNote = vi.fn();
    render(
      <NoteEditor
        audience="internal"
        availableMentions={[{ id: 'p-1', label: 'Dana' }]}
        actions={{ onSaveNote }}
      />
    );
    expect(screen.getByText('Audience fixed at creation')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-note-mention-p-1'));
    expect(screen.getByText('Will notify: Dana')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-note-notify-firm'));
    fireEvent.change(screen.getByTestId('crm-note-body'), {
      target: { value: 'Call before email.' },
    });
    fireEvent.click(screen.getByTestId('crm-note-save'));
    expect(onSaveNote).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'internal', mentions: ['p-1'] }),
      true
    );
    expect(
      screen.queryByRole('button', { name: /send/i })
    ).not.toBeInTheDocument();
  });

  it('keeps proposal approval and dismiss actions tied to the durable proposal id', () => {
    const onApproveProposal = vi.fn();
    const onDismissProposal = vi.fn();
    render(
      <ProposalCard
        proposal={pendingProposal}
        actions={{ onApproveProposal, onDismissProposal }}
      />
    );
    fireEvent.click(screen.getByTestId('crm-proposal-approve-proposal-1'));
    fireEvent.click(screen.getByTestId('crm-proposal-dismiss-proposal-1'));
    expect(onApproveProposal).toHaveBeenCalledWith('proposal-1');
    expect(onDismissProposal).toHaveBeenCalledWith('proposal-1');
  });

  it('keeps firm person roles separate from the household relationship and opens recipient review', () => {
    const onReviewRecipient = vi.fn();
    render(
      <DirectorySurface
        people={[...household.members, ...household.externalParties]}
        actions={{ onReviewRecipient }}
      />
    );
    fireEvent.click(screen.getByTestId('crm-directory-person-p-1'));
    expect(
      screen.getByText('Household relationship:').parentElement
    ).toHaveTextContent('Spouse');
    expect(screen.getByText('Person roles:').parentElement).toHaveTextContent(
      'None'
    );
    fireEvent.click(screen.getByTestId('crm-review-recipient-p-1'));
    expect(onReviewRecipient).toHaveBeenCalledWith('p-1');
  });

  it('requires a deliberate intake match before the review action', () => {
    const onMatchIntake = vi.fn();
    render(
      <IntakeSubmissionReview
        submission={{
          id: 'i-1',
          submittedAt: 'Jul 11',
          submitterLabel: 'Dana Henderson',
          fields: [{ label: 'Review date', value: 'September' }],
          candidates: [
            {
              householdId: 'h-1',
              name: 'Henderson household',
              confidence: 'high',
            },
          ],
        }}
        actions={{ onMatchIntake }}
      />
    );
    expect(screen.getByTestId('crm-intake-confirm-match')).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Henderson household/));
    fireEvent.click(screen.getByTestId('crm-intake-confirm-match'));
    expect(onMatchIntake).toHaveBeenCalledWith('i-1', 'h-1');
  });
});

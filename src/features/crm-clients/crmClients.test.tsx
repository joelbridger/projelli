import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import i18n from '@/i18n';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  DirectorySurface,
  HouseholdRecordSurface,
  IntakeSubmissionReview,
  NoteEditor,
  ProposalCard,
} from './index';
import type { CrmProposal, HouseholdRecord } from './adapters';
import { useAcatsReviewStore } from '@/features/acats/acatsReviewStore';
import type { AcatsTransferDraft } from '@/features/acats/types';
import { useExternalWriteQueueStore } from '@/platform/state/externalWriteQueueStore';

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
    { id: 'n-2', body: 'Review summary.', audience: 'client-facing' },
  ],
  tags: ['priority'],
  customFields: [
    { id: 'cf-1', label: 'Referral source', value: 'Web', type: 'text' },
  ],
};
const pendingProposal: CrmProposal = {
  record: {
    id: 'proposal-1',
    kind: 'proposalRecord',
    householdRef: { kind: 'household', id: 'h-1', label: 'Henderson household' },
    proposalKind: 'fact_add',
    proposedMutation: { kind: 'fact_add', fact: { label: 'Income', value: '$240,000' } },
    proposedBy: { id: 'ai-1', label: 'Lantern AI' },
    contextRefs: [{ kind: 'household', id: 'h-1', label: 'Henderson household' }],
    state: 'pending',
    rationale: 'The tax return supports this.',
  },
  contextLabel: 'Income',
  sources: [{ id: 's-1', label: 'Tax return' }],
};

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
  useAcatsReviewStore.getState().resetAcatsReview();
  useExternalWriteQueueStore.setState({ items: [] });
});

describe('crm clients surfaces', () => {
  it('uses the shared offline message on a household', () => {
    render(
      <HouseholdRecordSurface household={{ ...household, syncState: 'offline' }} />
    );
    expect(screen.getByTestId('crm-household-sync-status')).toHaveTextContent(
      'Working offline. Local edits work; delivery waits until you reconnect.'
    );
  });

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
    expect(screen.getByTestId('crm-household-tag-priority')).toHaveTextContent('priority');
    expect(screen.getByTestId('crm-household-field-cf-1')).toHaveTextContent('Referral source');
    expect(screen.getByTestId('crm-household-ownership')).toHaveTextContent('mine');
    expect(screen.getByTestId('crm-household-fact-f-1')).toHaveTextContent('Income: $240,000');
    expect(screen.getByTestId('crm-household-account-a-1')).toHaveTextContent('Wells Fargo');
    expect(screen.getByTestId('crm-person-household-role-p-1')).toHaveTextContent('Spouse');
    fireEvent.click(screen.getByTestId('crm-household-schedule'));
    expect(onOpenSchedulingLink).toHaveBeenCalledWith(
      'https://calendar.example.test/henderson'
    );
  });

  it('lets an advisor reach this household\'s ACATS review and external write approvals', () => {
    const acatsDraft: AcatsTransferDraft = {
      id: 'acats-h-1',
      matterId: household.id,
      sourceStatementPath: 'Henderson brokerage statement.pdf',
      deliveringFirm: {},
      deliveringAccount: { owners: [] },
      receivingSchwabAccount: {},
      instruction: { transferType: 'unknown' },
      assets: [],
      missingFields: ['Delivering firm'],
      warnings: [],
      reviewStatus: 'needs_review',
    };
    useAcatsReviewStore.getState().setDraft(acatsDraft);
    useExternalWriteQueueStore.setState({
      items: [{
        id: 'write-h-1',
        proposalType: 'rightcapital_income',
        status: 'proposed',
        data: {
          target: 'rightcapital',
          kind: 'income',
          matterId: household.id,
          rightCapitalHouseholdId: 'rightcapital-h-1',
          existing: { incomeType: 'Salary', amount: 125_000, frequency: 'annual' },
          fromSource: {
            incomeType: 'Salary',
            amount: 185_000,
            frequency: 'annual',
            confidence: 'high',
            quote: 'My salary is now $185,000.',
          },
          final: {
            incomeType: 'Salary',
            amount: 185_000,
            frequency: 'annual',
            notes: 'Updated from an advisor-approved fact.',
          },
          sourceRef: 'meeting:h-1#00:18:42',
        },
      }],
    });

    render(<HouseholdRecordSurface household={household} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reviews' }));

    expect(screen.getByTestId('acats-review-screen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update RightCapital' })).toBeInTheDocument();
    expect(screen.getByTestId('external-income-final-amount-write-h-1')).toHaveValue(185_000);
  });

  it('offers the ACATS statement entry point before a draft exists', () => {
    render(<HouseholdRecordSurface household={household} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reviews' }));

    expect(screen.getByTestId('acats-choose-statement')).toHaveTextContent('Choose statement');
    expect(screen.getByTestId('acats-statement-input')).toHaveAttribute('accept', 'application/pdf,.pdf');
    expect(screen.getByTestId('external-write-review-entry')).toHaveTextContent(
      'No outside-app updates are waiting for review for this client.',
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
    expect(screen.getByTestId('crm-note-audience-internal')).toHaveTextContent('Internal only');
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
    const onRejectProposal = vi.fn();
    render(
      <ProposalCard
        proposal={pendingProposal}
        actions={{ onApproveProposal, onRejectProposal }}
      />
    );
    fireEvent.click(screen.getByTestId('crm-proposal-approve-proposal-1'));
    fireEvent.click(screen.getByTestId('crm-proposal-dismiss-proposal-1'));
    expect(onApproveProposal).toHaveBeenCalledWith('proposal-1');
    expect(onRejectProposal).toHaveBeenCalledWith('proposal-1');
  });

  it('shows a tracked change, clears approval selection, and restores dismissed proposals', () => {
    const onRestoreProposal = vi.fn();
    const { rerender } = render(
      <ProposalCard
        proposal={{
          ...pendingProposal,
          review: { changedSinceReview: true, selectionCleared: true, before: '$240,000', after: '$245,000' },
        }}
      />
    );
    expect(screen.getByTestId('crm-proposal-diff-proposal-1')).toHaveTextContent('Your selection was cleared');
    expect(screen.getByTestId('crm-proposal-approve-proposal-1')).toBeDisabled();
    rerender(
      <ProposalCard
        proposal={{ ...pendingProposal, record: { ...pendingProposal.record, state: 'rejected' } }}
        actions={{ onRestoreProposal }}
      />
    );
    fireEvent.click(screen.getByTestId('crm-proposal-restore-proposal-1'));
    expect(onRestoreProposal).toHaveBeenCalledWith('proposal-1');
  });

  it('keeps firm person roles separate from the household relationship and opens recipient review', () => {
    const onReviewRecipient = vi.fn();
    render(
      <DirectorySurface
        people={[...household.members, ...household.externalParties]}
        households={[
          { id: 'h-1', name: 'Henderson household', lifecycle: 'Active', primaryAdvisor: 'Maya', serviceTier: 'Platinum', peopleCount: 2 },
        ]}
        actions={{ onReviewRecipient }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'People' }));
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

  it('browses searchable households and opens the chosen household', () => {
    const onOpenHousehold = vi.fn();
    render(
      <DirectorySurface
        people={[]}
        households={[
          { id: 'h-1', name: 'Henderson household', lifecycle: 'Active', primaryAdvisor: 'Maya', serviceTier: 'Platinum', peopleCount: 2 },
        ]}
        actions={{ onOpenHousehold }}
      />
    );
    fireEvent.change(screen.getByTestId('crm-directory-search'), { target: { value: 'Henderson' } });
    fireEvent.click(screen.getByTestId('crm-directory-household-h-1'));
    expect(onOpenHousehold).toHaveBeenCalledWith('h-1');
  });

  it('hands an email draft request to the existing mail surface with household context', () => {
    const onDraftEmail = vi.fn();
    render(<HouseholdRecordSurface household={household} actions={{ onDraftEmail }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Email' }));
    fireEvent.click(screen.getByTestId('crm-open-mail-surface'));
    expect(onDraftEmail).toHaveBeenCalledWith({
      kind: 'open_mail_surface',
      contactRef: { kind: 'household', id: 'h-1', matterId: 'h-1', label: 'Henderson household' },
      contextRefs: [{ kind: 'household', id: 'h-1', matterId: 'h-1', label: 'Henderson household' }],
      source: 'crm_contact',
    });
  });

  it.each(['en', 'es', 'de'] as const)(
    'BUG-22 shows a translated Activity empty state without engineering scaffolding in %s',
    async (locale) => {
      await i18n.changeLanguage(locale);
      render(<HouseholdRecordSurface household={household} />);

      fireEvent.click(screen.getByRole('button', { name: 'Activity' }));

      const activity = screen.getByTestId('crm-household-activity');
      expect(
        within(activity).getByRole('heading', {
          name: i18n.t('crm.household.activity.title'),
        }),
      ).toBeInTheDocument();
      expect(activity).toHaveTextContent(
        i18n.t('crm.household.activity.empty-title'),
      );
      expect(activity).toHaveTextContent(
        i18n.t('crm.household.activity.empty-description'),
      );
      expect(activity).not.toHaveTextContent(
        'This preserves the existing activity layout and source content.',
      );
    },
  );

  it('keeps household and workflow context when adding a task', () => {
    const onAdd = vi.fn();
    render(<HouseholdRecordSurface household={household} actions={{ onAdd }} />);
    fireEvent.click(screen.getByTestId('crm-household-add'));
    fireEvent.click(screen.getByTestId('crm-household-add-task'));
    expect(onAdd).toHaveBeenCalledWith({
      kind: 'task',
      householdRef: { kind: 'household', id: 'h-1', label: 'Henderson household' },
      contextRefs: [{ kind: 'household', id: 'h-1', label: 'Henderson household' }],
    });
  });

  it('saves a trust contact with separate household and person roles plus primary contact details', () => {
    const onSaveHousehold = vi.fn<(saved: HouseholdRecord) => void>();
    render(<HouseholdRecordSurface household={household} onSaveHousehold={onSaveHousehold} />);
    fireEvent.click(screen.getByTestId('crm-household-add'));
    fireEvent.click(screen.getByTestId('crm-household-add-person'));
    fireEvent.change(screen.getByTestId('crm-person-type'), { target: { value: 'trust' } });
    fireEvent.change(screen.getByTestId('crm-person-name'), { target: { value: 'Henderson Family Trust' } });
    fireEvent.change(screen.getByTestId('crm-person-roles'), { target: { value: 'Beneficiary contact' } });
    fireEvent.change(screen.getByTestId('crm-person-relationship'), { target: { value: 'Trust' } });
    fireEvent.click(screen.getByTestId('crm-person-email-add'));
    fireEvent.change(screen.getByLabelText('Email 1'), { target: { value: 'trust@example.test' } });
    fireEvent.click(screen.getByTestId('crm-person-save'));
    const saved = onSaveHousehold.mock.calls[0]?.[0];
    expect(saved?.members.some((member) => member.personType === 'trust'
      && member.householdRole === 'Trust'
      && member.roles.includes('Beneficiary contact')
      && member.emails?.some((email) => email.address === 'trust@example.test' && email.primary))).toBe(true);
  });

  it('saves a dated fact with recorded provenance and lets it be removed', () => {
    const onSaveHousehold = vi.fn<(saved: HouseholdRecord) => void>();
    render(<HouseholdRecordSurface household={household} onSaveHousehold={onSaveHousehold} />);
    fireEvent.click(screen.getByTestId('crm-household-add'));
    fireEvent.click(screen.getByTestId('crm-household-add-fact'));
    fireEvent.change(screen.getByTestId('crm-fact-label'), { target: { value: 'Preferred review month' } });
    fireEvent.change(screen.getByTestId('crm-fact-value'), { target: { value: 'October' } });
    fireEvent.change(screen.getByTestId('crm-fact-as-of'), { target: { value: '2026-07-12' } });
    fireEvent.change(screen.getByTestId('crm-fact-source'), { target: { value: 'Annual review meeting' } });
    fireEvent.change(screen.getByTestId('crm-fact-source-ref'), { target: { value: 'mail:review-1' } });
    fireEvent.click(screen.getByTestId('crm-fact-save'));
    const saved = onSaveHousehold.mock.calls[0]?.[0];
    expect(saved?.facts.some((fact) => fact.label === 'Preferred review month'
      && fact.asOf === '2026-07-12'
      && fact.sources.some((source) => source.label === 'Annual review meeting' && source.ref === 'mail:review-1'))).toBe(true);
    fireEvent.click(screen.getByTestId('crm-fact-remove-f-1'));
    expect(onSaveHousehold).toHaveBeenLastCalledWith(expect.objectContaining({ facts: [] }));
  });

  it('explains that a source is required instead of silently dropping a fact', () => {
    const onSaveHousehold = vi.fn<(saved: HouseholdRecord) => void>();
    render(<HouseholdRecordSurface household={household} onSaveHousehold={onSaveHousehold} />);
    fireEvent.click(screen.getByTestId('crm-household-add'));
    fireEvent.click(screen.getByTestId('crm-household-add-fact'));
    fireEvent.change(screen.getByTestId('crm-fact-label'), {
      target: { value: 'Exam probe fact' },
    });
    fireEvent.change(screen.getByTestId('crm-fact-value'), {
      target: { value: 'Garnet lighthouse 4471' },
    });

    fireEvent.click(screen.getByTestId('crm-fact-save'));

    expect(onSaveHousehold).not.toHaveBeenCalled();
    expect(screen.getByTestId('crm-fact-source')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Source is required');
    expect(screen.getByText('Source (required)')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-fact-source'), {
      target: { value: 'Advisor call' },
    });
    fireEvent.click(screen.getByTestId('crm-fact-save'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const savedFact = onSaveHousehold.mock.calls.at(-1)?.[0].facts.at(-1);
    expect(savedFact).toMatchObject({
      label: 'Exam probe fact',
      value: 'Garnet lighthouse 4471',
      sources: [expect.objectContaining({ label: 'Advisor call' })],
    });
  });

  it('explains which required account detail is missing instead of silently stopping', () => {
    const onSaveHousehold = vi.fn<(saved: HouseholdRecord) => void>();
    render(<HouseholdRecordSurface household={household} onSaveHousehold={onSaveHousehold} />);
    fireEvent.click(screen.getByTestId('crm-household-add'));
    fireEvent.click(screen.getByTestId('crm-household-add-account'));
    fireEvent.change(screen.getByTestId('crm-account-custodian'), {
      target: { value: 'Schwab' },
    });
    fireEvent.change(screen.getByTestId('crm-account-type'), {
      target: { value: 'Brokerage' },
    });

    fireEvent.click(screen.getByTestId('crm-account-save'));

    expect(onSaveHousehold).not.toHaveBeenCalled();
    expect(screen.getByTestId('crm-account-purpose')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Purpose is required');
    expect(screen.getByText('Purpose (required)')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-account-purpose'), {
      target: { value: 'Retirement savings' },
    });
    fireEvent.click(screen.getByTestId('crm-account-save'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const savedAccount = onSaveHousehold.mock.calls.at(-1)?.[0].accounts.at(-1);
    expect(savedAccount).toMatchObject({
      custodian: 'Schwab',
      type: 'Brokerage',
      purpose: 'Retirement savings',
    });
  });

  it('explains that a household name is required instead of silently stopping', () => {
    const onSaveHousehold = vi.fn<(saved: HouseholdRecord) => void>();
    render(<HouseholdRecordSurface household={household} onSaveHousehold={onSaveHousehold} />);
    fireEvent.click(screen.getByTestId('crm-household-edit'));
    fireEvent.change(screen.getByTestId('crm-household-edit-name'), {
      target: { value: '  ' },
    });

    fireEvent.click(screen.getByTestId('crm-household-edit-save'));

    expect(onSaveHousehold).not.toHaveBeenCalled();
    expect(screen.getByTestId('crm-household-edit-name')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Household name is required');
    expect(screen.getByText('Household name (required)')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('crm-household-edit-name'), {
      target: { value: 'Henderson family' },
    });
    fireEvent.click(screen.getByTestId('crm-household-edit-save'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSaveHousehold.mock.calls.at(-1)?.[0].name).toBe('Henderson family');
  });

  it('lets a matched intake review routed dated facts before any household write', () => {
    const onOpenHousehold = vi.fn();
    const onApproveIntakeFact = vi.fn();
    const onRejectIntakeFact = vi.fn();
    render(
      <IntakeSubmissionReview
        submission={{
          id: 'i-2', submittedAt: 'Jul 11', submitterLabel: 'Dana Henderson', fields: [],
          candidates: [{ householdId: 'h-1', name: 'Henderson household', confidence: 'high' }],
          matchedHouseholdId: 'h-1',
          extractedFacts: [{ id: 'if-1', label: 'Review date', value: 'September', asOf: 'Jul 11', sourceLabel: 'Intake form', state: 'pending' }],
        }}
        actions={{ onOpenHousehold, onApproveIntakeFact, onRejectIntakeFact }}
      />
    );
    fireEvent.click(screen.getByTestId('crm-intake-open-matched-household'));
    fireEvent.click(screen.getByTestId('crm-intake-approve-fact-if-1'));
    fireEvent.click(screen.getByTestId('crm-intake-reject-fact-if-1'));
    expect(onOpenHousehold).toHaveBeenCalledWith('h-1');
    expect(onApproveIntakeFact).toHaveBeenCalledWith('i-2', 'if-1');
    expect(onRejectIntakeFact).toHaveBeenCalledWith('i-2', 'if-1');
  });
});

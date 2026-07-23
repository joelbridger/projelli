import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { NotesReviewPanel } from './NotesReviewPanel';
import type {
  ExactMeetingCrmReviewItem,
  ExactMeetingNotesReviewItem,
  ExactMeetingTaskReviewItem,
} from './notesReview';

const client = {
  householdRef: 'household-webb',
  matterId: 'matter-webb',
};
const task: ExactMeetingTaskReviewItem = {
  id: 'call-cpa',
  artifactId: 'artifact-actions',
  meetingId: 'meeting-review',
  client,
  kind: 'task',
  title: 'Call the CPA',
  detail: 'Confirm the estimated tax payment.',
  ownerRef: 'advisor-a',
  dueDate: '2026-08-01',
  transcriptRef: 'meeting:meeting-review#42000',
  approvalState: 'proposed',
  proposalRevision: 'proposal-task',
};
const crm: ExactMeetingCrmReviewItem = {
  id: 'risk-update',
  artifactId: 'artifact-actions',
  meetingId: 'meeting-review',
  client,
  kind: 'crm-update',
  title: 'Update risk preference',
  detail: 'The client confirmed moderate growth.',
  transcriptRef: 'meeting:meeting-review#88000',
  entityRef: 'household:household-webb',
  fields: [
    {
      field: 'risk_tolerance',
      label: 'Risk tolerance',
      valueType: 'text',
      before: 'Conservative',
      proposed: 'Moderate growth',
    },
  ],
  approvalState: 'proposed',
  proposalRevision: 'proposal-crm',
};

describe('NotesReviewPanel exact-meeting states', () => {
  it.each([
    ['task', 'notes-review-task-loading'],
    ['crm-update', 'notes-review-crm-update-loading'],
  ] as const)('shows a distinct loading state for %s', (reviewKind, testId) => {
    render(
      <NotesReviewPanel
        reviewKind={reviewKind}
        state={{ kind: 'loading' }}
        onApprove={vi.fn()}
      />
    );
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it.each(['task', 'crm-update'] as const)(
    'distinguishes not-produced, blocked, and retryable local errors for %s',
    (reviewKind) => {
      const retry = vi.fn();
      const { rerender } = render(
        <NotesReviewPanel
          reviewKind={reviewKind}
          state={{ kind: 'empty', reason: 'not-produced' }}
          onApprove={vi.fn()}
        />
      );
      expect(
        screen.getByTestId(`notes-review-${reviewKind}-empty`)
      ).toHaveTextContent('not been produced');

      rerender(
        <NotesReviewPanel
          reviewKind={reviewKind}
          state={{ kind: 'blocked', message: 'Client selection is blocked.' }}
          onApprove={vi.fn()}
        />
      );
      expect(
        screen.getByTestId(`notes-review-${reviewKind}-blocked`)
      ).toHaveTextContent('Client selection is blocked.');

      rerender(
        <NotesReviewPanel
          reviewKind={reviewKind}
          state={{ kind: 'error', message: 'Local records did not load.' }}
          onRetry={retry}
          onApprove={vi.fn()}
        />
      );
      fireEvent.click(screen.getByTestId(`notes-review-${reviewKind}-retry`));
      expect(retry).toHaveBeenCalledTimes(1);
    }
  );
});

describe('NotesReviewPanel item approval', () => {
  it('keeps task edits local until the explicit click and submits owner, due date, and exact identity', async () => {
    const approve = vi.fn((_item: ExactMeetingNotesReviewItem) =>
      Promise.resolve({ status: 'created' as const, message: 'Task created.' })
    );
    render(
      <NotesReviewPanel
        reviewKind="task"
        state={{ kind: 'populated', items: [task] }}
        onApprove={approve}
      />
    );

    fireEvent.change(screen.getByTestId('notes-review-task-title-call-cpa'), {
      target: { value: 'Call tax advisor' },
    });
    fireEvent.change(screen.getByTestId('notes-review-task-owner-call-cpa'), {
      target: { value: 'advisor-b' },
    });
    fireEvent.change(screen.getByTestId('notes-review-task-due-call-cpa'), {
      target: { value: '2026-08-05' },
    });
    expect(approve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('notes-review-approve-call-cpa'));
    await waitFor(() => {
      expect(approve).toHaveBeenCalledTimes(1);
    });
    expect(approve.mock.calls[0]?.[0]).toMatchObject({
      artifactId: 'artifact-actions',
      meetingId: 'meeting-review',
      client,
      title: 'Call tax advisor',
      ownerRef: 'advisor-b',
      dueDate: '2026-08-05',
      transcriptRef: 'meeting:meeting-review#42000',
    });
    expect(screen.getByTestId('notes-review-approved-call-cpa')).toHaveTextContent(
      'Task created.'
    );
  });

  it('shows the typed CRM before value, edits only proposed, and does not write on render or type', async () => {
    const approve = vi.fn((_item: ExactMeetingNotesReviewItem) =>
      Promise.resolve({ status: 'sent' as const, message: 'CRM updated.' })
    );
    render(
      <NotesReviewPanel
        reviewKind="crm-update"
        state={{ kind: 'populated', items: [crm] }}
        onApprove={approve}
      />
    );
    const before = screen.getByTestId(
      'notes-review-crm-before-risk-update-risk_tolerance'
    );
    expect(before).toHaveValue('Conservative');
    expect(before).toHaveAttribute('readonly');
    fireEvent.change(
      screen.getByTestId(
        'notes-review-crm-proposed-risk-update-risk_tolerance'
      ),
      { target: { value: 'Balanced' } }
    );
    expect(approve).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('notes-review-approve-risk-update'));
    await waitFor(() => {
      expect(approve).toHaveBeenCalledTimes(1);
    });
    expect(approve.mock.calls[0]?.[0]).toMatchObject({
      fields: [
        {
          field: 'risk_tolerance',
          before: 'Conservative',
          proposed: 'Balanced',
        },
      ],
    });
  });

  it('renders an already-approved proposal without an approval button', () => {
    render(
      <NotesReviewPanel
        reviewKind="task"
        state={{
          kind: 'populated',
          items: [{ ...task, approvalState: 'approved' }],
        }}
        onApprove={vi.fn()}
      />
    );
    expect(screen.getByTestId('notes-review-approved-call-cpa')).toHaveTextContent(
      'Approved earlier.'
    );
    expect(screen.queryByTestId('notes-review-approve-call-cpa')).toBeNull();
  });

  it('keeps a saved approval visible when later destination delivery fails', async () => {
    const failure = Object.assign(
      new Error('Approval was recorded, but delivery failed.'),
      { approvalRecorded: true as const, retryable: true as const }
    );
    render(
      <NotesReviewPanel
        reviewKind="task"
        state={{ kind: 'populated', items: [task] }}
        onApprove={() => Promise.reject(failure)}
      />
    );
    fireEvent.click(screen.getByTestId('notes-review-approve-call-cpa'));
    expect(
      await screen.findByTestId('notes-review-retry-delivery-call-cpa')
    ).toHaveTextContent('Retry delivery');
    expect(screen.getByTestId('notes-review-error-call-cpa')).toHaveTextContent(
      'delivery failed'
    );
    expect(screen.queryByTestId('notes-review-approve-call-cpa')).toBeNull();
  });

  it('shows pending as outcome unknown and failed as terminal without action buttons', () => {
    const { rerender } = render(
      <NotesReviewPanel
        reviewKind="task"
        state={{
          kind: 'populated',
          items: [
            {
              ...task,
              approvalState: 'approved',
              delivery: {
                key: 'meeting-delivery-a',
                status: 'pending',
                attempt: 1,
              },
            },
          ],
        }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(
      screen.getByTestId('notes-review-outcome-unknown-call-cpa')
    ).toHaveTextContent('Do not retry');
    expect(screen.queryByTestId('notes-review-retry-delivery-call-cpa')).toBeNull();
    expect(screen.queryByTestId('notes-review-reject-call-cpa')).toBeNull();

    rerender(
      <NotesReviewPanel
        reviewKind="task"
        state={{
          kind: 'populated',
          items: [
            {
              ...task,
              approvalState: 'approved',
              delivery: {
                key: 'meeting-delivery-a',
                status: 'failed',
                attempt: 1,
              },
            },
          ],
        }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(
      screen.getByTestId('notes-review-delivery-failed-call-cpa')
    ).toHaveTextContent('cannot be retried');
    expect(screen.queryByTestId('notes-review-retry-delivery-call-cpa')).toBeNull();
  });

  it('submits the exact local edit to rejection without approving or delivering it', async () => {
    const approve = vi.fn();
    const reject = vi.fn((_item: ExactMeetingNotesReviewItem) =>
      Promise.resolve()
    );
    render(
      <NotesReviewPanel
        reviewKind="task"
        state={{ kind: 'populated', items: [task] }}
        onApprove={approve}
        onReject={reject}
      />
    );
    fireEvent.change(screen.getByTestId('notes-review-task-title-call-cpa'), {
      target: { value: 'Do not call the CPA' },
    });
    fireEvent.click(screen.getByTestId('notes-review-reject-call-cpa'));
    await waitFor(() => {
      expect(reject).toHaveBeenCalledTimes(1);
    });
    expect(reject.mock.calls[0]?.[0]).toMatchObject({
      title: 'Do not call the CPA',
      proposalRevision: 'proposal-task',
    });
    expect(approve).not.toHaveBeenCalled();
  });
});

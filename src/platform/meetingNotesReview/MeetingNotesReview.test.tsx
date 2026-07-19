import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { MeetingNotesReview } from './MeetingNotesReview';
import type { ExactMeetingNotesReviewRepository } from './notesReviewDelivery';
import type { ExactMeetingTaskReviewItem } from '@/ui/notesReview';

const task: ExactMeetingTaskReviewItem = {
  id: 'rollover',
  artifactId: 'artifact-1',
  meetingId: 'meeting-1',
  client: { householdRef: 'household-1', matterId: 'matter-1' },
  kind: 'task',
  title: 'Start rollover paperwork',
  detail: 'Send the transfer form.',
  ownerRef: 'advisor-1',
  dueDate: '2026-08-01',
  transcriptRef: 'meeting:meeting-1#12000',
  approvalState: 'proposed',
};

function repository(
  list: ExactMeetingNotesReviewRepository['list'] = vi.fn(() =>
    Promise.resolve([task])
  ),
  approve: ExactMeetingNotesReviewRepository['approve'] = vi.fn(() =>
    Promise.resolve({
      status: 'created' as const,
      message: 'Task created.',
    })
  )
): ExactMeetingNotesReviewRepository {
  return {
    list,
    readFacts: vi.fn(() =>
      Promise.resolve({
        meetingId: 'meeting-1',
        client: task.client,
        tasks: [task],
        crmUpdates: [],
        proposedCount: 1,
        approvedCount: 0,
      })
    ),
    approve,
  };
}

describe('MeetingNotesReview', () => {
  it('loads a populated exact-meeting tab and marks only the clicked item approved', async () => {
    const approveProposal = vi.fn<ExactMeetingNotesReviewRepository['approve']>(
      () => Promise.resolve({ status: 'created', message: 'Task created.' })
    );
    const repo = repository(undefined, approveProposal);
    render(
      <MeetingNotesReview reviewKind="task" repository={repo} />
    );
    expect(screen.getByTestId('notes-review-task-loading')).toBeInTheDocument();
    const approve = await screen.findByTestId('notes-review-approve-rollover');
    expect(approveProposal).not.toHaveBeenCalled();
    fireEvent.click(approve);
    await waitFor(() => {
      expect(approveProposal).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('notes-review-approved-rollover')).toHaveTextContent(
      'Task created.'
    );
  });

  it('keeps a truthful not-produced state distinct from a blocked state', async () => {
    const empty = repository(vi.fn(() => Promise.resolve([])));
    const { rerender } = render(
      <MeetingNotesReview reviewKind="crm-update" repository={empty} />
    );
    expect(
      await screen.findByTestId('notes-review-crm-update-empty')
    ).toBeInTheDocument();

    rerender(
      <MeetingNotesReview
        key="blocked"
        reviewKind="crm-update"
        repository={null}
        blockedReason="Meeting identity is blocked."
      />
    );
    expect(
      screen.getByTestId('notes-review-crm-update-blocked')
    ).toHaveTextContent('Meeting identity is blocked.');
  });

  it('turns a local read failure into safe copy and retries the same reader', async () => {
    const list = vi
      .fn<ExactMeetingNotesReviewRepository['list']>()
      .mockRejectedValueOnce(
        new Error('/Clients/Webb/Meetings/secret/meeting-artifact.json')
      )
      .mockResolvedValueOnce([task]);
    render(
      <MeetingNotesReview
        reviewKind="task"
        repository={repository(list)}
      />
    );
    expect(await screen.findByTestId('notes-review-task-error')).toHaveTextContent(
      'Could not load the saved meeting proposals.'
    );
    expect(screen.queryByText(/Clients\/Webb/)).toBeNull();
    fireEvent.click(screen.getByTestId('notes-review-task-retry'));
    expect(await screen.findByTestId('notes-review-approve-rollover')).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

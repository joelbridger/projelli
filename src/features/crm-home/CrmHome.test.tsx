/* eslint-disable @typescript-eslint/no-non-null-assertion -- Test setup asserts an intentionally matched element. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CrmHome } from './CrmHome';
import type { CrmHomeAdapter } from './types';

const { useFlag } = vi.hoisted(() => ({
  useFlag: vi.fn((_id: string) => false),
}));

vi.mock('@/platform/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/flags')>()),
  useFlag,
}));

const migration: CrmHomeAdapter['migration'] = {
  workflowChecklists: [
    {
      id: 'workflow-henderson',
      clientLabel: 'Henderson household',
      sourceTemplateLabel: 'Annual review',
      activityEvidence: ['Activity trace'],
      availableSteps: ['Prepare review', 'Confirm meeting'],
      decision: 'pending',
    },
    {
      id: 'workflow-ortiz',
      clientLabel: 'Ortiz household',
      sourceTemplateLabel: 'Onboarding',
      activityEvidence: ['Legacy Project'],
      availableSteps: ['Open accounts'],
      decision: 'pending',
    },
  ],
  attachmentAccounting: [
    {
      id: 'attachment-henderson',
      clientLabel: 'Henderson household',
      status: 'pending',
    },
    {
      id: 'attachment-ortiz',
      clientLabel: 'Ortiz household',
      status: 'pending',
    },
  ],
  exports: [
    { kind: 'archive', status: 'ready', manifestId: 'manifest_001' },
    { kind: 'rollback', status: 'ready' },
  ],
};

function adapter(overrides: Partial<CrmHomeAdapter> = {}): CrmHomeAdapter {
  const { actions, ...rest } = overrides;
  return {
    freshness: { kind: 'live' },
    tasks: [],
    offers: [],
    migration,
    actions: {
      updateTask: () => undefined,
      applyPropagation: () => undefined,
      undoPropagation: () => ({ restored: 0, protectedCells: [] }),
      markNotificationsRead: () => undefined,
      recordWorkflowChecklist: () => undefined,
      recordAttachmentAccounting: () => undefined,
      createExport: () => undefined,
      retryExport: () => undefined,
      ...actions,
    },
    ...rest,
  };
}

describe('CrmHome', () => {
  it('shows one Activity destination instead of a duplicate Timeline destination', () => {
    render(<CrmHome />);
    expect(screen.getByTestId('crm-home-nav-activity')).toBeInTheDocument();
    expect(
      screen.queryByTestId('crm-home-nav-timeline')
    ).not.toBeInTheDocument();
  });

  it('keeps the legacy Activity route intact while off, then swaps only its content when the team feed is on', () => {
    const { rerender } = render(<CrmHome initialRoute="activity" />);
    expect(screen.getByTestId('crm-home-nav-activity')).toBeInTheDocument();
    expect(screen.getByTestId('crm-activity-surface')).toBeInTheDocument();
    expect(screen.queryByTestId('team-activity-feed')).not.toBeInTheDocument();

    useFlag.mockImplementation((id: string) => id === 'team-activity-feed');
    rerender(<CrmHome initialRoute="activity" />);
    expect(screen.getByTestId('crm-home-nav-activity')).toBeInTheDocument();
    expect(screen.getByTestId('team-activity-feed')).toBeInTheDocument();
    expect(screen.queryByTestId('crm-activity-surface')).not.toBeInTheDocument();
    useFlag.mockImplementation(() => false);
  });

  it('hides a flag-gated rail destination until its flag is enabled', () => {
    const { rerender } = render(<CrmHome />);
    expect(screen.queryByTestId('crm-home-nav-trash')).not.toBeInTheDocument();

    useFlag.mockImplementation((id: string) => id === 'crm-trash-recovery');
    rerender(<CrmHome />);
    expect(screen.getByTestId('crm-home-nav-trash')).toBeInTheDocument();
    useFlag.mockImplementation(() => false);
  });

  it('falls back to Today when a flag-gated route is requested while off', () => {
    render(<CrmHome initialRoute="internal-projects" />);

    expect(screen.getByTestId('crm-screen-today')).toBeInTheDocument();
    expect(
      screen.queryByTestId('internal-projects-surface')
    ).not.toBeInTheDocument();
  });

  it('renders a flag-gated route when its flag is on', () => {
    useFlag.mockImplementation((id: string) => id === 'internal-projects');

    render(<CrmHome initialRoute="internal-projects" />);

    expect(screen.getByTestId('internal-projects-surface')).toBeInTheDocument();
    useFlag.mockImplementation(() => false);
  });

  it('uses the same Search records name in the navigation and on the destination', () => {
    render(<CrmHome />);
    const navigationItem = screen.getByTestId('crm-home-nav-search');
    fireEvent.click(navigationItem);
    expect(screen.getByTestId('crm-search-surface-label')).toHaveTextContent(
      navigationItem.textContent ?? ''
    );
  });

  it('does not show a delivery warning in the default solo workspace', () => {
    render(<CrmHome />);
    expect(screen.getByTestId('crm-home')).toBeInTheDocument();
    expect(
      screen.queryByTestId('crm-freshness-banner')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-screen-today')).toBeInTheDocument();
    expect(screen.getByTestId('crm-today-first-use')).toHaveTextContent(
      /ready to set up today/i
    );
    expect(screen.queryByText('Henderson household')).not.toBeInTheDocument();
  });

  it('shows sample records only through the visibly labelled preview mode', () => {
    render(<CrmHome preview />);
    expect(screen.getByTestId('crm-home-preview-label')).toHaveTextContent(
      /preview mode/i
    );
    expect(
      screen.queryByTestId('crm-freshness-banner')
    ).not.toBeInTheDocument();
  });

  it('does not show a delivery warning while a configured firm relay is live', () => {
    render(<CrmHome adapter={adapter({ freshness: { kind: 'live' } })} />);
    expect(
      screen.queryByTestId('crm-freshness-banner')
    ).not.toBeInTheDocument();
  });

  it('shows the delivery warning when a configured firm relay is disconnected', () => {
    render(<CrmHome adapter={adapter({ freshness: { kind: 'offline' } })} />);
    expect(screen.getByTestId('crm-freshness-banner')).toHaveTextContent(
      'Working offline. Local edits work; delivery waits until you reconnect.'
    );
  });

  it('saves a direct task edit through the supplied adapter', () => {
    const updateTask = vi.fn();
    render(
      <CrmHome
        adapter={adapter({
          tasks: [
            {
              id: 't1',
              title: 'Call client',
              assigneeUserId: 'maya',
              assigneeLabel: 'Maya',
              status: 'open',
              priority: 'normal',
              tagIds: [],
            },
          ],
          actions: { updateTask },
        })}
        initialRoute="tasks"
      />
    );
    fireEvent.click(screen.getByTestId('crm-task-open-t1'));
    fireEvent.change(screen.getByTestId('crm-task-title-input'), {
      target: { value: 'Call client today' },
    });
    fireEvent.click(screen.getByTestId('crm-task-save'));
    expect(updateTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Call client today' })
    );
  });

  it('computes Today from supplied records and keeps approval decisions as history', () => {
    const decideApproval = vi.fn();
    const today = new Date().toISOString().slice(0, 10);
    render(
      <CrmHome
        adapter={adapter({
          tasks: [
            {
              id: 'due',
              title: 'Due now',
              assigneeUserId: 'advisor',
              status: 'open',
              priority: 'high',
              tagIds: [],
              dueAt: today,
            },
          ],
          approvals: [
            {
              id: 'proposal-1',
              title: 'Review proposed task',
              state: 'pending',
            },
          ],
          activity: [
            {
              id: 'activity-1',
              summary: 'Task created',
              at: new Date().toISOString(),
            },
          ],
          actions: { decideApproval },
        })}
      />
    );
    expect(screen.getByTestId('crm-today-triage')).toHaveTextContent(
      /what needs attention first/i
    );
    expect(screen.getByTestId('crm-today-task-due')).toHaveTextContent(
      /due today/i
    );
    expect(screen.getByTestId('crm-recent-activity')).toHaveTextContent(
      /task created/i
    );
    fireEvent.click(screen.getByTestId('crm-approval-approve-proposal-1'));
    expect(decideApproval).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proposal-1' }),
      'approved'
    );
  });

  it('uses real firm members for assignment and puts workflow steps in the same work list', () => {
    const completeWorkflowWorkItem = vi.fn();
    render(
      <CrmHome
        adapter={adapter({
          tasks: [
            {
              id: 'task-1',
              title: 'Call client',
              assigneeUserId: null,
              status: 'open',
              priority: 'normal',
              tagIds: [],
            },
          ],
          firmMembers: [
            { userId: 'maya', displayName: 'Maya Patel', title: 'Advisor' },
          ],
          workflowWorkItems: [
            {
              id: 'workflow-1:step-1',
              instanceId: 'workflow-1',
              stepId: 'step-1',
              title: 'Confirm transfer',
              householdId: 'hh-1',
              householdLabel: 'Henderson household',
              assigneeUserId: 'maya',
              assigneeLabel: 'Maya Patel',
              status: 'open',
              priority: 'normal',
              tagIds: [],
            },
          ],
          actions: { completeWorkflowWorkItem },
        })}
        initialRoute="tasks"
      />
    );
    expect(
      screen.getByTestId('crm-workflow-work-workflow-1:step-1')
    ).toHaveTextContent(/workflow step/i);
    fireEvent.click(
      screen.getByTestId('crm-workflow-work-complete-workflow-1:step-1')
    );
    expect(completeWorkflowWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId: 'workflow-1', stepId: 'step-1' })
    );
    fireEvent.click(screen.getByTestId('crm-task-open-task-1'));
    expect(screen.getByTestId('crm-task-assignee')).toHaveTextContent(
      /maya patel/i
    );
  });

  it('blocks Apply until every concurrent propagation decision is explicitly reviewed', () => {
    const applyPropagation = vi.fn();
    render(
      <CrmHome
        adapter={adapter({
          offers: [
            {
              id: 'offer-1',
              instanceId: 'instance-1',
              householdLabel: 'Henderson household',
              revisionLabel: 'Named update',
              state: 'needs-decision',
              steps: [
                {
                  id: 'step-1',
                  label: 'Confirm transfer',
                  changeKind: 'modify',
                  protectedProgress: {
                    status: 'completed',
                    hasNotes: true,
                    hasCompletion: true,
                    hasOutcome: true,
                    hasAssignmentHistory: true,
                  },
                  decisions: [
                    {
                      id: 'decision-1',
                      revisionId: 'revision-1',
                      stepId: 'step-1',
                      field: 'due_offset',
                      label: 'Due offset',
                      after: '+4 days',
                      decision: 'review_required',
                      reofferState: 'original',
                    },
                  ],
                },
              ],
            },
          ],
          actions: { applyPropagation },
        })}
        initialRoute="propagation"
      />
    );
    expect(screen.getByTestId('crm-propagation-apply')).toBeDisabled();
    expect(
      screen.getByTestId('crm-propagation-review-required')
    ).toBeInTheDocument();
    expect(screen.getByText(/template updated/i)).toBeInTheDocument();
    expect(screen.getByText('Details for support')).toBeInTheDocument();
    expect(screen.queryByText(/stable step id/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-propagation-accept-decision-1'));
    expect(screen.getByTestId('crm-propagation-apply')).toBeEnabled();
    fireEvent.click(screen.getByTestId('crm-propagation-apply'));
    expect(applyPropagation).toHaveBeenCalledWith([
      {
        offerId: 'offer-1',
        instanceId: 'instance-1',
        acceptedDecisions: [
          {
            id: 'decision-1',
            revisionId: 'revision-1',
            stepId: 'step-1',
            field: 'due_offset',
            reofferState: 'original',
          },
        ],
      },
    ]);
    expect(screen.getByTestId('crm-propagation-result')).toHaveTextContent(
      /workflow change.*ready to apply.*completed work and notes will not change/i
    );
  });

  it('uses plain-language migration actions instead of making the firm decode import terms', () => {
    render(
      <CrmHome
        adapter={adapter({
          migration: {
            ...migration,
            noteGaps: [
              {
                id: 'note-gap-1',
                label: 'Follow up with Henderson',
                reason: 'It was not linked to a client.',
              },
            ],
            report: {
              batchId: 'batch-1',
              generatedAt: '2026-07-12T00:00:00Z',
              message: 'Import finished.',
              matrix: [
                {
                  sourceType: 'note',
                  fetched: 12,
                  imported: 0,
                  skipped: 12,
                  rejected: 0,
                  plainReason:
                    '12 notes could not be imported because they were not linked to a client.',
                },
              ],
              attachments: {
                viaApi: 'Not available',
                affected: 2,
                exported: 0,
                gaps: 0,
                unaccounted: 2,
              },
              workflows: { checklists: 1, pending: 1 },
            },
          },
        })}
        initialRoute="fidelity"
      />
    );
    expect(
      screen.getByTestId('crm-migration-decision-dashboard')
    ).toHaveTextContent(
      /not ready to switch yet: 15 items need your firm’s decision/i
    );
    expect(
      screen.getByText(/12 notes we could not bring over/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /check them in wealthbox, then add any important note to the right household/i
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-migration-open-note-gaps'));
    expect(screen.getByTestId('crm-migration-note-gap-list')).toHaveTextContent(
      /follow up with henderson/i
    );
  });

  it('reports protected propagation cells for both button and keyboard Undo', () => {
    const undoPropagation = vi.fn(() => ({
      restored: 2,
      protectedCells: ['Henderson due offset — later local edit'],
    }));
    render(
      <CrmHome
        adapter={adapter({ actions: { undoPropagation } })}
        initialRoute="propagation"
      />
    );
    fireEvent.click(screen.getByTestId('crm-propagation-undo'));
    expect(screen.getByTestId('crm-propagation-undo-report')).toHaveTextContent(
      /protected cells kept/i
    );
    fireEvent.keyDown(window, { key: 'u' });
    expect(undoPropagation).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('crm-propagation-undo-report')).toHaveTextContent(
      /later local edit/i
    );
  });

  it('requires a complete per-client workflow record and attachment outcome', () => {
    const recordWorkflowChecklist = vi.fn();
    const recordAttachmentAccounting = vi.fn();
    const { rerender } = render(
      <CrmHome
        adapter={adapter({
          actions: { recordWorkflowChecklist, recordAttachmentAccounting },
        })}
        initialRoute="workflow-recreation"
      />
    );
    expect(screen.getAllByTestId(/crm-workflow-checklist-/)).toHaveLength(2);
    expect(
      screen.getByTestId('crm-workflow-record-workflow-henderson')
    ).toBeDisabled();
    fireEvent.click(
      screen.getByTestId('crm-workflow-evidence-workflow-henderson')
    );
    fireEvent.change(
      screen.getByTestId('crm-workflow-step-workflow-henderson'),
      { target: { value: 'Prepare review' } }
    );
    fireEvent.click(screen.getAllByText('Rebuild this workflow')[0]!);
    fireEvent.change(
      screen.getByTestId('crm-workflow-instance-workflow-henderson'),
      { target: { value: 'winst_henderson_review' } }
    );
    fireEvent.click(
      screen.getByTestId('crm-workflow-record-workflow-henderson')
    );
    expect(recordWorkflowChecklist).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedCurrentStep: 'Prepare review',
        resultingInstanceLabel: 'winst_henderson_review',
      })
    );

    rerender(
      <CrmHome
        key="attachments"
        adapter={adapter({
          actions: { recordWorkflowChecklist, recordAttachmentAccounting },
        })}
        initialRoute="attachment-accounting"
      />
    );
    expect(
      screen.getAllByTestId(/^crm-attachment-record-attachment-/)
    ).toHaveLength(2);
    fireEvent.change(
      screen.getByTestId('crm-attachment-status-attachment-henderson'),
      { target: { value: 'exported' } }
    );
    expect(
      screen.getByTestId('crm-attachment-record-save-attachment-henderson')
    ).toBeDisabled();
    fireEvent.change(
      screen.getByTestId('crm-attachment-source-attachment-henderson'),
      { target: { value: 'Wealthbox export' } }
    );
    fireEvent.change(
      screen.getByTestId('crm-attachment-operator-attachment-henderson'),
      { target: { value: 'Maya' } }
    );
    fireEvent.click(
      screen.getByTestId('crm-attachment-record-save-attachment-henderson')
    );
    expect(recordAttachmentAccounting).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'exported',
        exportSource: 'Wealthbox export',
        exportedBy: 'Maya',
      })
    );
  });


  it('shows a migration completion refusal and does not mark the checklist saved', async () => {
    const recordWorkflowChecklist = vi
      .fn()
      .mockRejectedValue(new Error('Finish the required earlier step first.'));
    render(
      <CrmHome
        adapter={adapter({ actions: { recordWorkflowChecklist } })}
        initialRoute="workflow-recreation"
      />
    );
    fireEvent.click(
      screen.getByTestId('crm-workflow-evidence-workflow-henderson')
    );
    fireEvent.change(
      screen.getByTestId('crm-workflow-step-workflow-henderson'),
      { target: { value: 'Confirm meeting' } }
    );
    fireEvent.click(screen.getAllByText('Rebuild this workflow')[0]!);
    fireEvent.change(
      screen.getByTestId('crm-workflow-instance-workflow-henderson'),
      { target: { value: 'Imported annual review' } }
    );
    fireEvent.click(
      screen.getByTestId('crm-workflow-record-workflow-henderson')
    );

    await waitFor(() => {
      expect(screen.getByTestId('crm-migration-error')).toHaveTextContent(
        'Finish the required earlier step first.'
      );
    });
    expect(recordWorkflowChecklist).toHaveBeenCalledOnce();
    expect(
      screen.queryByTestId('crm-workflow-recorded-workflow-henderson')
    ).not.toBeInTheDocument();
  });

  it('renders supplied failed and exported export states with their required evidence', () => {
    const retryExport = vi.fn();
    const { rerender } = render(
      <CrmHome
        adapter={adapter({
          migration: {
            ...migration,
            exports: [
              {
                kind: 'archive',
                status: 'exported',
                exportedAt: 'Jul 11',
                manifestId: 'manifest_abc',
              },
              {
                kind: 'rollback',
                status: 'failed',
                failureReason: 'Destination unavailable',
              },
            ],
          },
        })}
        initialRoute="archive-export"
      />
    );
    expect(screen.getByTestId('crm-exported-status')).toHaveTextContent(
      /manifest id: manifest_abc/i
    );
    rerender(
      <CrmHome
        key="failed-rollback"
        adapter={adapter({
          migration: {
            ...migration,
            exports: [
              { kind: 'archive', status: 'ready' },
              {
                kind: 'rollback',
                status: 'failed',
                failureReason: 'Destination unavailable',
              },
            ],
          },
          actions: { retryExport },
        })}
        initialRoute="rollback-export"
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /destination unavailable/i
    );
    fireEvent.click(screen.getByTestId('crm-export-retry'));
    expect(retryExport).toHaveBeenCalledWith('rollback');
    rerender(
      <CrmHome
        key="rollback"
        adapter={adapter({
          migration: {
            ...migration,
            exports: [
              { kind: 'archive', status: 'ready' },
              {
                kind: 'rollback',
                status: 'exported',
                exportedAt: 'Jul 11',
                reconciliationReportId: 'recon_abc',
              },
            ],
          },
        })}
        initialRoute="rollback-export"
      />
    );
    expect(screen.getByTestId('crm-exported-status')).toHaveTextContent(
      /reconciliation report: recon_abc/i
    );
  });
});

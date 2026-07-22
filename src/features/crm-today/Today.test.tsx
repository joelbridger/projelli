/* eslint-disable lantern-i18n/no-hardcoded-string -- Test fixtures cover frozen CRM copy. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHomeAdapter } from '@/features/crm-home/types';
import { Today, TodaySurface } from './Today';

const meetingStrip = vi.hoisted(() => ({ state: 'visible' as 'visible' | 'empty' | 'error' }));
const selection = vi.hoisted(() => ({
  issue: vi.fn((matterId: string) => ({ matterId })),
  request: vi.fn(() => Promise.resolve({ kind: 'selected' })),
}));

vi.mock('@/features/meetings/TodaysMeetingsStrip', () => ({
  TodaysMeetingsStrip: ({ onOpenClient }: { onOpenClient: (matterId: string) => void }) => {
    if (meetingStrip.state === 'empty') return null;
    if (meetingStrip.state === 'error') {
      return <div data-testid="todays-meetings-strip-error">Couldn&apos;t check today&apos;s calendar.</div>;
    }
    return (
      <button data-testid="todays-meetings-strip" onClick={() => onOpenClient('river-household')}>
        River household meeting
      </button>
    );
  },
}));

vi.mock('@/platform/client-context', () => ({
  issueMatterScopeSelection: selection.issue,
  requestMatterScopeSelection: selection.request,
}));

const baseProps = {
  approvals: [],
  activity: [],
  freshness: { kind: 'live' as const },
  onNavigate: vi.fn(),
  onCompleteWorkItem: vi.fn(),
  onDecideApproval: vi.fn(),
};

describe('Today', () => {
  it('shows the existing meeting preparation strip before the task plan', () => {
    meetingStrip.state = 'visible';
    render(<Today {...baseProps} firmMembers={[]} workItems={[]} />);

    const meetings = screen.getByTestId('todays-meetings-strip');
    const firstUse = screen.getByTestId('crm-today-first-use');
    expect(meetings.compareDocumentPosition(firstUse)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps Today clear when the existing meeting strip has no meetings', () => {
    meetingStrip.state = 'empty';
    render(<Today {...baseProps} firmMembers={[]} workItems={[]} />);

    expect(screen.queryByTestId('todays-meetings-strip')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-today-first-use')).toBeInTheDocument();
  });

  it('keeps the existing calendar failure message visible', () => {
    meetingStrip.state = 'error';
    render(<Today {...baseProps} firmMembers={[]} workItems={[]} />);

    expect(screen.getByTestId('todays-meetings-strip-error')).toHaveTextContent(/couldn't check today/i);
  });

  it('hands a matched meeting client to the shared selection authority', async () => {
    meetingStrip.state = 'visible';
    selection.issue.mockClear();
    selection.request.mockClear();
    render(<Today {...baseProps} firmMembers={[]} workItems={[]} />);

    fireEvent.click(screen.getByTestId('todays-meetings-strip'));

    await waitFor(() => {
      expect(selection.issue).toHaveBeenCalledWith('river-household');
      expect(selection.request).toHaveBeenCalledWith({ matterId: 'river-household' });
    });
  });

  it('renders safely when an adapter omits its optional work lists at runtime', () => {
    const adapter = {
      freshness: { kind: 'live' },
      tasks: undefined,
      offers: [],
      migration: {
        workflowChecklists: [],
        attachmentAccounting: [],
        exports: [],
      },
      actions: {},
    } as unknown as CrmHomeAdapter;

    render(
      <CrmHomeSurfaceContext.Provider
        value={{
          adapter,
          route: 'today',
          navigate: vi.fn(),
          undoReport: null,
          reportUndo: vi.fn(),
          adapterProvided: true,
        }}
      >
        <TodaySurface />
      </CrmHomeSurfaceContext.Provider>
    );

    expect(screen.getByTestId('crm-screen-today')).toBeInTheDocument();
    expect(screen.getByTestId('crm-today-first-use')).toBeInTheDocument();
  });


  it('shows a workflow-completion refusal through the existing attention banner', async () => {
    const completeWorkflowWorkItem = vi
      .fn()
      .mockRejectedValue(new Error('Finish the required earlier step first.'));
    const adapter = {
      freshness: { kind: 'live' },
      tasks: [],
      workflowWorkItems: [
        {
          id: 'workflow-1:step-2',
          instanceId: 'workflow-1',
          stepId: 'step-2',
          title: 'Meet with client',
          workflowLabel: 'Annual client review',
          householdId: 'household-1',
          householdLabel: 'River household',
          assigneeUserId: null,
          status: 'open',
          priority: 'normal',
          tagIds: [],
        },
      ],
      offers: [],
      migration: {
        workflowChecklists: [],
        attachmentAccounting: [],
        exports: [],
      },
      actions: { completeWorkflowWorkItem },
    } as CrmHomeAdapter;

    render(
      <CrmHomeSurfaceContext.Provider
        value={{
          adapter,
          route: 'today',
          navigate: vi.fn(),
          undoReport: null,
          reportUndo: vi.fn(),
          adapterProvided: true,
        }}
      >
        <TodaySurface />
      </CrmHomeSurfaceContext.Provider>
    );

    fireEvent.click(
      screen.getByTestId('crm-today-complete-workflow-1:step-2')
    );

    await waitFor(() => {
      expect(screen.getByTestId('crm-freshness-banner')).toHaveTextContent(
        'Finish the required earlier step first.'
      );
    });
    expect(completeWorkflowWorkItem).toHaveBeenCalledOnce();
  });

  it('computes the visible plan from live open work and active members', () => {
    render(
      <Today
        {...baseProps}
        firmMembers={[
          { userId: 'maya', displayName: 'Maya Patel' },
          { userId: 'andy', displayName: 'Andy Lee' },
        ]}
        workItems={[
          {
            id: 'later', title: 'File annual note', kind: 'task', status: 'open',
            priority: 'low', assigneeUserId: 'maya', dueAt: '2030-01-05', tagIds: [],
          },
          {
            id: 'due', title: 'Confirm transfer', kind: 'task', status: 'open',
            priority: 'high', assigneeUserId: 'andy', dueAt: new Date().toISOString().slice(0, 10), tagIds: [],
          },
          {
            id: 'blocked', title: 'Get signed form', kind: 'workflow_step', status: 'blocked',
            priority: 'high', assigneeUserId: 'maya', instanceId: 'annual-review',
            stepId: 'signed-form', workflowLabel: 'Annual client review', householdId: 'henderson', householdLabel: 'Henderson household', tagIds: [],
          },
        ]}
      />
    );

    expect(screen.getByTestId('crm-today-capacity-fit-count')).toHaveTextContent('2 of 3 open items fit today');
    expect(screen.getByTestId('crm-today-plan')).toHaveTextContent('Confirm transfer');
    expect(screen.getByTestId('crm-today-plan')).toHaveTextContent('File annual note');
    expect(screen.queryByTestId('crm-today-task-blocked')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-today-later-blocked')).toHaveTextContent('Get signed form');
  });

  it('does not invent capacity when the firm has no saved active members', () => {
    render(
      <Today
        {...baseProps}
        firmMembers={[]}
        workItems={[
          {
            id: 'one', title: 'Call the client', kind: 'task', status: 'open',
            priority: 'normal', assigneeUserId: null, tagIds: [],
          },
        ]}
      />
    );

    expect(screen.getByTestId('crm-today-capacity-missing')).toHaveTextContent(/add active team members/i);
    expect(screen.getByTestId('crm-today-plan')).toHaveTextContent('Call the client');
    expect(screen.queryByTestId('crm-today-suggested-later')).not.toBeInTheDocument();
  });
});

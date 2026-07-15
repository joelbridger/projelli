/* eslint-disable lantern-i18n/no-hardcoded-string -- Test fixtures cover frozen CRM copy. */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHomeAdapter } from '@/features/crm-home/types';
import { Today, TodaySurface } from './Today';

const baseProps = {
  approvals: [],
  activity: [],
  freshness: { kind: 'live' as const },
  onNavigate: vi.fn(),
  onCompleteWorkItem: vi.fn(),
  onDecideApproval: vi.fn(),
};

describe('Today', () => {
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
            priority: 'low', assigneeUserId: 'maya', dueAt: '2030-01-05',
          },
          {
            id: 'due', title: 'Confirm transfer', kind: 'task', status: 'open',
            priority: 'high', assigneeUserId: 'andy', dueAt: new Date().toISOString().slice(0, 10),
          },
          {
            id: 'blocked', title: 'Get signed form', kind: 'workflow_step', status: 'blocked',
            priority: 'high', assigneeUserId: 'maya', instanceId: 'annual-review',
            stepId: 'signed-form', householdId: 'henderson', householdLabel: 'Henderson household',
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
            priority: 'normal', assigneeUserId: null,
          },
        ]}
      />
    );

    expect(screen.getByTestId('crm-today-capacity-missing')).toHaveTextContent(/add active team members/i);
    expect(screen.getByTestId('crm-today-plan')).toHaveTextContent('Call the client');
    expect(screen.queryByTestId('crm-today-suggested-later')).not.toBeInTheDocument();
  });
});

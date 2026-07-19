import { describe, expect, it } from 'vitest';
import {
  buildCapacityTriage,
  dailyWorkReason,
  dailyWorkSortFacts,
  nextRecurringDue,
} from './index';

describe('task daily work helpers', () => {
  it('ranks real work and limits the plan to active firm members', () => {
    const plan = buildCapacityTriage(
      [
        {
          id: 'later',
          title: 'Later work',
          kind: 'task',
          status: 'open',
          priority: 'low',
          dueAt: '2030-01-03',
          assigneeUserId: 'u1',
        },
        {
          id: 'urgent',
          title: 'Urgent work',
          kind: 'workflow_step',
          status: 'open',
          priority: 'high',
          dueAt: '2030-01-01',
          assigneeUserId: 'u2',
        },
        {
          id: 'blocked',
          title: 'Blocked work',
          kind: 'task',
          status: 'blocked',
          priority: 'high',
          dueAt: '2030-01-01',
          assigneeUserId: 'u1',
        },
      ],
      ['u1', 'u2'],
      '2030-01-01'
    );
    expect(plan.fitsToday.map((item) => item.id)).toEqual([
      'urgent',
      'blocked',
    ]);
    expect(plan.suggestedLater.map((item) => item.id)).toEqual(['later']);
  });

  it('does not pretend to know capacity without active firm members', () => {
    const plan = buildCapacityTriage(
      [
        {
          id: 'one',
          title: 'One',
          kind: 'task',
          status: 'open',
          priority: 'normal',
          assigneeUserId: null,
        },
      ],
      []
    );
    expect(plan.hasCapacitySignal).toBe(false);
    expect(plan.fitsToday).toEqual([]);
  });

  it('uses the displayed facts for every deterministic ranking tie-break', () => {
    const shared = {
      kind: 'task' as const,
      status: 'open' as const,
      priority: 'normal' as const,
      assigneeUserId: null,
      dueAt: '2030-01-01',
      title: 'Same title',
    };
    const plan = buildCapacityTriage(
      [
        { ...shared, id: 'record-b' },
        { ...shared, id: 'record-a' },
        {
          ...shared,
          id: 'blocked',
          status: 'blocked' as const,
          priority: 'high' as const,
        },
      ],
      [],
      '2030-01-01'
    );

    expect(plan.ranked.map((item) => item.id)).toEqual([
      'record-a',
      'record-b',
      'blocked',
    ]);
    const first = plan.ranked[0];
    if (!first) throw new Error('Expected ranked work.');
    expect(dailyWorkSortFacts(first, '2030-01-01')).toEqual({
      dueGroup: 'due_now',
      blocked: false,
      priority: 'normal',
      exactDueDay: '2030-01-01',
      title: 'Same title',
      id: 'record-a',
    });
  });

  it('explains why a saved item appears in the daily order', () => {
    expect(
      dailyWorkReason(
        {
          id: 'late',
          title: 'Late',
          kind: 'task',
          status: 'open',
          priority: 'low',
          assigneeUserId: null,
          dueAt: '2026-07-10',
        },
        '2026-07-12'
      )
    ).toBe('Overdue');
    expect(
      dailyWorkReason(
        {
          id: 'priority',
          title: 'Priority',
          kind: 'task',
          status: 'open',
          priority: 'high',
          assigneeUserId: null,
        },
        '2026-07-12'
      )
    ).toBe('Marked high priority');
  });

  it('materializes the next recurring due date from the completed task', () => {
    expect(
      nextRecurringDue('2030-01-31', { freq: 'monthly', interval: 1 })
    ).toBe('2030-03-03');
    expect(
      nextRecurringDue('2030-01-01', { freq: 'weekly', interval: 2 })
    ).toBe('2030-01-15');
  });
});

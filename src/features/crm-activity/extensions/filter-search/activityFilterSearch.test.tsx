import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SYSTEM_ROLE_PERMISSIONS,
  resolveMemberAccess,
  roleForMember,
} from '@/features/crm-firm/teams-roles';
import {
  filterOwnClientRecords,
  ownClientsEnforcementActive,
  type OwnClientsContext,
  type PermissionOperation,
} from '@/features/crm-permissions';
import {
  activityToolRegistry,
  createActivityToolComposition,
  type ActivityToolContext,
  type ActivityToolState,
  type TeamActivityItem,
} from '@/features/crm-activity/team-feed';
import { setDevFlagOverride } from '@/platform/flags/router';
import {
  defaultActivityFilterSearchState,
  matchesActivityFilterSearch,
  activityFilterSearchTool,
  type ActivityFilterSearchState,
} from '@/features/crm-activity/extensions/filter-search';

function item(
  id: string,
  memberId: string,
  displayName: string,
  body: string,
  options: { mentioned?: readonly string[]; comments?: number; reactions?: number } = {},
): TeamActivityItem {
  return {
    id,
    body,
    author: { memberId, displayName, trust: 'renderer-staged-untrusted' },
    mentionedMemberIds: options.mentioned ?? [],
    createdAt: '2026-07-16T10:00:00.000Z',
    comments: Array.from({ length: options.comments ?? 0 }, (_, index) => ({
      id: `${id}-comment-${String(index)}`,
      kind: 'teamActivityComment' as const,
      matterId: 'firm_home' as const,
      postId: id,
      body: 'Follow-up note',
      author: { memberId: 'jules', displayName: 'Jules', trust: 'renderer-staged-untrusted' as const },
      authority: { identityTrust: 'renderer-staged-untrusted' as const, roleBinding: 'deferred' as const, operationBinding: 'deferred' as const },
      createdAt: '2026-07-16T10:05:00.000Z',
      updatedAt: '2026-07-16T10:05:00.000Z',
    })),
    reactions: Array.from({ length: options.reactions ?? 0 }, (_, index) => ({
      id: `${id}-reaction-${String(index)}`,
      kind: 'teamActivityReaction' as const,
      matterId: 'firm_home' as const,
      postId: id,
      emoji: '👍' as const,
      memberId: 'jules',
      authorshipTrust: 'renderer-staged-untrusted' as const,
      authority: { identityTrust: 'renderer-staged-untrusted' as const, roleBinding: 'deferred' as const, operationBinding: 'deferred' as const },
      createdAt: '2026-07-16T10:05:00.000Z',
      updatedAt: '2026-07-16T10:05:00.000Z',
      active: true,
    })),
  };
}

const sourceItems = [
  item('maya', 'maya', 'Maya', 'Roth conversion is ready', { mentioned: ['jules'] }),
  item('oliver', 'oliver', 'Oliver', 'Planning review is complete', { comments: 1 }),
  item('aisha', 'aisha', 'Aisha', 'Custodian update', { reactions: 1 }),
];

function contextWithState(initial?: ActivityFilterSearchState): {
  context: ActivityToolContext<ActivityFilterSearchState>;
  value: () => ActivityFilterSearchState | undefined;
} {
  let stored = initial;
  const state: ActivityToolState<ActivityFilterSearchState> = {
    get: () => stored,
    set: (next) => { stored = next; },
  };
  return {
    context: { sourceItems, visibleItems: sourceItems, state },
    value: () => stored,
  };
}

afterEach(() => {
  cleanup();
  setDevFlagOverride('activity-filter-search', undefined);
});

describe('activity filter/search registry tool', () => {
  it('is appended once and is completely excluded while its flag is dark', () => {
    const descriptor = activityToolRegistry.find(({ id }) => id === 'activity-filter-search');
    expect(descriptor).toBeDefined();
    expect(activityToolRegistry.filter(({ id }) => id === 'activity-filter-search')).toHaveLength(1);
    expect(descriptor?.isEnabled?.()).toBe(false);
    expect(createActivityToolComposition().tools.filter(({ id }) => id === 'activity-filter-search')).toHaveLength(1);
  });

  it('renders the real registered tool and composes search, kind, person, and reset state', () => {
    setDevFlagOverride('activity-filter-search', true);
    const descriptor = activityToolRegistry.find(({ id }) => id === 'activity-filter-search');
    if (!descriptor) throw new Error('Expected the activity filter/search descriptor.');
    expect(descriptor).toBe(activityFilterSearchTool);
    const holder = contextWithState();
    const view = render(activityFilterSearchTool.mount(holder.context));

    expect(screen.getByTestId('activity-filter-search')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('activity-filter-search-input'), { target: { value: 'roth' } });
    view.rerender(activityFilterSearchTool.mount(holder.context));
    expect(sourceItems.filter((candidate) => activityFilterSearchTool.filter(candidate, holder.context)).map(({ id }) => id))
      .toEqual(['maya']);

    fireEvent.change(screen.getByTestId('activity-filter-search-kind'), { target: { value: 'mentions' } });
    view.rerender(activityFilterSearchTool.mount(holder.context));
    expect(sourceItems.filter((candidate) => activityFilterSearchTool.filter(candidate, holder.context)).map(({ id }) => id))
      .toEqual(['maya']);

    fireEvent.change(screen.getByTestId('activity-filter-search-author'), { target: { value: 'oliver' } });
    view.rerender(activityFilterSearchTool.mount(holder.context));
    expect(sourceItems.filter((candidate) => activityFilterSearchTool.filter(candidate, holder.context))).toEqual([]);

    fireEvent.click(screen.getByTestId('activity-filter-search-reset'));
    expect(holder.value()).toEqual(defaultActivityFilterSearchState);
  });

  it('keeps source ordering and offers an accessible empty-results reset', () => {
    const noMatch = { ...defaultActivityFilterSearchState, query: 'not present' };
    expect(sourceItems.filter((candidate) => matchesActivityFilterSearch(candidate, noMatch)).map(({ id }) => id))
      .toEqual([]);

    const holder = contextWithState(noMatch);
    render(activityFilterSearchTool.renderEmptyResult(holder.context));
    expect(screen.getByTestId('activity-filter-search-empty')).toHaveAttribute('role', 'status');
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(holder.value()).toEqual(defaultActivityFilterSearchState);
  });

  it('reads the native permission mirror honestly without treating display fields as authority', async () => {
    const operation: PermissionOperation = 'read';
    const memberships = [{ memberId: 'maya', roleId: 'advisor' as const, teamIds: [] }];
    const advisor = roleForMember(SYSTEM_ROLE_PERMISSIONS, memberships, 'maya');
    const context: OwnClientsContext = { memberId: 'maya', role: advisor, operation };
    const resolved = resolveMemberAccess(SYSTEM_ROLE_PERMISSIONS, memberships, 'maya');
    const records = [{ id: 'display-only', kind: 'teamActivityPost' }];

    expect(resolved.role).toEqual(advisor);
    expect(await ownClientsEnforcementActive()).toBe(false);
    expect(filterOwnClientRecords(records, context, false)).toBe(records);
  });
});

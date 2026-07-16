import '@/i18n';
import '@testing-library/jest-dom/vitest';
import type { ComponentType } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activityToolRegistry,
  teamActivitySurface,
  type ActivityToolComposition,
  type ActivityToolContext,
  type ActivityToolState,
  type TeamActivityItem,
} from '@/features/crm-activity/team-feed';
import { setDevFlagOverride } from '@/platform/flags/router';
import {
  activityFilterSearchTool,
  defaultActivityFilterSearchState,
  matchesActivityFilterSearch,
  type ActivityFilterSearchState,
} from '@/features/crm-activity/extensions/filter-search';

const runtime = vi.hoisted(() => ({
  invoke: vi.fn(),
  useLiveCrmRecords: vi.fn(),
}));
const permissionDoorway = vi.hoisted(() => ({
  filterOwnClientRecords: vi.fn(),
  ownClientsEnforcementActive: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: runtime.invoke,
  isTauri: () => true,
}));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  LIVE_CRM_RECORDS_CHANGED: 'lantern:crm-live-records-changed',
  useLiveCrmRecords: runtime.useLiveCrmRecords,
}));
vi.mock('@/features/crm-activity', () => ({
  CrmActivitySurface: () => <div data-testid="legacy-activity-surface" />,
}));
vi.mock('@/features/crm-permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/crm-permissions')>()),
  ...permissionDoorway,
}));

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

const sourceRecords = sourceItems.flatMap((activity) => [{
  id: activity.id,
  kind: 'teamActivityPost',
  matterId: 'firm_home',
  body: activity.body,
  author: activity.author,
  mentionedMemberIds: activity.mentionedMemberIds,
  authority: {
    identityTrust: 'renderer-staged-untrusted',
    roleBinding: 'deferred',
    operationBinding: 'deferred',
  },
  createdAt: activity.createdAt,
  updatedAt: activity.createdAt,
}, ...activity.comments, ...activity.reactions]);

const RegisteredActivitySurface = teamActivitySurface.Component as ComponentType<{
  composition?: ActivityToolComposition;
}>;

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

beforeEach(() => {
  vi.clearAllMocks();
  runtime.useLiveCrmRecords.mockReturnValue({
    records: [],
    save: vi.fn(),
    publishSavedRecord: vi.fn((record: unknown) => record),
    reload: vi.fn(),
    error: null,
    workspaceRoot: '/tmp/activity-filter-search-test',
    sharedMatterId: 'firm_home',
  });
  runtime.invoke.mockImplementation((command: string) =>
    Promise.resolve(command === 'crm_activity_list' ? sourceRecords : undefined));
  permissionDoorway.ownClientsEnforcementActive.mockResolvedValue(false);
  permissionDoorway.filterOwnClientRecords.mockImplementation(
    (records: readonly { id: string; kind: string }[], _context: unknown, active: boolean) =>
      active ? [] : records,
  );
});

afterEach(() => {
  cleanup();
  setDevFlagOverride('activity-filter-search', undefined);
  setDevFlagOverride('team-activity-feed', undefined);
});

describe('activity filter/search registry tool', () => {
  it('keeps the real registry byte-identical and permission-inert while its flag is dark', async () => {
    setDevFlagOverride('team-activity-feed', true);
    setDevFlagOverride('activity-filter-search', false);

    const baseline = render(<RegisteredActivitySurface composition={{ tools: [] }} />);
    await within(baseline.container).findByTestId('team-activity-item-maya');
    const baselineHtml = baseline.container.innerHTML;
    baseline.unmount();

    const registered = render(<RegisteredActivitySurface />);
    await within(registered.container).findByTestId('team-activity-item-maya');

    expect(activityToolRegistry.filter(({ id }) => id === 'activity-filter-search')).toEqual([
      activityFilterSearchTool,
    ]);
    expect(registered.container.innerHTML).toBe(baselineHtml);
    expect(within(registered.container).queryByTestId('team-activity-tools')).not.toBeInTheDocument();
    expect(permissionDoorway.ownClientsEnforcementActive).not.toHaveBeenCalled();
    expect(permissionDoorway.filterOwnClientRecords).not.toHaveBeenCalled();
  });

  it('drives search, kind, person, empty state, and reset through the real registered surface', async () => {
    setDevFlagOverride('team-activity-feed', true);
    setDevFlagOverride('activity-filter-search', true);
    render(<RegisteredActivitySurface />);

    await screen.findByTestId('activity-filter-search-input');
    await screen.findByTestId('team-activity-item-maya');
    await waitFor(() => {
      expect(permissionDoorway.filterOwnClientRecords).toHaveBeenLastCalledWith(
        sourceItems.map(({ id }) => ({ id, kind: 'teamActivityPost' })),
        { memberId: '', role: undefined, operation: 'read' },
        false,
      );
    });

    fireEvent.change(screen.getByTestId('activity-filter-search-input'), {
      target: { value: 'roth' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('team-activity-item-maya')).toBeInTheDocument();
      expect(screen.queryByTestId('team-activity-item-oliver')).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('activity-filter-search-kind'), {
      target: { value: 'mentions' },
    });
    expect(screen.getByTestId('team-activity-item-maya')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('activity-filter-search-author'), {
      target: { value: 'oliver' },
    });
    const empty = await screen.findByTestId('activity-filter-search-empty');
    expect(empty).toHaveAttribute('role', 'status');
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear filters' }));

    await screen.findByTestId('team-activity-item-oliver');
    expect(screen.getByTestId('team-activity-item-aisha')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-filter-search-reset')).not.toBeInTheDocument();
  });

  it('fails the staged batch mirror closed if enforcement activates before identity and labels land', async () => {
    setDevFlagOverride('team-activity-feed', true);
    setDevFlagOverride('activity-filter-search', true);
    permissionDoorway.ownClientsEnforcementActive.mockResolvedValue(true);

    render(<RegisteredActivitySurface />);

    await screen.findByTestId('activity-filter-search-empty');
    expect(permissionDoorway.filterOwnClientRecords).toHaveBeenLastCalledWith(
      sourceItems.map(({ id }) => ({ id, kind: 'teamActivityPost' })),
      { memberId: '', role: undefined, operation: 'read' },
      true,
    );
    expect(screen.queryByTestId('team-activity-item-maya')).not.toBeInTheDocument();
    expect(screen.queryByText('Maya')).not.toBeInTheDocument();
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
});

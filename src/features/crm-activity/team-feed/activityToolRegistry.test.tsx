import i18n from '@/i18n';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamActivityFeed, TeamActivityItem } from './contracts';
import type {
  ActivityToolDescriptor,
  ActivityToolState,
  ActivityToolStateValue,
} from './activityToolRegistry';

const mocks = vi.hoisted(() => ({
  items: [] as TeamActivityItem[],
  useFlag: vi.fn(() => true),
  useFlagRegistryVersion: vi.fn(() => 0),
  query: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock('@/platform/flags', () => ({ useFlag: mocks.useFlag }));
vi.mock('@/platform/flags/router', () => ({ useFlagRegistryVersion: mocks.useFlagRegistryVersion }));
vi.mock('@/features/crm-activity', () => ({ CrmActivitySurface: () => <div data-testid="legacy-activity-surface" /> }));
vi.mock('./TeamActivityFeedProvider', () => ({
  TeamActivityFeedProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./useTeamActivityFeed', () => ({
  useTeamActivityFeed: (): TeamActivityFeed => ({
    query: mocks.query,
    subscribe: mocks.subscribe,
    createPost: vi.fn(),
    addComment: vi.fn(),
    setReaction: vi.fn(),
  }),
}));

import { TeamActivitySurface } from './TeamActivitySurface';
import {
  createActivityToolComposition,
  projectActivityItems,
  validateActivityToolDescriptors,
} from './activityToolRegistry';

function item(id: string, memberId: string, body: string): TeamActivityItem {
  return {
    id,
    body,
    author: {
      memberId,
      displayName: memberId === 'maya' ? 'Maya' : 'Oliver',
      trust: 'renderer-staged-untrusted',
    },
    mentionedMemberIds: [],
    createdAt: '2026-07-16T10:00:00.000Z',
    comments: [],
    reactions: [],
  };
}

const sourceItems = [
  item('post-first', 'maya', 'First update'),
  item('post-second', 'oliver', 'Second update'),
  item('post-third', 'maya', 'Third update'),
];

function stateFactory(values = new Map<string, unknown>()) {
  return <Value extends ActivityToolStateValue>(id: string): ActivityToolState<Value> => ({
    get: () => values.get(id) as Value | undefined,
    set: (value) => { values.set(id, value); },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.items = [];
  mocks.useFlag.mockReturnValue(true);
  mocks.useFlagRegistryVersion.mockReturnValue(0);
  mocks.query.mockImplementation(() => Promise.resolve(mocks.items));
  mocks.subscribe.mockReturnValue(vi.fn());
});

afterEach(cleanup);

describe('team activity tool registry seam', () => {
  it('validates, orders, and composes registered feed filters in stable source order', () => {
    const mayaOnly: ActivityToolDescriptor = {
      id: 'test.maya-only',
      order: 20,
      mount: () => null,
      filter: (candidate) => candidate.author.memberId === 'maya',
    };
    const excludesThird: ActivityToolDescriptor = {
      id: 'test.exclude-third',
      order: 10,
      mount: () => null,
      filter: (candidate) => candidate.id !== 'post-third',
    };
    const composition = createActivityToolComposition(mayaOnly, excludesThird);

    expect(composition.tools.map(({ id }) => id)).toEqual([
      'test.exclude-third',
      'test.maya-only',
    ]);
    expect(projectActivityItems(sourceItems, composition.tools, stateFactory()).map(({ id }) => id))
      .toEqual(['post-first']);
    expect(sourceItems.map(({ id }) => id)).toEqual(['post-first', 'post-second', 'post-third']);
  });

  it('rejects duplicate IDs and malformed descriptors loudly at composition time', () => {
    const tool: ActivityToolDescriptor = {
      id: 'test.duplicate',
      order: 10,
      mount: () => null,
    };

    expect(() => createActivityToolComposition(tool, { ...tool, order: 20 }))
      .toThrow('[activityToolRegistry] duplicate id: test.duplicate');
    expect(() => { validateActivityToolDescriptors([{ ...tool, order: Number.NaN }]); })
      .toThrow('[activityToolRegistry] order must be finite: test.duplicate');
    expect(() => { validateActivityToolDescriptors([{ ...tool, mount: undefined as never }]); })
      .toThrow('[activityToolRegistry] mount must be a function: test.duplicate');
  });

  it('gives a tool scoped reactive state that immediately re-projects the real feed', async () => {
    mocks.items = [...sourceItems];
    const tool: ActivityToolDescriptor<'maya'> = {
      id: 'test.reactive-filter',
      order: 10,
      mount: (context) => <button type="button" onClick={() => { context.state.set('maya'); }}>
        {i18n.t('team-activity-feed.mentioned')} ({context.visibleItems.length})
      </button>,
      filter: (candidate, context) => context.state.get() === undefined
        || candidate.author.memberId === context.state.get(),
      renderEmptyResult: () => <p role="status">{i18n.t('team-activity-feed.empty')}</p>,
    };

    render(<TeamActivitySurface composition={createActivityToolComposition(tool)} />);
    await screen.findByTestId('team-activity-item-post-third');
    fireEvent.click(screen.getByRole('button', { name: `${i18n.t('team-activity-feed.mentioned')} (3)` }));

    expect(screen.getByTestId('team-activity-item-post-first')).toBeInTheDocument();
    expect(screen.queryByTestId('team-activity-item-post-second')).not.toBeInTheDocument();
    expect(screen.getByTestId('team-activity-item-post-third')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${i18n.t('team-activity-feed.mentioned')} (2)` })).toBeInTheDocument();
  });

  it('passes copies to filters so a tool cannot mutate source data or another filter view', () => {
    type FilterItem = Parameters<NonNullable<ActivityToolDescriptor['filter']>>[0];
    const secondFilter = vi.fn((candidate: FilterItem) => candidate.body === 'First update');
    const mutationAttempt: ActivityToolDescriptor = {
      id: 'test.mutation-attempt',
      order: 10,
      mount: () => null,
      filter: (candidate, context) => {
        (candidate as TeamActivityItem).body = 'Changed candidate';
        (context.sourceItems[0] as TeamActivityItem).body = 'Changed context';
        return true;
      },
    };
    const observer: ActivityToolDescriptor = {
      id: 'test.observer',
      order: 20,
      mount: () => null,
      filter: secondFilter,
    };
    const before = structuredClone(sourceItems);

    const projected = projectActivityItems(
      sourceItems,
      createActivityToolComposition(mutationAttempt, observer).tools,
      stateFactory(),
    );

    expect(projected.map(({ id }) => id)).toEqual(['post-first']);
    expect(secondFilter.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ body: 'First update' }));
    expect(sourceItems).toEqual(before);
  });

  it('keeps the enabled feed HTML byte-identical when no tools are registered', async () => {
    mocks.items = [sourceItems[0] as TeamActivityItem];
    const first = render(<TeamActivitySurface />);
    await screen.findByTestId('team-activity-item-post-first');
    const baseHtml = screen.getByTestId('team-activity-feed').innerHTML;
    first.unmount();

    render(<TeamActivitySurface composition={createActivityToolComposition()} />);
    await screen.findByTestId('team-activity-item-post-first');

    expect(screen.queryByTestId('team-activity-tools')).not.toBeInTheDocument();
    expect(screen.getByTestId('team-activity-feed').innerHTML).toBe(baseHtml);
  });

  it('excludes a dark feature before its tool or filter can receive feed data', async () => {
    mocks.items = [sourceItems[0] as TeamActivityItem];
    const mount = vi.fn(() => <button type="button">{i18n.t('team-activity-feed.title')}</button>);
    const filter = vi.fn(() => true);
    const darkTool: ActivityToolDescriptor = {
      id: 'test.dark-tool',
      order: 10,
      isEnabled: () => false,
      mount,
      filter,
    };

    render(<TeamActivitySurface composition={createActivityToolComposition(darkTool)} />);
    await screen.findByTestId('team-activity-item-post-first');

    expect(screen.queryByTestId('team-activity-tools')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: i18n.t('team-activity-feed.title') })).not.toBeInTheDocument();
    expect(mount).not.toHaveBeenCalled();
    expect(filter).not.toHaveBeenCalled();
  });

  it('does not inspect the registry while the landed team-feed flag is dark', async () => {
    const enabledCheck = vi.fn(() => true);
    const tool: ActivityToolDescriptor = {
      id: 'test.feed-dark',
      order: 10,
      isEnabled: enabledCheck,
      mount: () => <button type="button">{i18n.t('team-activity-feed.post')}</button>,
    };
    mocks.useFlag.mockReturnValue(false);

    render(<TeamActivitySurface composition={createActivityToolComposition(tool)} />);

    expect(screen.getByTestId('legacy-activity-surface')).toBeInTheDocument();
    expect(enabledCheck).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    await waitFor(() => { expect(mocks.subscribe).not.toHaveBeenCalled(); });
  });
});

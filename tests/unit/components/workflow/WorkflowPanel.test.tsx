/**
 * Stream C1 Group VII — provenance badges + grouping in WorkflowPanel.
 *
 * Scope: this suite focuses on the new badge + grouping behaviour. The rest
 * of WorkflowPanel (chain builder modal, fork modal, run-history rendering,
 * trial-locked behaviour) is exercised by the e2e suite in
 * `tests/e2e/workflows-panel.spec.ts`. We don't re-prove that here.
 *
 * Mocking strategy:
 *   - `loadAllTemplates` returns the local list (built-ins + user templates).
 *   - `useTemplatesMarketplace` returns a fake reader so the panel can pull
 *     community templates without standing up a real workspace.
 *   - `useTrialGate` returns a happy state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
  within,
} from '@testing-library/react';
import type { WorkflowTemplate } from '@/platform/types/workflow';

// ---- Mocks ---------------------------------------------------------------

const mockLoadAllTemplates = vi.fn<() => WorkflowTemplate[]>();
vi.mock('@/features/workflows/engine/userTemplates', () => ({
  loadAllTemplates: () => mockLoadAllTemplates(),
  duplicateTemplate: vi.fn((t: WorkflowTemplate) => t),
  deleteUserTemplate: vi.fn(),
  getSystemPrompt: vi.fn(() => ''),
  saveUserTemplate: vi.fn(),
  setSystemPrompt: vi.fn((t: WorkflowTemplate) => t),
}));

interface MockMarketplace {
  service: unknown;
  reader: { list: (s: unknown) => Promise<WorkflowTemplate[]> } | null;
  cacheStatus: 'fresh';
  updateCount: number;
  setCacheStatus: () => void;
  setUpdateCount: () => void;
}
let marketplaceState: MockMarketplace = {
  service: null,
  reader: null,
  cacheStatus: 'fresh',
  updateCount: 0,
  setCacheStatus: () => {},
  setUpdateCount: () => {},
};
vi.mock('@/features/workflows/useTemplatesMarketplace', () => ({
  useTemplatesMarketplace: () => marketplaceState,
}));

vi.mock('@/platform/hooks/useTrial', () => ({
  useTrialGate: () => ({
    isLocked: false,
    daysRemaining: 30,
    isTrialExpired: false,
    isActivated: true,
    trialDays: 30,
  }),
}));

// Render-time stubs for the chain builder modal (its internals require a
// fully-stocked store that's irrelevant to provenance grouping).
vi.mock('@/features/workflows/ChainBuilderModal', () => ({
  ChainBuilderModal: () => null,
}));

// Import after mocks are in place.
import { WorkflowPanel } from '@/features/workflows/WorkflowPanel';

// ---- Helpers ------------------------------------------------------------

function makeTemplate(
  overrides: Partial<WorkflowTemplate> & { id: string; name: string },
): WorkflowTemplate {
  return {
    description: `Description for ${overrides.name}`,
    version: '1.0.0',
    category: 'custom',
    steps: [],
    requiredInputs: [],
    outputs: [],
    ...overrides,
  } as WorkflowTemplate;
}

beforeEach(() => {
  mockLoadAllTemplates.mockReset();
  marketplaceState = {
    service: null,
    reader: null,
    cacheStatus: 'fresh',
    updateCount: 0,
    setCacheStatus: () => {},
    setUpdateCount: () => {},
  };
});

afterEach(() => cleanup());

// ---- Tests --------------------------------------------------------------

describe('WorkflowPanel — provenance badges (no community)', () => {
  it('built-in templates render in a Built-in group with no per-card badge', () => {
    mockLoadAllTemplates.mockReturnValue([
      makeTemplate({ id: 'builtin-a', name: 'New Business Kickoff' }),
      makeTemplate({ id: 'builtin-b', name: 'Competitor Analysis' }),
    ]);

    render(
      <WorkflowPanel
        onStartWorkflow={() => {}}
        currentExecution={null}
        runHistory={[]}
      />,
    );

    const builtInGroup = screen.getByTestId('workflows-group-built-in');
    expect(builtInGroup).toBeInTheDocument();
    expect(builtInGroup).toHaveTextContent('Built-in');

    expect(screen.queryByTestId('workflows-group-community')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workflows-group-custom')).not.toBeInTheDocument();

    // Per-card community badge not present on built-ins.
    expect(
      screen.queryByTestId('workflow-card-provenance-builtin-a'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('workflow-card-provenance-builtin-b'),
    ).not.toBeInTheDocument();

    // Cards still render with the canonical workflow-card-<id> testid.
    expect(screen.getByTestId('workflow-card-builtin-a')).toBeInTheDocument();
    expect(
      screen
        .getByTestId('workflow-card-builtin-a')
        .getAttribute('data-provenance'),
    ).toBe('built-in');
  });
});

describe('WorkflowPanel — provenance badges (mixed list)', () => {
  it('community templates render Community badge + appear in their own group', async () => {
    mockLoadAllTemplates.mockReturnValue([
      makeTemplate({ id: 'builtin-a', name: 'Built-in A' }),
    ]);
    const community: WorkflowTemplate = makeTemplate({
      id: 'community:investor-update-v1',
      name: 'Investor Update',
      provenance: 'community',
      sourceId: 'investor-update-v1',
    });
    marketplaceState = {
      service: {} as unknown,
      reader: {
        list: vi.fn(async () => [community]),
      },
      cacheStatus: 'fresh',
      updateCount: 0,
      setCacheStatus: () => {},
      setUpdateCount: () => {},
    };

    render(
      <WorkflowPanel
        onStartWorkflow={() => {}}
        currentExecution={null}
        runHistory={[]}
      />,
    );

    // Community list arrives async. Wait for the group to mount.
    await waitFor(() =>
      expect(screen.getByTestId('workflows-group-community')).toBeInTheDocument(),
    );

    const communityGroup = screen.getByTestId('workflows-group-community');
    expect(communityGroup).toHaveTextContent('Community');
    expect(
      within(communityGroup).getByTestId(
        'workflow-card-community:investor-update-v1',
      ),
    ).toBeInTheDocument();

    // The per-card provenance badge renders for community.
    const badge = screen.getByTestId(
      'workflow-card-provenance-community:investor-update-v1',
    );
    expect(badge).toHaveTextContent('Community');
    expect(badge.getAttribute('data-provenance')).toBe('community');
  });

  it('mixed list is grouped in Built-in -> Community -> Custom order, custom user templates land in Custom', async () => {
    const builtIn = makeTemplate({ id: 'builtin-a', name: 'Built-in A' });
    const userTemplate = makeTemplate({
      id: 'user-a',
      name: 'My Remix',
      isUser: true,
    });
    mockLoadAllTemplates.mockReturnValue([builtIn, userTemplate]);

    const community = makeTemplate({
      id: 'community:foo',
      name: 'Community Foo',
      provenance: 'community',
    });
    marketplaceState = {
      service: {} as unknown,
      reader: { list: vi.fn(async () => [community]) },
      cacheStatus: 'fresh',
      updateCount: 0,
      setCacheStatus: () => {},
      setUpdateCount: () => {},
    };

    render(
      <WorkflowPanel
        onStartWorkflow={() => {}}
        currentExecution={null}
        runHistory={[]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('workflows-group-community')).toBeInTheDocument(),
    );

    const list = screen.getByTestId('workflows-grouped-list');
    const groupOrder = Array.from(
      list.querySelectorAll('[data-testid^="workflows-group-"]'),
    )
      .filter((el) =>
        ['workflows-group-built-in', 'workflows-group-community', 'workflows-group-custom']
          .includes(el.getAttribute('data-testid') ?? ''),
      )
      .map((el) => el.getAttribute('data-provenance'));

    expect(groupOrder).toEqual(['built-in', 'community', 'custom']);

    // user-a is grouped under Custom and shows the Custom badge.
    const customGroup = screen.getByTestId('workflows-group-custom');
    expect(within(customGroup).getByTestId('workflow-card-user-a')).toBeInTheDocument();
    expect(
      screen.getByTestId('workflow-card-provenance-user-a'),
    ).toHaveTextContent('Custom');
  });

  it('group toggle collapses + expands its cards', () => {
    mockLoadAllTemplates.mockReturnValue([
      makeTemplate({ id: 'builtin-a', name: 'Built-in A' }),
    ]);

    render(
      <WorkflowPanel
        onStartWorkflow={() => {}}
        currentExecution={null}
        runHistory={[]}
      />,
    );

    expect(screen.getByTestId('workflow-card-builtin-a')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workflows-group-toggle-built-in'));
    expect(screen.queryByTestId('workflow-card-builtin-a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workflows-group-toggle-built-in'));
    expect(screen.getByTestId('workflow-card-builtin-a')).toBeInTheDocument();
  });
});

describe('WorkflowPanel — community fetch failure stays graceful', () => {
  it('reader errors leave the panel rendering only built-ins', async () => {
    mockLoadAllTemplates.mockReturnValue([
      makeTemplate({ id: 'builtin-a', name: 'Built-in A' }),
    ]);
    marketplaceState = {
      service: {} as unknown,
      reader: {
        list: vi.fn(async () => {
          throw new Error('boom');
        }),
      },
      cacheStatus: 'fresh',
      updateCount: 0,
      setCacheStatus: () => {},
      setUpdateCount: () => {},
    };

    render(
      <WorkflowPanel
        onStartWorkflow={() => {}}
        currentExecution={null}
        runHistory={[]}
      />,
    );

    expect(screen.getByTestId('workflow-card-builtin-a')).toBeInTheDocument();
    // Give the failed promise a tick to settle.
    await waitFor(() => {
      expect(screen.queryByTestId('workflows-group-community')).not.toBeInTheDocument();
    });
  });
});

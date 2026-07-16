import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagStore } from '@/features/crm-tags';
import type { CrmHomeAdapter } from '@/features/crm-home';
import type {
  WorkflowTemplateRecord,
  WorkflowTemplateStore,
} from '@/features/crm-workflows';

function tags(): FirmTagStore {
  return {
    catalog: {
      version: 1,
      tags: [
        {
          id: 'tag:planning',
          name: 'Planning',
          color: '#2563eb',
          status: 'active',
        },
      ],
    },
    errorCode: null,
    list: () =>
      Promise.resolve({
        version: 1,
        tags: [
          {
            id: 'tag:planning',
            name: 'Planning',
            color: '#2563eb',
            status: 'active' as const,
          },
        ],
      }),
    create: vi.fn(),
    rename: vi.fn(),
    setColor: vi.fn(),
    retire: vi.fn(),
  };
}

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

function workflowData(name: string, updatedAt: string) {
  return {
    templates: [
      {
        id: 'template:one',
        kind: 'crm_workflow_template' as const,
        matterId: 'firm_home',
        name,
        updatedAt,
        status: 'published' as const,
        tagIds: [],
        steps: [],
        snapshot: {
          id: 'template:one',
          headRevisionIds: [],
          revisions: {},
        },
      },
    ],
    instances: [],
    offers: [],
    meetings: [],
  };
}

function template(
  name: string,
  id = 'template:one'
): WorkflowTemplateRecord {
  return {
    id,
    name,
    status: 'published',
    tagIds: [],
    steps: [],
  };
}

describe('WorkflowAuthoringRuleMount', () => {
  afterEach(() => vi.resetModules());

  it('does no authoring or tag loading while its flag is off', async () => {
    const createStore = vi.fn();
    const createTagStore = vi.fn(tags);
    vi.doMock('@/platform/flags', () => ({ isEnabled: () => false }));
    const { WorkflowAuthoringRuleMount } =
      await import('./WorkflowAuthoringMount');

    const { container } = render(
      <WorkflowAuthoringRuleMount
        templateId="legacy-template"
        createStore={createStore}
        createTagStore={createTagStore}
      />
    );
    expect(container).toBeEmptyDOMElement();
    expect(createStore).not.toHaveBeenCalled();
    expect(createTagStore).not.toHaveBeenCalled();
  });

  it('reloads a changed live snapshot and starts in the selected household matter', async () => {
    vi.doMock('@/platform/flags', () => ({ isEnabled: () => true }));
    const { WorkflowAuthoringRuleMount } =
      await import('./WorkflowAuthoringMount');
    const { CrmHomeSurfaceContext } = await import('@/features/crm-home');
    let listed = [template('Annual review')];
    const start = vi.fn(() =>
      Promise.resolve({
        id: 'instance:one',
        templateId: 'template:one',
        householdId: 'household:one',
        householdLabel: 'River household',
        name: 'Annual review',
        steps: [],
      })
    );
    const store: WorkflowTemplateStore = {
      list: vi.fn(() => Promise.resolve(listed)),
      get: vi.fn(),
      getInstance: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      publish: vi.fn(),
      start,
    };
    const createStore = vi.fn(() => store);
    const context = (name: string, updatedAt: string) => ({
      adapter,
      route: 'workflows' as const,
      navigate: vi.fn(),
      workflowData: workflowData(name, updatedAt),
      workflowHouseholds: [
        {
          id: 'household:one',
          label: 'River household',
          matterId: 'matter:river',
        },
      ],
      undoReport: null,
      reportUndo: vi.fn(),
      adapterProvided: true,
    });
    const view = render(
      <CrmHomeSurfaceContext.Provider
        value={context('Annual review', '2026-07-16T10:00:00Z')}
      >
        <WorkflowAuthoringRuleMount
          templateId="template:one"
          createStore={createStore}
          createTagStore={tags}
        />
      </CrmHomeSurfaceContext.Provider>
    );

    expect(
      await screen.findByText('Annual review', { selector: 'button' })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workflow-authoring-title'), {
      target: { value: 'Unsaved local name' },
    });
    view.rerender(
      <CrmHomeSurfaceContext.Provider
        value={context('Annual review', '2026-07-16T10:30:00Z')}
      >
        <WorkflowAuthoringRuleMount
          templateId="template:one"
          createStore={createStore}
          createTagStore={tags}
        />
      </CrmHomeSurfaceContext.Provider>
    );
    await waitFor(() => {
      expect(screen.getByTestId('workflow-authoring-title')).toHaveValue(
        'Unsaved local name'
      );
    });
    listed = [
      template('Annual review'),
      template('New employee onboarding', 'template:two'),
    ];
    view.rerender(
      <CrmHomeSurfaceContext.Provider
        value={context('Annual review', '2026-07-16T10:45:00Z')}
      >
        <WorkflowAuthoringRuleMount
          templateId="template:one"
          createStore={createStore}
          createTagStore={tags}
        />
      </CrmHomeSurfaceContext.Provider>
    );
    await waitFor(() => {
      expect(
        screen.getByText('New employee onboarding', { selector: 'button' })
      ).toBeInTheDocument();
      expect(screen.getByTestId('workflow-authoring-title')).toHaveValue(
        'Unsaved local name'
      );
    });

    listed = [
      template('Updated annual review'),
      template('New employee onboarding', 'template:two'),
    ];
    view.rerender(
      <CrmHomeSurfaceContext.Provider
        value={context('Updated annual review', '2026-07-16T11:00:00Z')}
      >
        <WorkflowAuthoringRuleMount
          templateId="template:one"
          createStore={createStore}
          createTagStore={tags}
        />
      </CrmHomeSurfaceContext.Provider>
    );
    expect(
      await screen.findByText('Updated annual review', { selector: 'button' })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('workflow-authoring-household'), {
      target: { value: 'household:one' },
    });
    fireEvent.click(screen.getByTestId('workflow-authoring-start'));
    await waitFor(() => {
      expect(start).toHaveBeenCalledWith('template:one', {
        id: 'household:one',
        label: 'River household',
        matterId: 'matter:river',
      });
    });
  });
});

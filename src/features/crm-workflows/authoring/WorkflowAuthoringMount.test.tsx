import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagStore } from '@/features/crm-tags';
import type { CrmHomeAdapter } from '@/features/crm-home';
import type {
  WorkflowAuthoringLibraryDescriptor,
  WorkflowTemplateRecord,
  WorkflowTemplateStore,
} from '@/features/crm-workflows';
import {
  createWorkflowAuthoringLibraryComposition,
  defineWorkflowAuthoringLibraryDescriptor,
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

function template(name: string, id = 'template:one'): WorkflowTemplateRecord {
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
    vi.doMock('@/platform/flags', () => ({
      isEnabled: (id: string) => id === 'workflow-authoring',
    }));
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
    expect(
      screen.queryByTestId('workflow-authoring-filter-controls')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('workflow-authoring-details')
    ).not.toBeInTheDocument();
  });

  it('composes an outside filter and detail renderer into the canonical library', async () => {
    vi.doMock('@/platform/flags', () => ({
      isEnabled: (id: string) => id === 'workflow-authoring',
    }));
    const { WorkflowAuthoringRuleMount } =
      await import('./WorkflowAuthoringMount');
    const draft: WorkflowTemplateRecord = {
      id: 'template:draft',
      name: 'Draft onboarding',
      status: 'draft',
      tagIds: [],
      steps: [{ id: 'step:draft', title: 'Prepare', position: 0, tagIds: [] }],
    };
    const published: WorkflowTemplateRecord = {
      id: 'template:published',
      name: 'Published annual review',
      status: 'published',
      tagIds: [],
      steps: [
        { id: 'step:one', title: 'Prepare', position: 0, tagIds: [] },
        { id: 'step:two', title: 'Meet', position: 1, tagIds: [] },
      ],
    };
    const create = vi.fn<WorkflowTemplateStore['create']>();
    const update = vi.fn<WorkflowTemplateStore['update']>();
    const publish = vi.fn<WorkflowTemplateStore['publish']>();
    const start = vi.fn<WorkflowTemplateStore['start']>();
    const store: WorkflowTemplateStore = {
      list: vi.fn(() => Promise.resolve([draft, published])),
      get: vi.fn(),
      getInstance: vi.fn(),
      create,
      update,
      publish,
      start,
    };
    const extension = defineWorkflowAuthoringLibraryDescriptor<'published'>({
      id: 'outside.status-and-details',
      order: 10,
      mountFilterControl: (context) => (
        <button
          type="button"
          onClick={() => {
            context.state.set('published');
          }}
        >
          Published only ({String(context.visibleTemplates.length)}/
          {String(context.canonicalTemplates.length)})
        </button>
      ),
      filter: (candidate, context) =>
        context.state.get() !== 'published' || candidate.status === 'published',
      renderDetail: (context) => {
        const selected = context.canonicalTemplates.find(
          (candidate) => candidate.id === context.selectedTemplateId
        );
        return selected ? (
          <p>
            Selected: {selected.name} · {String(selected.steps.length)} steps
          </p>
        ) : (
          <p data-testid="outside-no-selected-template" />
        );
      },
    });

    render(
      <WorkflowAuthoringRuleMount
        templateId={draft.id}
        createStore={() => store}
        createTagStore={tags}
        libraryComposition={createWorkflowAuthoringLibraryComposition(
          extension
        )}
      />
    );

    expect(
      await screen.findByText('Draft onboarding', { selector: 'button' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Published annual review', { selector: 'button' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Selected: Draft onboarding · 1 steps')
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Published only (2/2)' })
    );

    await waitFor(() => {
      expect(
        screen.queryByText('Draft onboarding', { selector: 'button' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Published only (1/2)' })
      ).toBeInTheDocument();
      expect(
        screen.getByText('Selected: Published annual review · 2 steps')
      ).toBeInTheDocument();
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('does not give canonical library data to a disabled extension', async () => {
    vi.doMock('@/platform/flags', () => ({
      isEnabled: (id: string) => id === 'workflow-authoring',
    }));
    const { WorkflowAuthoringRuleMount } =
      await import('./WorkflowAuthoringMount');
    const mountFilterControl = vi.fn(() => null);
    const filter = vi.fn(() => true);
    const renderDetail = vi.fn(() => null);
    const extension: WorkflowAuthoringLibraryDescriptor = {
      id: 'outside.dark-library-extension',
      order: 10,
      isEnabled: () => false,
      mountFilterControl,
      filter,
      renderDetail,
    };
    const store: WorkflowTemplateStore = {
      list: vi.fn(() => Promise.resolve([template('Annual review')])),
      get: vi.fn(),
      getInstance: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      publish: vi.fn(),
      start: vi.fn(),
    };

    render(
      <WorkflowAuthoringRuleMount
        templateId="template:one"
        createStore={() => store}
        createTagStore={tags}
        libraryComposition={createWorkflowAuthoringLibraryComposition(
          extension
        )}
      />
    );

    expect(
      await screen.findByText('Annual review', { selector: 'button' })
    ).toBeInTheDocument();
    expect(mountFilterControl).not.toHaveBeenCalled();
    expect(filter).not.toHaveBeenCalled();
    expect(renderDetail).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('workflow-authoring-filter-controls')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('workflow-authoring-details')
    ).not.toBeInTheDocument();
  });
});

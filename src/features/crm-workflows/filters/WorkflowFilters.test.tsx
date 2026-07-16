import '@/i18n';
import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagStore } from '@/features/crm-tags';
import {
  WorkflowAuthoringRuleMount,
  type WorkflowTemplateRecord,
  type WorkflowTemplateStore,
} from '@/features/crm-workflows';
import { setDevFlagOverride } from '@/platform/flags';

const draft: WorkflowTemplateRecord = {
  id: 'template:draft',
  name: 'New client onboarding',
  status: 'draft',
  tagIds: [],
  steps: [
    {
      id: 'step:tax-return',
      title: 'Request prior tax return',
      position: 1,
      tagIds: ['tag:tax'],
    },
    {
      id: 'step:welcome',
      title: 'Send welcome note',
      position: 0,
      tagIds: [],
    },
  ],
};

const published: WorkflowTemplateRecord = {
  id: 'template:published',
  name: 'Annual review',
  status: 'published',
  tagIds: [],
  steps: [
    {
      id: 'step:meeting',
      title: 'Hold review meeting',
      position: 0,
      tagIds: [],
    },
  ],
};

function tagStore(): FirmTagStore {
  const catalog: FirmTagStore['catalog'] = { version: 1, tags: [] };
  return {
    catalog,
    errorCode: null,
    list: vi.fn(() => Promise.resolve(catalog)),
    create: vi.fn(),
    rename: vi.fn(),
    setColor: vi.fn(),
    retire: vi.fn(),
  };
}

function workflowStore(templates: readonly WorkflowTemplateRecord[]) {
  const list = vi.fn<WorkflowTemplateStore['list']>(() =>
    Promise.resolve(templates)
  );
  const create = vi.fn<WorkflowTemplateStore['create']>();
  const update = vi.fn<WorkflowTemplateStore['update']>();
  const publish = vi.fn<WorkflowTemplateStore['publish']>();
  const start = vi.fn<WorkflowTemplateStore['start']>();
  const store: WorkflowTemplateStore = {
    list,
    get: vi.fn(),
    getInstance: vi.fn(),
    create,
    update,
    publish,
    start,
  };
  return { store, list, create, update, publish, start };
}

afterEach(() => {
  cleanup();
  setDevFlagOverride('workflow-authoring', undefined);
  setDevFlagOverride('workflow-filters', undefined);
});

describe('workflow filters authoring contribution', () => {
  it('is byte-identical to the landed library while off and adds no load', async () => {
    setDevFlagOverride('workflow-authoring', true);
    setDevFlagOverride('workflow-filters', false);
    const dark = workflowStore([draft, published]);
    const tagsWithDarkExtension = vi.fn(tagStore);
    const darkView = render(
      <WorkflowAuthoringRuleMount
        createStore={() => dark.store}
        createTagStore={tagsWithDarkExtension}
        templateId={draft.id}
      />
    );
    await screen.findByText(draft.name, { selector: 'button' });
    await waitFor(() => {
      expect(dark.list).toHaveBeenCalledTimes(2);
    });
    const darkHtml = darkView.container.innerHTML;
    const darkListCalls = dark.list.mock.calls.length;
    expect(
      screen.queryByTestId('workflow-filters-control')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('workflow-authoring-filter-controls')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('workflow-authoring-details')
    ).not.toBeInTheDocument();
    darkView.unmount();

    const baseline = workflowStore([draft, published]);
    const tagsWithoutExtension = vi.fn(tagStore);
    const baselineView = render(
      <WorkflowAuthoringRuleMount
        createStore={() => baseline.store}
        createTagStore={tagsWithoutExtension}
        libraryComposition={{ extensions: [] }}
        templateId={draft.id}
      />
    );
    await screen.findByText(draft.name, { selector: 'button' });
    await waitFor(() => {
      expect(baseline.list).toHaveBeenCalledTimes(2);
    });

    expect(baselineView.container.innerHTML).toBe(darkHtml);
    expect(baseline.list).toHaveBeenCalledTimes(darkListCalls);
    expect(tagsWithoutExtension).toHaveBeenCalledTimes(
      tagsWithDarkExtension.mock.calls.length
    );
  });

  it('filters one canonical list by state, name, and step title without writes', async () => {
    setDevFlagOverride('workflow-authoring', true);
    setDevFlagOverride('workflow-filters', true);
    const harness = workflowStore([draft, published]);
    render(
      <WorkflowAuthoringRuleMount
        createStore={() => harness.store}
        createTagStore={tagStore}
        templateId={draft.id}
      />
    );

    expect(
      await screen.findByTestId('workflow-filters-control')
    ).toBeInTheDocument();
    expect(
      await screen.findByText(draft.name, { selector: 'button' })
    ).toBeInTheDocument();
    expect(
      screen.getByText(published.name, { selector: 'button' })
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('workflow-filters-result-count')
    ).toHaveTextContent('Showing 2 of 2 workflows');

    fireEvent.change(screen.getByTestId('workflow-filters-status'), {
      target: { value: 'published' },
    });
    await waitFor(() => {
      expect(
        screen.queryByText(draft.name, { selector: 'button' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(published.name, { selector: 'button' })
      ).toBeInTheDocument();
      expect(screen.getByTestId('workflow-filters-details')).toHaveTextContent(
        published.name
      );
    });

    fireEvent.change(screen.getByTestId('workflow-filters-status'), {
      target: { value: 'unknown-status' },
    });
    expect(
      screen.queryByText(draft.name, { selector: 'button' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(published.name, { selector: 'button' })
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('workflow-filters-status'), {
      target: { value: 'all' },
    });
    fireEvent.change(screen.getByTestId('workflow-filters-search'), {
      target: { value: 'tax return' },
    });
    await waitFor(() => {
      expect(
        screen.getByText(draft.name, { selector: 'button' })
      ).toBeInTheDocument();
      expect(
        screen.queryByText(published.name, { selector: 'button' })
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('workflow-filters-details')).toHaveTextContent(
        draft.name
      );
    });

    fireEvent.change(screen.getByTestId('workflow-filters-search'), {
      target: { value: 'annual review' },
    });
    await waitFor(() => {
      expect(
        screen.getByText(published.name, { selector: 'button' })
      ).toBeInTheDocument();
      expect(
        screen.queryByText(draft.name, { selector: 'button' })
      ).not.toBeInTheDocument();
    });

    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.publish).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
  });

  it('shows ordered canonical step details and clears stale detail on no match', async () => {
    setDevFlagOverride('workflow-authoring', true);
    setDevFlagOverride('workflow-filters', true);
    const harness = workflowStore([draft, published]);
    render(
      <WorkflowAuthoringRuleMount
        createStore={() => harness.store}
        createTagStore={tagStore}
        templateId={draft.id}
      />
    );

    const detail = await screen.findByTestId('workflow-filters-details');
    expect(detail).toHaveTextContent('State: Draft');
    const steps = screen.getByTestId('workflow-filters-detail-steps');
    expect(steps.children).toHaveLength(2);
    expect(steps.children[0]).toHaveTextContent('Step 1: Send welcome note');
    expect(steps.children[0]).toHaveTextContent('Saved step ID: step:welcome');
    expect(steps.children[1]).toHaveTextContent(
      'Step 2: Request prior tax return'
    );
    expect(steps.children[1]).toHaveTextContent('Saved tag IDs: tag:tax');

    fireEvent.change(screen.getByTestId('workflow-filters-search'), {
      target: { value: 'nothing can match this' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('workflow-filters-empty')).toHaveTextContent(
        'No workflows match these filters.'
      );
      expect(
        screen.queryByTestId('workflow-filters-details')
      ).not.toBeInTheDocument();
    });
    expect(harness.create).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.publish).not.toHaveBeenCalled();
    expect(harness.start).not.toHaveBeenCalled();
  });
});

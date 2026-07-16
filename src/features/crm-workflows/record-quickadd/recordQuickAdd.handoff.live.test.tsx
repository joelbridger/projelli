import { useState } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmHouseholdAddRequest } from '@/features/crm-home';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { setDevFlagOverride } from '@/platform/flags';
import { useWorkflowTemplateStore } from '@/features/crm-workflows';
import { LiveWorkflows, type LiveWorkflowData } from '../Workflows';

const canonicalBoundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<
    (command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>
  >(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) =>
    canonicalBoundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
}));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: vi.fn(() => Promise.resolve(null)),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: vi.fn(),
}));

const request: CrmHouseholdAddRequest = {
  kind: 'workflow',
  householdId: 'household:river',
  householdLabel: 'River household',
};

function isCanonicalWorkflowTemplate(
  record: LiveCrmRecord
): record is LiveWorkflowData['templates'][number] {
  return (
    record.kind === 'crm_workflow_template' &&
    typeof record['name'] === 'string' &&
    Array.isArray(record['steps']) &&
    typeof record['snapshot'] === 'object' &&
    record['snapshot'] !== null
  );
}

function storedWorkflowTemplate(id: string): LiveWorkflowData['templates'][number] {
  const template = canonicalBoundary.records
    .filter(isCanonicalWorkflowTemplate)
    .find((record) => record.id === id);
  if (!template) throw new Error('Expected the canonical template record');
  return template;
}

function HandoffHarness({ data }: { data: LiveWorkflowData }) {
  const [addRequest, setAddRequest] =
    useState<CrmHouseholdAddRequest | null>(request);
  return (
    <LiveWorkflows
      data={data}
      households={[
        {
          id: 'household:river',
          label: 'River household',
          matterId: 'matter:river',
        },
      ]}
      onSave={() => Promise.resolve()}
      onNavigate={vi.fn()}
      {...(addRequest ? { addRequest } : {})}
      onAddRequestConsumed={() => {
        setAddRequest(null);
      }}
    />
  );
}

describe('record workflow quick-add canonical handoff', () => {
  beforeEach(() => {
    canonicalBoundary.records = [];
    canonicalBoundary.invoke.mockReset();
    canonicalBoundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(canonicalBoundary.records));
      }
      if (command === 'crm_live_upsert' && args?.record) {
        const record = structuredClone(args.record);
        canonicalBoundary.records = canonicalBoundary.records.some(
          (candidate) => candidate.id === record.id
        )
          ? canonicalBoundary.records.map((candidate) =>
              candidate.id === record.id ? record : candidate
            )
          : [...canonicalBoundary.records, record];
        return Promise.resolve(structuredClone(record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
    useWorkspaceStore.setState({ rootPath: '/workflow-record-quickadd-proof' });
    setDevFlagOverride('workflow-record-quickadd', true);
  });

  afterEach(() => {
    cleanup();
    setDevFlagOverride('workflow-record-quickadd', undefined);
    useWorkspaceStore.setState({ rootPath: null });
  });

  it('starts once for the handed-off household and proves it from a fresh reader', async () => {
    const author = renderHook(() => useWorkflowTemplateStore());
    const created = await author.result.current.create({
      name: 'Annual review',
      steps: [{ title: 'Prepare review' }],
    });
    const createdStep = created.steps[0];
    if (!createdStep) throw new Error('Expected the canonical template step');
    const published = await author.result.current.publish(created.id);
    author.unmount();

    const storedTemplate = storedWorkflowTemplate(published.id);
    const app = render(
      <HandoffHarness
        data={{ templates: [storedTemplate], instances: [], offers: [], meetings: [] }}
      />
    );

    expect(await screen.findByTestId('workflow-record-quickadd')).toHaveTextContent(
      'River household'
    );
    expect(
      await screen.findByTestId(
        `workflow-record-quickadd-template-${published.id}`
      )
    ).toBeVisible();
    fireEvent.click(screen.getByTestId('workflow-record-quickadd-start'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('workflow-record-quickadd')
      ).not.toBeInTheDocument();
    });
    const storedInstance = canonicalBoundary.records.find(
      (record) => record.kind === 'crm_workflow_instance'
    );
    if (!storedInstance) throw new Error('Expected the canonical instance write');
    expect(storedInstance).toMatchObject({
      matterId: 'matter:river',
      householdId: request.householdId,
      householdLabel: request.householdLabel,
      templateId: published.id,
    });
    app.unmount();

    const freshReader = renderHook(() => useWorkflowTemplateStore());
    await waitFor(async () => {
      await expect(
        freshReader.result.current.getInstance(storedInstance.id)
      ).resolves.toMatchObject({
        templateId: published.id,
        householdId: request.householdId,
        householdLabel: request.householdLabel,
        steps: [{ id: createdStep.id }],
      });
    });
    freshReader.unmount();

    expect(
      canonicalBoundary.invoke.mock.calls.filter(
        ([command, args]) =>
          command === 'crm_live_upsert' &&
          args?.record?.kind === 'crm_workflow_instance'
      )
    ).toHaveLength(1);
    expect(
      canonicalBoundary.invoke.mock.calls.filter(
        ([command]) => command === 'crm_live_list'
      ).length
    ).toBeGreaterThanOrEqual(2);
  });

  it('leaves the existing workflow surface usable and unread while dark', async () => {
    const author = renderHook(() => useWorkflowTemplateStore());
    const created = await author.result.current.create({
      name: 'Annual review',
      steps: [{ title: 'Prepare review' }],
    });
    await author.result.current.publish(created.id);
    author.unmount();
    const storedTemplate = storedWorkflowTemplate(created.id);
    canonicalBoundary.invoke.mockClear();
    setDevFlagOverride('workflow-record-quickadd', false);

    render(
      <HandoffHarness
        data={{ templates: [storedTemplate], instances: [], offers: [], meetings: [] }}
      />
    );

    expect(screen.queryByTestId('workflow-record-quickadd')).not.toBeInTheDocument();
    expect(screen.getByTestId('crm-live-workflow-household')).toHaveValue(
      request.householdId
    );
    expect(screen.getByTestId('crm-live-workflow-start')).toBeVisible();
    expect(canonicalBoundary.invoke).not.toHaveBeenCalled();
  });
});

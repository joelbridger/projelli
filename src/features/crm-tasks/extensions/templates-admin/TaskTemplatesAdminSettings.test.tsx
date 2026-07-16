import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagStore } from '@/features/crm-tags';
import {
  taskTemplatesLibrary,
  useTaskTemplateStore,
} from '@/features/crm-tasks/extensions/templates';
import { setDevFlagOverride } from '@/platform/flags';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { TaskTemplatesAdminSettingsMount } from './TaskTemplatesAdminSettings';

const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

const tagStore = vi.hoisted((): FirmTagStore => ({
  catalog: {
    version: 1,
    tags: [{ id: 'tag:review', name: 'Review', color: '#15803d', status: 'active' }],
  },
  errorCode: null,
  list: () => Promise.resolve(tagStore.catalog),
  create: () => Promise.resolve(tagStore.catalog),
  rename: () => Promise.resolve(tagStore.catalog),
  setColor: () => Promise.resolve(tagStore.catalog),
  retire: () => Promise.resolve(tagStore.catalog),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({ crmSetWorkspace: () => Promise.resolve() }));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) => selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(selector: (state: { matters: []; activeMatterId: null }) => T) => selector({ matters: [], activeMatterId: null }),
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
vi.mock('@/features/crm-tags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/crm-tags')>()),
  useFirmTagStore: () => tagStore,
}));

function listCallCount(): number {
  return boundary.invoke.mock.calls.filter(([command]) => command === 'crm_live_list').length;
}

async function freshTemplates() {
  const reader = renderHook(() => useTaskTemplateStore());
  const before = listCallCount();
  await waitFor(async () => {
    await expect(reader.result.current.list()).resolves.toBeDefined();
  });
  expect(listCallCount()).toBeGreaterThan(before);
  return reader;
}

describe('TaskTemplatesAdminSettingsMount', () => {
  beforeEach(() => {
    boundary.records = [];
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list') return Promise.resolve(structuredClone(boundary.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const record = structuredClone(args.record);
        boundary.records = boundary.records.some((item) => item.id === record.id)
          ? boundary.records.map((item) => item.id === record.id ? record : item)
          : [...boundary.records, record];
        return Promise.resolve(record);
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
    setDevFlagOverride('task-templates-admin', undefined);
  });

  afterEach(() => {
    setDevFlagOverride('task-templates-admin', undefined);
    setDevFlagOverride('task-templates', undefined);
    vi.clearAllMocks();
  });

  it('is inert while off, before either canonical store is created', () => {
    const createTemplateStore = vi.fn();
    const createTagStore = vi.fn();
    render(
      <TaskTemplatesAdminSettingsMount
        createTagStore={createTagStore}
        createTemplateStore={createTemplateStore}
      />,
    );

    expect(screen.queryByTestId('task-templates-admin-settings')).not.toBeInTheDocument();
    expect(createTemplateStore).not.toHaveBeenCalled();
    expect(createTagStore).not.toHaveBeenCalled();
    expect(boundary.invoke).not.toHaveBeenCalled();
  });

  it('creates, edits, and retires through the canonical live-record template store', async () => {
    setDevFlagOverride('task-templates-admin', true);
    const mounted = render(<TaskTemplatesAdminSettingsMount />);
    await screen.findByTestId('task-templates-admin-new');

    fireEvent.change(screen.getByTestId('task-templates-admin-name'), { target: { value: 'Review follow-up' } });
    fireEvent.change(screen.getByTestId('task-templates-admin-title'), { target: { value: 'Send review notes' } });
    fireEvent.click(screen.getByLabelText('Review'));
    fireEvent.click(screen.getByTestId('task-templates-admin-save'));

    const createdRow = await screen.findByText('Review follow-up');
    expect(createdRow).toBeInTheDocument();
    expect(boundary.records.filter((record) => record.kind === 'task_template')).toHaveLength(1);
    expect(boundary.records.filter((record) => record.kind === 'task')).toHaveLength(0);

    const afterCreate = await freshTemplates();
    await waitFor(async () => {
      await expect(afterCreate.result.current.list()).resolves.toEqual([
        expect.objectContaining({ name: 'Review follow-up', title: 'Send review notes', retired: false, tagIds: ['tag:review'] }),
      ]);
    });
    const created = (await afterCreate.result.current.list())[0];
    afterCreate.unmount();
    if (!created) throw new Error('Expected created template');

    setDevFlagOverride('task-templates', true);
    const taskScreen = render(<>{taskTemplatesLibrary.mount({ onCreate: vi.fn() })}</>);
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    expect(await screen.findByTestId(`crm-task-template-${created.id}`)).toBeInTheDocument();
    taskScreen.unmount();
    setDevFlagOverride('task-templates', undefined);

    fireEvent.click(screen.getByTestId(`task-templates-admin-edit-${created.id}`));
    fireEvent.change(screen.getByTestId('task-templates-admin-title'), { target: { value: 'Send the reviewed notes' } });
    fireEvent.click(screen.getByTestId('task-templates-admin-save'));
    await screen.findByText('Template saved.');

    const afterEdit = await freshTemplates();
    await waitFor(async () => {
      await expect(afterEdit.result.current.list()).resolves.toEqual([
        expect.objectContaining({ id: created.id, title: 'Send the reviewed notes', retired: false }),
      ]);
    });
    afterEdit.unmount();

    fireEvent.click(screen.getByTestId(`task-templates-admin-retire-${created.id}`));
    fireEvent.click(screen.getByTestId('task-templates-admin-confirm-retire'));
    await screen.findByText('Template retired.');

    const afterRetire = await freshTemplates();
    await waitFor(async () => {
      await expect(afterRetire.result.current.list()).resolves.toEqual([
        expect.objectContaining({ id: created.id, retired: true }),
      ]);
    });
    await expect(afterRetire.result.current.apply(created.id)).rejects.toMatchObject({ code: 'template_retired' });
    afterRetire.unmount();
    mounted.unmount();
    expect(boundary.records.filter((record) => record.kind === 'task')).toHaveLength(0);
  });
});

import type { ComponentProps } from 'react';
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  taskTemplatesLibrary,
  useTaskTemplateStore,
} from '@/features/crm-tasks/extensions/templates';
import { SettingsV1Surface } from '@/features/settings';
import { setDevFlagOverride } from '@/platform/flags';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<
    (command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>
  >(),
}));

const tagCatalog = vi.hoisted(() => ({
  hookCalls: 0,
  tags: [
    {
      id: 'tag:review',
      name: 'Review',
      color: '#15803d' as const,
      status: 'active' as 'active' | 'retired',
    },
  ],
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) =>
    boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(
    selector: (state: { matters: []; activeMatterId: null }) => T,
  ) => selector({ matters: [], activeMatterId: null }),
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
  useFirmTagStore: () => {
    tagCatalog.hookCalls += 1;
    return {
      catalog: { version: 1 as const, tags: tagCatalog.tags },
      errorCode: null,
      list: () =>
        Promise.resolve({ version: 1 as const, tags: tagCatalog.tags }),
      create: vi.fn(),
      rename: vi.fn(),
      setColor: vi.fn(),
      retire: vi.fn(),
    };
  },
}));

type SettingsRuntime = ComponentProps<typeof SettingsV1Surface>['runtime'];

const runtime: SettingsRuntime = {
  legacy: {
    settings: () => (
      <div data-testid="legacy-settings-body">Legacy settings</div>
    ),
  },
  settings: {
    action: vi.fn(),
    restartOnboarding: vi.fn(),
    loadTemplates: () => [],
    extraSections: [],
  },
  audit: { entries: [] },
  workspace: { rootPath: '/workspace' },
};

function listCallCount(): number {
  return boundary.invoke.mock.calls.filter(
    ([command]) => command === 'crm_live_list',
  ).length;
}

async function openTaskTemplateAdministration() {
  const mounted = render(<SettingsV1Surface runtime={runtime} />);
  await screen.findByTestId('settings-v1-frame');
  fireEvent.pointerDown(screen.getByTestId('settings-v1-workspace-entry'), {
    button: 0,
    ctrlKey: false,
  });
  fireEvent.click(await screen.findByTestId('settings-v1-workspace-organization'));
  await screen.findByTestId('task-templates-admin-settings');
  return mounted;
}

async function readTemplatesFresh(
  expected: readonly Record<string, unknown>[],
) {
  const callsBeforeOpen = listCallCount();
  const reader = renderHook(() => useTaskTemplateStore());
  await waitFor(async () => {
    await expect(reader.result.current.list()).resolves.toEqual(
      expected.map((item) => expect.objectContaining(item)),
    );
  });
  expect(listCallCount()).toBeGreaterThan(callsBeforeOpen);
  return reader;
}

describe('task template administration through the public Settings surface', () => {
  beforeEach(() => {
    boundary.records = [];
    tagCatalog.hookCalls = 0;
    tagCatalog.tags[0]!.status = 'active';
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(boundary.records));
      }
      if (command === 'crm_live_upsert' && args?.record) {
        const record = structuredClone(args.record);
        boundary.records = boundary.records.some((item) => item.id === record.id)
          ? boundary.records.map((item) =>
              item.id === record.id ? record : item,
            )
          : [...boundary.records, record];
        return Promise.resolve(structuredClone(record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
    setDevFlagOverride('settings-shell-v1', undefined);
    setDevFlagOverride('task-templates-admin', undefined);
    setDevFlagOverride('task-templates', undefined);
  });

  afterEach(() => {
    setDevFlagOverride('settings-shell-v1', undefined);
    setDevFlagOverride('task-templates-admin', undefined);
    setDevFlagOverride('task-templates', undefined);
    vi.clearAllMocks();
  });

  it('keeps the legacy surface exact while the shell is off and has no Organization gap while the panel is off', async () => {
    setDevFlagOverride('task-templates-admin', true);
    const legacy = render(<SettingsV1Surface runtime={runtime} />);
    expect(legacy.container.innerHTML).toBe(
      '<div data-testid="legacy-settings-body">Legacy settings</div>',
    );
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(tagCatalog.hookCalls).toBe(0);
    legacy.unmount();

    setDevFlagOverride('settings-shell-v1', true);
    setDevFlagOverride('task-templates-admin', undefined);
    render(<SettingsV1Surface runtime={runtime} />);
    await screen.findByTestId('settings-v1-frame');

    expect(screen.queryByTestId('settings-v1-organization')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('task-templates-admin-settings'),
    ).not.toBeInTheDocument();
    expect(boundary.invoke).not.toHaveBeenCalled();
    expect(tagCatalog.hookCalls).toBe(0);
  });

  it('creates, edits past a retired tag, and retires through Settings with a fresh canonical read after every writer is discarded', async () => {
    setDevFlagOverride('settings-shell-v1', true);
    setDevFlagOverride('task-templates-admin', true);

    const creator = await openTaskTemplateAdministration();
    await screen.findByTestId('task-templates-admin-new');
    fireEvent.change(screen.getByTestId('task-templates-admin-name'), {
      target: { value: 'Review follow-up' },
    });
    fireEvent.change(screen.getByTestId('task-templates-admin-title'), {
      target: { value: 'Send review notes' },
    });
    fireEvent.click(screen.getByLabelText('Review'));
    fireEvent.click(screen.getByTestId('task-templates-admin-save'));
    await screen.findByText('Template saved.');
    creator.unmount();

    const afterCreate = await readTemplatesFresh([
      {
        name: 'Review follow-up',
        title: 'Send review notes',
        retired: false,
        tagIds: ['tag:review'],
      },
    ]);
    const created = (await afterCreate.result.current.list())[0];
    afterCreate.unmount();
    if (!created) throw new Error('Expected the Settings-created template.');

    setDevFlagOverride('task-templates', true);
    const taskConsumer = render(
      <>{taskTemplatesLibrary.mount({ onCreate: vi.fn() })}</>,
    );
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));
    expect(
      await screen.findByTestId(`crm-task-template-${created.id}`),
    ).toBeInTheDocument();
    taskConsumer.unmount();
    setDevFlagOverride('task-templates', undefined);

    tagCatalog.tags[0]!.status = 'retired';
    const editor = await openTaskTemplateAdministration();
    fireEvent.click(
      await screen.findByTestId(`task-templates-admin-edit-${created.id}`),
    );
    expect(screen.getByText('Review (Retired tag)')).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId('task-templates-admin-retired-tag-tag:review'),
    );
    fireEvent.change(screen.getByTestId('task-templates-admin-title'), {
      target: { value: 'Send the reviewed notes' },
    });
    fireEvent.click(screen.getByTestId('task-templates-admin-save'));
    await screen.findByText('Template saved.');
    editor.unmount();

    const afterEdit = await readTemplatesFresh([
      {
        id: created.id,
        title: 'Send the reviewed notes',
        retired: false,
        tagIds: [],
      },
    ]);
    afterEdit.unmount();

    const retireWriter = await openTaskTemplateAdministration();
    fireEvent.click(
      await screen.findByTestId(`task-templates-admin-retire-${created.id}`),
    );
    fireEvent.click(screen.getByTestId('task-templates-admin-confirm-retire'));
    await screen.findByText('Template retired.');
    retireWriter.unmount();

    const afterRetire = await readTemplatesFresh([
      { id: created.id, retired: true, tagIds: [] },
    ]);
    await expect(afterRetire.result.current.apply(created.id)).rejects.toMatchObject(
      { code: 'template_retired' },
    );
    afterRetire.unmount();

    expect(
      boundary.records.filter((record) => record.kind === 'task_template'),
    ).toHaveLength(1);
    expect(
      boundary.records.filter((record) => record.kind === 'task'),
    ).toHaveLength(0);
  });
});

import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags';
import {
  HouseholdRecordSurface,
  type HouseholdRecord,
} from '@/features/crm-clients';
import type { CrmHouseholdAddRequest } from '@/features/crm-home';
import { Tasks } from '../../Tasks';

const stores = vi.hoisted(() => ({
  useTaskRecordStore: vi.fn(),
  useFirmTagStore: vi.fn(),
}));

vi.mock('@/features/crm-tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/crm-tasks')>()),
  useTaskRecordStore: stores.useTaskRecordStore,
}));

vi.mock('@/features/crm-tags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/crm-tags')>()),
  useFirmTagStore: stores.useFirmTagStore,
}));

const household: HouseholdRecord = {
  id: 'household-henderson',
  name: 'Henderson household',
  lifecycle: 'Active',
  primaryAdvisor: 'Maya',
  ownership: 'mine',
  serviceTier: 'Platinum',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
};

function HouseholdQuickAddPath() {
  const [addRequest, setAddRequest] = useState<CrmHouseholdAddRequest>();
  const [tasksMounted, setTasksMounted] = useState(true);
  return (
    <>
      <HouseholdRecordSurface
        household={household}
        actions={{
          onAdd: (request) => {
            if (request.kind !== 'task') return;
            setAddRequest({
              kind: request.kind,
              householdId: request.householdRef.id,
              householdLabel:
                request.householdRef.label ?? 'Untitled household',
            });
          },
        }}
      />
      <button
        data-testid="remount-tasks"
        onClick={() => {
          setTasksMounted(false);
          queueMicrotask(() => {
            setTasksMounted(true);
          });
        }}
      >
        Remount tasks
      </button>
      {tasksMounted ? (
        <Tasks
          tasks={[]}
          workflowWorkItems={[]}
          firmMembers={[]}
          households={[]}
          savedViews={[]}
          freshness={{ kind: 'live' }}
          onUpdateTask={() => undefined}
          onCompleteWorkflowWorkItem={() => undefined}
          onOpenWorkflowWorkItem={() => undefined}
          onSaveView={() => undefined}
          {...(addRequest ? { addRequest } : {})}
          onAddRequestConsumed={() => {
            setAddRequest(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function startHouseholdTask() {
  fireEvent.click(screen.getByTestId('crm-household-add'));
  fireEvent.click(screen.getByTestId('crm-household-add-task'));
}

async function expectRequestDoesNotRefireAfterRemount() {
  fireEvent.click(screen.getByTestId('remount-tasks'));
  await waitFor(() => {
    expect(screen.queryByTestId('crm-task-detail')).not.toBeInTheDocument();
  });

  fireEvent.click(screen.getByTestId('task-create-v1-open'));
  expect(
    screen.queryByTestId('task-create-v1-related-record')
  ).not.toBeInTheDocument();
}

function taskStore() {
  return {
    create: vi.fn().mockResolvedValue({ id: 'task-henderson' }),
  };
}

afterEach(() => {
  cleanup();
  setDevFlagOverride('task-create-v1', undefined);
  vi.clearAllMocks();
});

describe('task create v1 household quick-add', () => {
  it('carries the real household Add task request into the composer', () => {
    setDevFlagOverride('task-create-v1', true);
    stores.useTaskRecordStore.mockReturnValue(taskStore());
    stores.useFirmTagStore.mockReturnValue({
      catalog: { version: 1, tags: [] },
      list: vi.fn().mockResolvedValue({ version: 1, tags: [] }),
    });

    render(<HouseholdQuickAddPath />);

    startHouseholdTask();
    fireEvent.click(screen.getByTestId('task-create-v1-open'));

    expect(
      screen.getByTestId('task-create-v1-related-record')
    ).toHaveTextContent('Henderson household');
  });

  it('consumes the household request after saving the composer', async () => {
    setDevFlagOverride('task-create-v1', true);
    stores.useTaskRecordStore.mockReturnValue(taskStore());
    stores.useFirmTagStore.mockReturnValue({
      catalog: { version: 1, tags: [] },
      list: vi.fn().mockResolvedValue({ version: 1, tags: [] }),
    });

    render(<HouseholdQuickAddPath />);

    startHouseholdTask();
    fireEvent.click(screen.getByTestId('task-create-v1-open'));
    fireEvent.change(screen.getByTestId('task-create-v1-title'), {
      target: { value: 'Review Henderson plan' },
    });
    fireEvent.click(screen.getByTestId('task-create-v1-save'));

    await waitFor(() => {
      expect(screen.queryByTestId('task-create-v1-composer')).not.toBeInTheDocument();
    });
    await expectRequestDoesNotRefireAfterRemount();
  });

  it('consumes the household request after cancelling the composer', async () => {
    setDevFlagOverride('task-create-v1', true);
    stores.useTaskRecordStore.mockReturnValue(taskStore());
    stores.useFirmTagStore.mockReturnValue({
      catalog: { version: 1, tags: [] },
      list: vi.fn().mockResolvedValue({ version: 1, tags: [] }),
    });

    render(<HouseholdQuickAddPath />);

    startHouseholdTask();
    fireEvent.click(screen.getByTestId('task-create-v1-open'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await expectRequestDoesNotRefireAfterRemount();
  });
});

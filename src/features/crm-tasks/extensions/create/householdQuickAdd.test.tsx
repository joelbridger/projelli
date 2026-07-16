import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
      <Tasks
        tasks={[]}
        workflowWorkItems={[]}
        firmMembers={[]}
        households={[]}
        savedViews={[]}
        freshness={{ kind: 'live' }}
        onUpdateTask={() => undefined}
        onCompleteWorkflowWorkItem={() => undefined}
        onSaveView={() => undefined}
        {...(addRequest ? { addRequest } : {})}
      />
    </>
  );
}

afterEach(() => {
  cleanup();
  setDevFlagOverride('task-create-v1', undefined);
  vi.clearAllMocks();
});

describe('task create v1 household quick-add', () => {
  it('carries the real household Add task request into the composer', () => {
    setDevFlagOverride('task-create-v1', true);
    stores.useTaskRecordStore.mockReturnValue({});
    stores.useFirmTagStore.mockReturnValue({
      catalog: { version: 1, tags: [] },
      list: vi.fn().mockResolvedValue({ version: 1, tags: [] }),
    });

    render(<HouseholdQuickAddPath />);

    fireEvent.click(screen.getByTestId('crm-household-add'));
    fireEvent.click(screen.getByTestId('crm-household-add-task'));
    fireEvent.click(screen.getByTestId('task-create-v1-open'));

    expect(
      screen.getByTestId('task-create-v1-related-record')
    ).toHaveTextContent('Henderson household');
  });
});

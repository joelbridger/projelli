import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { TaskTemplateLibrary } from './TaskTemplateLibrary';

const state = vi.hoisted(() => ({
  records: [] as readonly LiveCrmRecord[],
}));

vi.mock('@/platform/flags', () => ({ useFlag: () => true }));
vi.mock('@/features/crm-tags', () => ({
  useFirmTagStore: () => ({ list: vi.fn().mockResolvedValue({ version: 1, tags: [] }) }),
}));
vi.mock('@/features/crm-tasks', () => ({
  useTaskRecordStore: () => ({ create: vi.fn() }),
}));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: state.records,
    workspaceRoot: '/workspace',
    error: null,
    save: vi.fn(),
    reload: vi.fn(),
  }),
}));

function canonicalTemplate(): LiveCrmRecord {
  return {
    id: 'task-template:initial',
    kind: 'task_template',
    matterId: 'firm_home',
    createdAt: '2026-07-16T00:00:00.000Z',
    createdBy: { userId: 'local-user', display: 'You', kind: 'user' },
    updatedAt: '2026-07-16T00:00:00.000Z',
    updatedBy: { userId: 'local-user', display: 'You', kind: 'user' },
    source: { origin: 'user', sources: [] },
    deleted: false,
    externalRefs: [],
    schemaVersion: 1,
    name: 'Initial review',
    title: 'Review the plan',
    tagIds: [],
  } as LiveCrmRecord;
}

describe('TaskTemplateLibrary live-record loading', () => {
  beforeEach(() => {
    state.records = [];
  });

  it('shows canonical templates that arrive after the library first opens without a manual refresh', async () => {
    const view = render(<TaskTemplateLibrary onCreate={vi.fn()} />);
    fireEvent.click(screen.getByTestId('crm-task-template-library-open'));

    expect(screen.queryByTestId('crm-task-template-task-template:initial')).not.toBeInTheDocument();

    state.records = [canonicalTemplate()];
    view.rerender(<TaskTemplateLibrary onCreate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('crm-task-template-task-template:initial')).toBeInTheDocument();
    });
  });
});

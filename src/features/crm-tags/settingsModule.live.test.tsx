import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { PlatformFlagsMockState } from '@/testing/platform-flags';

const { mockPlatformFlags, resetPlatformFlagsOverrides, setPlatformFlagsOverrides } =
  await vi.hoisted(async () => import('@/testing/platform-flags'));

const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
  setWorkspace: vi.fn<(workspace: string) => Promise<void>>(),
  publish: vi.fn<(record: LiveCrmRecord) => void>(),
}));
const flagsMock = vi.hoisted(() => ({
  overrides: { isEnabled: undefined } as PlatformFlagsMockState['overrides'],
}));

vi.mock('@/platform/flags', async (importOriginal) =>
  mockPlatformFlags(importOriginal, flagsMock)
);
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: (workspace: string) => boundary.setWorkspace(workspace),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) => selector({ rootPath: '/firm' }),
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
  publishLiveRecord: (record: LiveCrmRecord) => {
    boundary.publish(record);
  },
}));

import { LIVE_CRM_RECORDS_CHANGED } from '@/platform/crm/useLiveCrmRecords';
import { UniversalTagsSettingsMount } from './settingsModule';

function savedTag(name: string): LiveCrmRecord {
  return {
    id: 'tag:planning', kind: 'tag', matterId: 'firm_home', name, color: '#2563eb', deleted: false,
    createdAt: '2026-01-01T00:00:00.000Z', createdBy: { userId: 'u1', display: 'You', kind: 'user' },
    updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: { userId: 'u1', display: 'You', kind: 'user' },
    source: { origin: 'user', sources: [] }, externalRefs: [], schemaVersion: 1,
  };
}

describe('UniversalTagsSettingsMount live CRM integration', () => {
  beforeEach(() => {
    resetPlatformFlagsOverrides(flagsMock);
    setPlatformFlagsOverrides(flagsMock, { isEnabled: () => true });
  });

  beforeEach(() => {
    boundary.records = [savedTag('Planning')];
    boundary.invoke.mockReset();
    boundary.setWorkspace.mockReset();
    boundary.publish.mockReset();
    boundary.setWorkspace.mockResolvedValue(undefined);
    boundary.invoke.mockImplementation((command: string, args?: { record?: LiveCrmRecord }) => {
      if (command === 'crm_live_list') return Promise.resolve(structuredClone(boundary.records));
      const record = args?.record;
      if (command === 'crm_live_upsert' && record) {
        boundary.records = boundary.records.some((item) => item.id === record.id)
          ? boundary.records.map((item) => item.id === record.id ? structuredClone(record) : item)
          : [...boundary.records, structuredClone(record)];
        return Promise.resolve(structuredClone(record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('updates without remount after an external canonical change, then writes through the relay and canonical reopen path', async () => {
    const changed = vi.fn();
    window.addEventListener(LIVE_CRM_RECORDS_CHANGED, changed);
    const { unmount } = render(<UniversalTagsSettingsMount />);
    const panel = await screen.findByTestId('firm-tags-settings');
    expect(screen.getByTestId('firm-tag-name-tag:planning')).toHaveValue('Planning');

    boundary.records = [savedTag('Financial planning')];
    act(() => {
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
    });
    await waitFor(() => {
      expect(screen.getByTestId('firm-tag-name-tag:planning')).toHaveValue('Financial planning');
    });
    expect(screen.getByTestId('firm-tags-settings')).toBe(panel);

    boundary.invoke.mockClear();
    changed.mockClear();
    fireEvent.change(screen.getByTestId('firm-tag-new-name'), { target: { value: 'Urgent' } });
    fireEvent.click(screen.getByTestId('firm-tag-add'));

    await waitFor(() => {
      expect(boundary.publish).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'tag', name: 'Urgent', color: '#2563eb', schemaVersion: 1,
      }));
    });
    await waitFor(() => {
      expect(changed).toHaveBeenCalledTimes(1);
    });
    const commands = boundary.invoke.mock.calls.map(([command]) => command);
    const upsert = commands.indexOf('crm_live_upsert');
    expect(upsert).toBeGreaterThanOrEqual(0);
    expect(commands.slice(upsert + 1)).toContain('crm_live_list');
    expect(boundary.setWorkspace).toHaveBeenCalledWith('/firm');

    window.removeEventListener(LIVE_CRM_RECORDS_CHANGED, changed);
    unmount();
  });
});

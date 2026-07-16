import '@/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonical = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

vi.mock('@/platform/flags', () => ({ useFlag: () => true }));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => canonical.invoke(command, args),
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

import { roundTripCalendarFoundation } from '@/features/calendar/testing';
import { CalendarGridSurface } from '@/features/calendar-grid';

describe('CalendarGridSurface fresh-reader proof', () => {
  beforeEach(() => {
    canonical.records = [];
    canonical.invoke.mockReset();
    canonical.invoke.mockImplementation((command, args) => {
      if (command === 'crm_live_list') return Promise.resolve(structuredClone(canonical.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const stored = { ...structuredClone(args.record), canonicalReloadMarker: true };
        const index = canonical.records.findIndex((record) => record.id === stored.id);
        if (index >= 0) canonical.records[index] = stored;
        else canonical.records.push(stored);
        return Promise.resolve(structuredClone(args.record));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows an occurrence supplied after the exported harness writes and a fresh public reader reloads', async () => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5, 9, 0, 0));
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const roundTrip = await roundTripCalendarFoundation({
      event: {
        title: 'Fresh reader planning',
        startUtc: start.toISOString(),
        endUtc: end.toISOString(),
        displayTimezone: 'UTC',
        allDay: false,
        calendarId: 'calendar:local',
      },
    });
    expect(roundTrip.event?.id).toBeTruthy();
    expect(canonical.records.some((record) => record['canonicalReloadMarker'] === true)).toBe(true);

    render(<CalendarGridSurface />);

    await waitFor(() => expect(screen.getAllByText('Fresh reader planning')).toHaveLength(2));
    expect(screen.getByTestId('calendar-grid-selection').textContent).toContain('Fresh reader planning');
  });
});

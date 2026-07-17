import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonical = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: canonical.invoke }));
vi.mock('@/platform/utils/wealthbox-commands', () => ({ crmSetWorkspace: () => Promise.resolve() }));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) => selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: <T,>(selector: (state: { matters: []; activeMatterId: null }) => T) => selector({ matters: [], activeMatterId: null }),
}));
vi.mock('@/platform/crm/store', () => ({ getCrmEngineFreshness: () => ({ kind: 'idle' }), subscribeCrmEngineFreshness: () => () => undefined }));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(), ensureLiveRecordRelay: vi.fn(() => Promise.resolve(null)), removeLiveRecordRelayWriter: vi.fn(), publishLiveRecord: vi.fn(),
}));

import {
  useCalendarEventStore,
  type CalendarEventDraft,
  type CalendarEventRecord,
} from '@/features/calendar';

const baseEvent = {
  title: 'Recurring local review', startUtc: '2026-08-03T14:00:00Z', endUtc: '2026-08-03T14:30:00Z',
  displayTimezone: 'America/New_York', allDay: false, calendarId: 'calendar:local',
} as const;

async function createAndReloadCalendarEvent(draft: CalendarEventDraft): Promise<CalendarEventRecord> {
  const writer = renderHook(() => useCalendarEventStore());
  let created: CalendarEventRecord | undefined;
  try {
    const beforeInitialReload = writer.result.current;
    await waitFor(() => {
      if (writer.result.current === beforeInitialReload) {
        throw new Error('The calendar event store has not loaded its canonical records yet.');
      }
    });
    await act(async () => {
      created = await writer.result.current.create(draft);
    });
  } finally {
    writer.unmount();
  }

  if (!created) throw new Error('The calendar event was not created.');
  const reader = renderHook(() => useCalendarEventStore());
  try {
    await waitFor(async () => {
      const reloaded = await reader.result.current.get(created!.id);
      if (!reloaded || JSON.stringify(reloaded) !== JSON.stringify(created)) {
        throw new Error('The saved calendar event has not reloaded yet.');
      }
    });
    return created;
  } finally {
    reader.unmount();
  }
}

beforeEach(() => {
  canonical.records = [];
  canonical.invoke.mockReset();
  canonical.invoke.mockImplementation((command, args) => {
    if (command === 'crm_live_list') return Promise.resolve(structuredClone(canonical.records));
    if (command === 'crm_live_upsert' && args?.record) {
      const record = { ...structuredClone(args.record), unknownAdditiveContext: 'kept by the canonical record' } as LiveCrmRecord;
      const index = canonical.records.findIndex((candidate) => candidate.id === record.id);
      if (index >= 0) canonical.records[index] = record;
      else canonical.records.push(record);
      return Promise.resolve(structuredClone(args.record));
    }
    return Promise.reject(new Error(`Unexpected command ${command}`));
  });
});

describe('calendar-add-event public store flow', () => {
  it('round-trips every supported recurrence, then thin-patches and cancels through fresh public readers', async () => {
    const drafts = [
      { frequency: 'daily' as const, interval: 1, count: 2 },
      { frequency: 'weekly' as const, interval: 1, byWeekday: ['monday'] as const },
      { frequency: 'monthly' as const, interval: 1, byMonthDay: [15] as const },
      { frequency: 'yearly' as const, interval: 1, byMonthDay: [3] as const },
    ];
    const created = [] as CalendarEventRecord[];
    for (const recurrence of drafts) {
      created.push(await createAndReloadCalendarEvent({ ...baseEvent, recurrence }));
    }
    expect(created.map((event) => event.recurrence?.frequency)).toEqual(['daily', 'weekly', 'monthly', 'yearly']);

    const id = created[1]?.id;
    expect(id).toBeTruthy();
    const editor = renderHook(() => useCalendarEventStore());
    await waitFor(async () => {
      if (!id || !await editor.result.current.get(id)) throw new Error('Waiting for canonical event reload.');
    });
    await act(async () => {
      await editor.result.current.update(id!, { title: 'Patched recurring review' });
    });
    editor.unmount();

    const canceller = renderHook(() => useCalendarEventStore());
    await waitFor(async () => {
      const reloaded = id ? await canceller.result.current.get(id) : undefined;
      if (!reloaded || reloaded.title !== 'Patched recurring review') {
        throw new Error('Waiting for patched canonical event reload before cancellation.');
      }
    });
    let cancelled: Awaited<ReturnType<typeof canceller.result.current.cancel>> | undefined;
    await act(async () => {
      cancelled = await canceller.result.current.cancel(id!);
    });
    canceller.unmount();
    expect(cancelled?.status).toBe('cancelled');

    const reader = renderHook(() => useCalendarEventStore());
    await waitFor(async () => {
      const reloaded = id ? await reader.result.current.get(id) : undefined;
      if (!reloaded || reloaded.title !== 'Patched recurring review' || reloaded.status !== 'cancelled') {
        throw new Error('Waiting for patched and cancelled canonical event reload.');
      }
    });
    reader.unmount();
    expect(canonical.records.find((record) => record.id === id)?.['unknownAdditiveContext']).toBe('kept by the canonical record');
  });
});

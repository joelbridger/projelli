import '@/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { CalendarEventDraft } from '@/features/calendar';
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
vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
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

import { useCalendarEventStore } from '@/features/calendar';
import { CalendarGridSurface } from '@/features/calendar-grid';

/** Calendar Grid's public-only writer; the rendered surface is the fresh reader. */
async function createCalendarGridEvent(event: CalendarEventDraft) {
  const writer = renderHook(() => useCalendarEventStore());
  try {
    const initialStore = writer.result.current;
    await waitFor(() => {
      if (writer.result.current === initialStore) {
        throw new Error('The calendar event store has not loaded its canonical records yet.');
      }
    });
    return await writer.result.current.create(event);
  } finally {
    writer.unmount();
  }
}

function CalendarEditProbe({
  eventId,
  startUtc,
  endUtc,
}: {
  eventId: string;
  startUtc: string;
  endUtc: string;
}) {
  const events = useCalendarEventStore();
  return <button
    type="button"
    data-testid="calendar-edit-probe"
    onClick={() => {
      void events.update(eventId, {
        title: 'Freshly updated planning',
        startUtc,
        endUtc,
      });
    }}
  >Edit</button>;
}

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
    const event = await createCalendarGridEvent({
      title: 'Fresh reader planning',
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      displayTimezone: 'UTC',
      allDay: false,
      calendarId: 'calendar:local',
    });
    expect(event.id).toBeTruthy();
    expect(canonical.records.some((record) => record['canonicalReloadMarker'] === true)).toBe(true);

    render(<CalendarGridSurface />);

    const eventButton = await screen.findByTestId(/calendar-occurrence-/);
    expect(eventButton.textContent).toContain('Fresh reader planning');
    fireEvent.click(eventButton);
    expect(screen.getByTestId('calendar-grid-peek').textContent).toContain('Fresh reader planning');
  });

  it('reacts to a real public title and timing edit in both the grid and rail', async () => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5, 9, 0, 0));
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const updatedStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 6, 13, 30, 0));
    const updatedEnd = new Date(updatedStart.getTime() + 30 * 60 * 1000);
    const event = await createCalendarGridEvent({
      title: 'Original planning',
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
      displayTimezone: 'UTC',
      allDay: false,
      calendarId: 'calendar:local',
    });
    const eventId = event.id;

    render(<>
      <CalendarEditProbe
        eventId={eventId}
        startUtc={updatedStart.toISOString()}
        endUtc={updatedEnd.toISOString()}
      />
      <CalendarGridSurface now={now} />
    </>);
    const originalButton = await screen.findByTestId(/calendar-occurrence-/);
    expect(originalButton.textContent).toContain('Original planning');
    fireEvent.click(originalButton);

    fireEvent.click(screen.getByTestId('calendar-edit-probe'));

    await waitFor(() => expect(screen.getByText('Freshly updated planning')).toBeTruthy());
    expect(screen.queryByText('Original planning')).toBeNull();
    expect(canonical.records.find((record) => record.id === eventId)).toMatchObject({
      title: 'Freshly updated planning',
      startUtc: updatedStart.toISOString(),
      status: 'scheduled',
    });
  });
});

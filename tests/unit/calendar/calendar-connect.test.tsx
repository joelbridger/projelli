import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalendarConnect } from '@/platform/connectors/calendar/CalendarConnect';

vi.mock('@/platform/utils/calendar-commands', () => ({
  CALENDAR_SYNC_EVENT: 'calendar-sync-progress',
  calendarIsConnected: vi.fn(async () => false),
  calendarConnectOutlook: vi.fn(async () => {}),
  calendarConnectOutlookCancel: vi.fn(async () => {}),
  calendarConnectGoogle: vi.fn(async () => {}),
  calendarConnectIcs: vi.fn(async () => {}),
  calendarDisconnect: vi.fn(async () => {}),
  calendarSyncAll: vi.fn(async () => ({
    eventsFetched: 0, eventsChanged: 0, eventsIndexed: 0, recordsIndexed: 0, cancelled: false,
  })),
  calendarSyncStatus: vi.fn(async () => ({ syncing: false, eventsIndexed: 0, lastReport: null })),
  calendarCancelSync: vi.fn(async () => {}),
  calendarListEvents: vi.fn(async () => []),
  calendarSetWorkspace: vi.fn(async () => {}),
}));

// isTauri gate: the component renders its desktop-only stub otherwise. Mock
// it the way the existing connector tests do (copy from
// tests/unit/addepar-connect-audit.test.tsx).
vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isTauri: () => true,
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isTauri: () => true,
}));

vi.mock('@/platform/matter/matterStore', () => ({
  getMatters: vi.fn().mockReturnValue([]),
}));

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isLocalOnlyMode: vi.fn().mockReturnValue(false),
}));

import {
  calendarConnectIcs,
  calendarConnectOutlook,
} from '@/platform/utils/calendar-commands';

describe('CalendarConnect', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one card with all three connection paths', async () => {
    render(<CalendarConnect />);
    expect(await screen.findByTestId('calendar-connect-outlook')).toBeTruthy();
    expect(screen.getByTestId('calendar-connect-google')).toBeTruthy();
    expect(screen.getByTestId('calendar-connect-ics')).toBeTruthy();
  });

  it('starts the Outlook sign-in on click', async () => {
    render(<CalendarConnect />);
    fireEvent.click(await screen.findByTestId('calendar-connect-outlook'));
    await waitFor(() => expect(calendarConnectOutlook).toHaveBeenCalledTimes(1));
  });

  it('requires a plausible ICS address before connecting', async () => {
    render(<CalendarConnect />);
    fireEvent.click(screen.getByTestId('calendar-ics-connect-button'));
    expect(calendarConnectIcs).not.toHaveBeenCalled(); // empty input
    fireEvent.change(screen.getByTestId('calendar-ics-url-input'), {
      target: { value: 'https://example.com/team.ics' },
    });
    fireEvent.click(screen.getByTestId('calendar-ics-connect-button'));
    await waitFor(() =>
      expect(calendarConnectIcs).toHaveBeenCalledWith('https://example.com/team.ics'),
    );
  });
});

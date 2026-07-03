import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CalendarConnect } from '@/platform/connectors/calendar/CalendarConnect';

vi.mock('@/platform/utils/calendar-commands', () => ({
  CALENDAR_SYNC_EVENT: 'calendar-sync-progress',
  calendarIsConnected: vi.fn(async () => false),
  calendarConnectOutlook: vi.fn(async () => {}),
  calendarConnectOutlookCancel: vi.fn(async () => {}),
  calendarConnectGoogle: vi.fn(async () => {}),
  calendarConnectGoogleCancel: vi.fn(async () => {}),
  calendarConnectIcs: vi.fn(async () => {}),
  calendarDisconnect: vi.fn(async () => {}),
  calendarSyncAll: vi.fn(async () => ({
    eventsFetched: 0,
    eventsChanged: 0,
    eventsIndexed: 0,
    recordsIndexed: 0,
    cancelled: false,
  })),
  calendarSyncStatus: vi.fn(async () => ({
    syncing: false,
    eventsIndexed: 0,
    lastReport: null,
  })),
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
  calendarConnectGoogle,
  calendarConnectGoogleCancel,
  calendarConnectIcs,
  calendarConnectOutlook,
  calendarConnectOutlookCancel,
  calendarDisconnect,
  calendarIsConnected,
} from '@/platform/utils/calendar-commands';

describe('CalendarConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history but not a custom mockImplementation
    // set by an earlier test (e.g. the disconnect test below) — restore the
    // module's default so each test starts from "nothing connected".
    vi.mocked(calendarIsConnected).mockImplementation(async () => false);
  });

  it('renders one card with all three connection paths', async () => {
    render(<CalendarConnect />);
    expect(await screen.findByTestId('calendar-connect-outlook')).toBeTruthy();
    expect(screen.getByTestId('calendar-connect-google')).toBeTruthy();
    expect(screen.getByTestId('calendar-connect-ics')).toBeTruthy();
  });

  it('starts the Outlook sign-in on click', async () => {
    render(<CalendarConnect />);
    fireEvent.click(await screen.findByTestId('calendar-connect-outlook'));
    await waitFor(() =>
      expect(calendarConnectOutlook).toHaveBeenCalledTimes(1)
    );
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
      expect(calendarConnectIcs).toHaveBeenCalledWith(
        'https://example.com/team.ics'
      )
    );
  });

  it('requires confirmation before disconnecting, and only disconnects after confirming', async () => {
    vi.mocked(calendarIsConnected).mockImplementation(
      async (id: string) => id === 'outlook'
    );
    render(<CalendarConnect />);

    const disconnectButton = await screen.findByText('Disconnect');
    fireEvent.click(disconnectButton);

    // The dialog is up; the destructive action must not have fired yet.
    expect(
      await screen.findByText('Disconnect and delete imported data')
    ).toBeTruthy();
    expect(calendarDisconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Disconnect and delete'));
    await waitFor(() =>
      expect(calendarDisconnect).toHaveBeenCalledWith('outlook')
    );
  });

  it('offers a live cancel while an Outlook sign-in is pending', async () => {
    // Never resolves — simulates the browser tab still being open, so
    // `busy === 'outlook'` stays true for the assertions below.
    vi.mocked(calendarConnectOutlook).mockImplementation(
      () => new Promise(() => {})
    );
    render(<CalendarConnect />);
    fireEvent.click(await screen.findByTestId('calendar-connect-outlook'));

    const cancelButton = await screen.findByTestId('calendar-cancel-outlook');
    fireEvent.click(cancelButton);
    await waitFor(() =>
      expect(calendarConnectOutlookCancel).toHaveBeenCalledTimes(1)
    );
  });

  it('offers a live cancel while a Google sign-in is pending', async () => {
    vi.mocked(calendarConnectGoogle).mockImplementation(
      () => new Promise(() => {})
    );
    render(<CalendarConnect />);
    fireEvent.click(await screen.findByTestId('calendar-connect-google'));

    const cancelButton = await screen.findByTestId('calendar-cancel-google');
    fireEvent.click(cancelButton);
    await waitFor(() =>
      expect(calendarConnectGoogleCancel).toHaveBeenCalledTimes(1)
    );
  });
});

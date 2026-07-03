import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TodaysMeetingsStrip } from '@/features/meetings/TodaysMeetingsStrip';
import { todayWindowUtc } from '@/features/meetings/todayWindow';
import { useMatterStore } from '@/platform/matter/matterStore';

const listEvents = vi.fn();
vi.mock('@/platform/utils/calendar-commands', () => ({
  CALENDAR_SYNC_EVENT: 'calendar-sync-progress',
  calendarListEvents: (...args: unknown[]) => listEvents(...args),
}));
// Tauri event listener: no-op unsubscribe in jsdom.
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

function seedMatters() {
  useMatterStore.setState((s) => ({
    ...s,
    matters: [
      {
        id: 'm-hend',
        name: 'Henderson',
        client: 'Kim Henderson',
        folderPaths: [],
        createdAt: '2024-01-01T00:00:00Z',
        meetingKeys: ['kim@henderson.com'],
      },
    ],
  }));
}

const matched = {
  id: 'outlook:e1',
  provider: 'outlook',
  title: 'Annual review',
  startUtc: '2026-07-02T16:00:00Z',
  endUtc: '2026-07-02T17:00:00Z',
  attendees: [{ email: 'kim@henderson.com', name: 'Kim' }],
  organizerEmail: 'adv@firm.com',
};
const unmatched = {
  ...matched,
  id: 'outlook:e2',
  title: 'Mystery guest',
  attendees: [{ email: 'stranger@x.com', name: 'Stranger' }],
};

describe('todayWindowUtc', () => {
  it('spans local midnight to local midnight as UTC instants', () => {
    const now = new Date('2026-07-02T09:00:00');
    const { fromUtc, toUtc } = todayWindowUtc(now);
    expect(new Date(toUtc).getTime() - new Date(fromUtc).getTime()).toBe(
      24 * 3600 * 1000
    );
    expect(new Date(fromUtc).getTime()).toBeLessThanOrEqual(now.getTime());
    expect(new Date(toUtc).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe('TodaysMeetingsStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedMatters();
  });

  it('renders nothing when there are no events today', async () => {
    listEvents.mockResolvedValue([]);
    const { container } = render(
      <TodaysMeetingsStrip onOpenClient={() => {}} />
    );
    await waitFor(() => expect(listEvents).toHaveBeenCalled());
    expect(
      container.querySelector('[data-testid="todays-meetings-strip"]')
    ).toBeNull();
  });

  it('shows matched meetings with client name and navigates on click', async () => {
    listEvents.mockResolvedValue([matched]);
    const onOpen = vi.fn();
    render(<TodaysMeetingsStrip onOpenClient={onOpen} />);
    const chip = await screen.findByTestId('meeting-chip-outlook:e1');
    expect(chip.textContent).toContain('Henderson');
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalledWith('m-hend');
  });

  it('shows unmatched meetings as unassigned and teaches on assign', async () => {
    listEvents.mockResolvedValue([unmatched]);
    render(<TodaysMeetingsStrip onOpenClient={() => {}} />);
    const assign = await screen.findByTestId('meeting-assign-outlook:e2');
    fireEvent.click(assign);
    // Picker lists the matter; choosing it persists the attendee email as a
    // taught meetingKey and the chip re-resolves to Henderson.
    fireEvent.click(await screen.findByTestId('meeting-assign-option-m-hend'));
    await waitFor(() => {
      expect(
        useMatterStore.getState().matters.find((m) => m.id === 'm-hend')
          ?.meetingKeys
      ).toContain('stranger@x.com');
    });
    expect(
      (await screen.findByTestId('meeting-chip-outlook:e2')).textContent
    ).toContain('Henderson');
  });
});

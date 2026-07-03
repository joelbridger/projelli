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
    expect(new Date(fromUtc).getTime()).toBeLessThanOrEqual(now.getTime());
    expect(new Date(toUtc).getTime()).toBeGreaterThan(now.getTime());
  });

  it('ends at the NEXT LOCAL CALENDAR DATE, not "start + 24h" (DST-safe)', () => {
    // COORDINATOR FINDING (P2): midnight + 24h is wrong on a DST transition
    // day (23h "spring forward" / 25h "fall back") — the end would land an
    // hour before or after the next day's actual local midnight, either
    // cutting off or over-including an hour of events. This test can't
    // literally observe a wall-clock DST jump (this environment runs in
    // UTC, which has no DST), so it checks the STRUCTURAL property the fix
    // guarantees instead: `toUtc`, read back through local calendar
    // components, is exactly one calendar day after `fromUtc` — built from
    // date components (which correctly rolls day/month/year and would
    // correctly skip/repeat an hour across a real DST boundary), not from
    // a fixed millisecond offset.
    const now = new Date('2026-07-02T09:00:00');
    const { fromUtc, toUtc } = todayWindowUtc(now);
    const start = new Date(fromUtc);
    const end = new Date(toUtc);
    const expectedEnd = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + 1
    );
    expect(end.getFullYear()).toBe(expectedEnd.getFullYear());
    expect(end.getMonth()).toBe(expectedEnd.getMonth());
    expect(end.getDate()).toBe(expectedEnd.getDate());
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);
    expect(end.getSeconds()).toBe(0);
  });

  it('rolls over a month/year boundary correctly (Dec 31 -> Jan 1)', () => {
    const now = new Date('2026-12-31T09:00:00');
    const { toUtc } = todayWindowUtc(now);
    const end = new Date(toUtc);
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(0);
    expect(end.getDate()).toBe(1);
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

  it('teaches immediately (one click) when there is only one candidate identifier', async () => {
    // organizerEmail === the only attendee's email: a single candidate after
    // dedup, so this must stay the one-click flow (no disambiguation step).
    const singleCandidate = {
      ...unmatched,
      id: 'outlook:e3',
      organizerEmail: 'stranger@x.com',
    };
    listEvents.mockResolvedValue([singleCandidate]);
    render(<TodaysMeetingsStrip onOpenClient={() => {}} />);
    const assign = await screen.findByTestId('meeting-assign-outlook:e3');
    fireEvent.click(assign);
    fireEvent.click(await screen.findByTestId('meeting-assign-option-m-hend'));
    await waitFor(() => {
      expect(
        useMatterStore.getState().matters.find((m) => m.id === 'm-hend')
          ?.meetingKeys
      ).toContain('stranger@x.com');
    });
    expect(
      (await screen.findByTestId('meeting-chip-outlook:e3')).textContent
    ).toContain('Henderson');
  });

  it('asks the user to disambiguate when organizer and attendee differ, and teaches ONLY the confirmed one', async () => {
    // organizerEmail ('adv@firm.com') and the attendee ('stranger@x.com')
    // are two DIFFERENT plausible identifiers — the exact ambiguity a
    // codex-review P1 flagged: picking blindly risks teaching the ADVISOR's
    // own address as a client key, misfiling every future meeting that
    // carries it. The user must pick which one is the real client.
    listEvents.mockResolvedValue([unmatched]);
    render(<TodaysMeetingsStrip onOpenClient={() => {}} />);
    const assign = await screen.findByTestId('meeting-assign-outlook:e2');
    fireEvent.click(assign);
    fireEvent.click(await screen.findByTestId('meeting-assign-option-m-hend'));

    // Picking the client does NOT teach yet — a second, identifier-picking
    // step must appear first.
    expect(
      useMatterStore.getState().matters.find((m) => m.id === 'm-hend')
        ?.meetingKeys
    ).not.toContain('stranger@x.com');
    expect(
      useMatterStore.getState().matters.find((m) => m.id === 'm-hend')
        ?.meetingKeys
    ).not.toContain('adv@firm.com');
    expect(await screen.findByText('stranger@x.com')).toBeTruthy();
    expect(await screen.findByText('adv@firm.com')).toBeTruthy();

    fireEvent.click(
      await screen.findByTestId('meeting-assign-identifier-stranger@x.com')
    );
    await waitFor(() => {
      const keys = useMatterStore
        .getState()
        .matters.find((m) => m.id === 'm-hend')?.meetingKeys;
      expect(keys).toContain('stranger@x.com');
      // The advisor's own (unconfirmed) address must NOT be taught.
      expect(keys).not.toContain('adv@firm.com');
    });
    expect(
      (await screen.findByTestId('meeting-chip-outlook:e2')).textContent
    ).toContain('Henderson');
  });
});

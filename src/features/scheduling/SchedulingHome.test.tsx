import '@/i18n';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useProfileStore } from '@/platform/profile/profileStore';
import { SchedulingHome } from './SchedulingHome';
import { useSchedulingStore } from './schedulingStore';
import type { AvailabilityRule, BookingRequest } from './types';

const CLOSED_WEEK: AvailabilityRule['workingHours'] = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

function schedulingRule(overrides: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return {
    workingHours: {
      ...CLOSED_WEEK,
      thursday: [{ startLocal: '09:00', endLocal: '11:00' }],
    },
    meetingTypes: [
      {
        id: 'intro',
        name: 'Intro call',
        durationMin: 30,
        bufferBeforeMin: 0,
        bufferAfterMin: 15,
      },
    ],
    minNoticeHours: 0,
    maxHorizonDays: 7,
    ...overrides,
  };
}

function pendingRequest(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    id: 'req-1',
    meetingTypeId: 'intro',
    requestedSlotUtc: '2026-07-09T15:00:00Z',
    clientName: 'Maya Chen',
    clientEmail: 'maya@example.com',
    status: 'pending',
    createdUtc: '2026-07-09T08:00:00Z',
    ...overrides,
  };
}

describe('SchedulingHome', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-09T08:00:00Z'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(() => Promise.resolve()),
      },
    });
    useProfileStore.setState({
      soloName: '',
      soloAvatar: null,
      firmName: '',
      firmLogo: null,
      advisorTimezone: 'America/Denver',
    });
    useSchedulingStore.setState({
      bookingSlug: { slug: 'jamie-daines', enabled: true },
      bookingRequests: [],
      availabilityRule: schedulingRule(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the native scheduling surface with the booking-link card', () => {
    render(<SchedulingHome />);

    expect(screen.getByTestId('scheduling-surface-header').textContent).toContain('Scheduling');
    expect(screen.getByTestId('scheduling-rail-upcoming').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('scheduling-booking-link').textContent).toContain(
      'https://book.advisorprephero.com/jamie-daines',
    );
    expect(screen.getByTestId('scheduling-booking-link-trust').textContent).toContain(
      'Clients only see your open times',
    );
    expect(screen.getByTestId('scheduling-upcoming-empty').textContent).toContain(
      'Share your link to start taking bookings.',
    );
  });

  it('creates no calendar-grid host element while its real flag is off', () => {
    const { container } = render(<SchedulingHome />);

    expect(container.querySelector('[data-scheduling-surface-id="calendar-grid"]')).toBeNull();
  });

  it('shows pending requests and confirms them inline', () => {
    useSchedulingStore.setState({
      bookingRequests: [pendingRequest()],
    });

    render(<SchedulingHome />);

    expect(screen.getByTestId('scheduling-booking-row-req-1').textContent).toContain('Maya Chen');
    expect(screen.getByTestId('scheduling-booking-status-pending').textContent).toContain('Needs confirmation');

    fireEvent.click(screen.getByTestId('scheduling-confirm-req-1'));

    expect(useSchedulingStore.getState().bookingRequests[0]?.status).toBe('confirmed');
    expect(screen.getByTestId('scheduling-booking-status-confirmed').textContent).toContain('Confirmed');
  });

  it('recomputes next open slots when working hours change', () => {
    render(<SchedulingHome />);

    fireEvent.click(screen.getByTestId('scheduling-rail-availability'));
    expect(screen.getAllByTestId('scheduling-open-slot')[0]?.textContent).toContain('9:00');

    fireEvent.change(screen.getByTestId('scheduling-start-thursday'), {
      target: { value: '10:00' },
    });

    const firstSlot = screen.getAllByTestId('scheduling-open-slot')[0];
    expect(firstSlot?.textContent).toContain('10:00');
    expect(firstSlot?.textContent).not.toContain('9:00');
  });

  it('renders next open slots in the advisor timezone instead of UTC', () => {
    useSchedulingStore.setState({
      availabilityRule: schedulingRule({
        workingHours: {
          ...CLOSED_WEEK,
          friday: [{ startLocal: '09:00', endLocal: '10:00' }],
        },
      }),
    });

    render(<SchedulingHome />);

    const firstSlotText = screen.getAllByTestId('scheduling-open-slot')[0]?.textContent ?? '';
    expect(firstSlotText).toContain('Fri, Jul 10');
    expect(firstSlotText).toContain('9:00 AM');
    expect(firstSlotText).not.toContain('3:00 PM');
    expect(firstSlotText).not.toContain('UTC');
  });

  it('edits a meeting type from the row menu slide panel', async () => {
    render(<SchedulingHome />);
    vi.useRealTimers();

    fireEvent.click(screen.getByTestId('scheduling-rail-meeting-types'));
    fireEvent.pointerDown(screen.getByLabelText('More actions for Intro call'), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByTestId('scheduling-edit-meeting-type-intro'));

    const panel = screen.getByTestId('scheduling-meeting-type-panel');
    fireEvent.change(within(panel).getByTestId('scheduling-meeting-type-name'), {
      target: { value: 'Annual review' },
    });
    fireEvent.change(within(panel).getByTestId('scheduling-meeting-type-duration-input'), {
      target: { value: '60' },
    });
    fireEvent.click(within(panel).getByTestId('scheduling-save-meeting-type'));

    const [meetingType] = useSchedulingStore.getState().availabilityRule.meetingTypes;
    expect(meetingType).toMatchObject({
      id: 'intro',
      name: 'Annual review',
      durationMin: 60,
    });
    expect(screen.getByTestId('scheduling-meeting-type-intro').textContent).toContain('Annual review');
  });
});

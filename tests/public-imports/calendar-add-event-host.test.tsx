import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SchedulingSurfaceRuntime } from '@/platform/calendar';

const mocks = vi.hoisted(() => ({
  useCalendarEventStore: vi.fn(),
  useCalendarCapabilityStore: vi.fn(),
}));

vi.mock('@/platform/flags', () => ({
  isEnabled: () => false,
  useFlag: () => false,
}));
vi.mock('@/features/calendar', () => ({
  CalendarFoundationError: class CalendarFoundationError extends Error {},
  useCalendarEventStore: mocks.useCalendarEventStore,
  useCalendarCapabilityStore: mocks.useCalendarCapabilityStore,
  validateCalendarEventDraft: <T,>(value: T) => value,
  validateCalendarRecurrence: <T,>(value: T) => value,
}));

const runtime = {
  state: {
    availabilityRule: {
      workingHours: {
        monday: [], tuesday: [], wednesday: [], thursday: [], friday: [],
        saturday: [], sunday: [],
      },
      meetingTypes: [], minNoticeHours: 0, maxHorizonDays: 1,
    },
    bookingSlug: { slug: '', enabled: false },
    bookingRequests: [],
    setBookingSlug: () => {}, setDayEnabled: () => {}, updateWorkingHours: () => {},
    addMeetingType: () => 'id', updateMeetingType: () => {}, removeMeetingType: () => {},
    confirmBookingRequest: () => {}, declineBookingRequest: () => {},
    setMinNoticeHours: () => {}, setMaxHorizonDays: () => {},
  },
} satisfies SchedulingSurfaceRuntime;

describe('calendar add-event scheduling host while dark', () => {
  it('registers no descriptor, element, gap, mount call, or calendar read', async () => {
    const { calendarAddEventSurface } = await import(
      '@/features/calendar-add-event/calendarAddEventSurface'
    );
    const mount = vi.spyOn(calendarAddEventSurface, 'mount');
    const {
      renderSchedulingSurfaceRegistry,
      schedulingSurfaceRegistry,
    } = await import('@/features/scheduling/schedulingSurfaceRegistry');

    expect(
      schedulingSurfaceRegistry.some((descriptor) => descriptor.id === 'calendar-add-event'),
    ).toBe(false);
    const { container } = render(<>{renderSchedulingSurfaceRegistry(runtime)}</>);
    expect(screen.queryByTestId('calendar-add-event-mount')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-scheduling-surface-id="calendar-add-event"]'),
    ).not.toBeInTheDocument();
    expect(mount).not.toHaveBeenCalled();
    expect(mocks.useCalendarEventStore).not.toHaveBeenCalled();
    expect(mocks.useCalendarCapabilityStore).not.toHaveBeenCalled();
  });
});

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
    const { calendarAddEventSurface, calendarAddEventSurfaces } = await import('@/features/calendar-add-event');
    const mount = vi.spyOn(calendarAddEventSurface, 'mount');

    // Scheduling keeps its registry private. The add-event contribution is the
    // public contract the host consumes, so an empty contribution list proves
    // that the host can receive neither a descriptor nor its mount output.
    expect(calendarAddEventSurfaces).toEqual([]);
    const { container } = render(
      <>{calendarAddEventSurfaces.map((descriptor) => (
        <div key={descriptor.id} data-scheduling-surface-id={descriptor.id}>
          {descriptor.mount(runtime)}
        </div>
      ))}</>,
    );
    expect(screen.queryByTestId('calendar-add-event-mount')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-scheduling-surface-id="calendar-add-event"]'),
    ).not.toBeInTheDocument();
    expect(mount).not.toHaveBeenCalled();
    expect(mocks.useCalendarEventStore).not.toHaveBeenCalled();
    expect(mocks.useCalendarCapabilityStore).not.toHaveBeenCalled();
  });
});

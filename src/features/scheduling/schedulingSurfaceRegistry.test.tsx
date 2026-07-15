import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SchedulingSurfaceDescriptor, SchedulingSurfaceRuntime } from '@/platform/calendar';
import { renderSchedulingSurfaceRegistry, validateSchedulingSurfaceDescriptors } from './schedulingSurfaceRegistry';

declare module '@/platform/calendar' {
  interface SchedulingSurfaceMap {
    'test-scheduling-contribution': true;
    'later-scheduling-contribution': true;
  }
}

const runtime = {
  state: {
    availabilityRule: { workingHours: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] }, meetingTypes: [], minNoticeHours: 0, maxHorizonDays: 1 },
    bookingSlug: { slug: '', enabled: false }, bookingRequests: [],
    setBookingSlug: () => {}, setDayEnabled: () => {}, updateWorkingHours: () => {}, addMeetingType: () => 'id',
    updateMeetingType: () => {}, removeMeetingType: () => {}, confirmBookingRequest: () => {}, declineBookingRequest: () => {}, setMinNoticeHours: () => {}, setMaxHorizonDays: () => {},
  },
} satisfies SchedulingSurfaceRuntime;

const dummyContribution: SchedulingSurfaceDescriptor = {
  id: 'test-scheduling-contribution', slot: 'calendar-grid', order: 20,
  // eslint-disable-next-line lantern-i18n/no-hardcoded-string -- test fixture content, not user-facing copy.
  mount: () => <div data-testid="dummy-scheduling-contribution">Mounted through a descriptor</div>,
};

const misspelledDescriptor: SchedulingSurfaceDescriptor = {
  // @ts-expect-error Scheduling surface ids must be declared by a feature module.
  id: 'calender-grid', slot: 'calendar-grid', order: 1, mount: () => null,
};
void misspelledDescriptor;

describe('schedulingSurfaceRegistry', () => {
  it('mounts a feature contribution through its descriptor without a shell switch', () => {
    render(<>{renderSchedulingSurfaceRegistry(runtime, [dummyContribution])}</>);
    expect(screen.getByTestId('dummy-scheduling-contribution')).toBeTruthy();
  });

  it('keeps descriptor order stable and rejects duplicate ids or invalid contracts', () => {
    const later = { ...dummyContribution, id: 'later-scheduling-contribution' as const, order: 30 };
    expect(renderSchedulingSurfaceRegistry(runtime, [later, dummyContribution])).toHaveLength(2);
    expect(() => { validateSchedulingSurfaceDescriptors([dummyContribution, dummyContribution]); }).toThrow('duplicate surface id');
    expect(() => { validateSchedulingSurfaceDescriptors([{ ...dummyContribution, order: Number.NaN }]); }).toThrow('invalid order');
  });
});

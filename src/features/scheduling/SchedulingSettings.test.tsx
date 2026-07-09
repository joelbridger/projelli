import '@/i18n';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useProfileStore } from '@/platform/profile/profileStore';
import { SchedulingSettings } from './SchedulingSettings';
import { useSchedulingStore } from './schedulingStore';

describe('SchedulingSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    useProfileStore.setState({
      soloName: '',
      soloAvatar: null,
      firmName: '',
      firmLogo: null,
      advisorTimezone: 'America/New_York',
    });
    useSchedulingStore.setState({
      bookingSlug: { slug: 'jamie-daines', enabled: true },
      availabilityRule: useSchedulingStore.getState().getDefaultAvailabilityRule(),
    });
  });

  it('shows the placeholder booking link and saves advisor timezone', () => {
    render(<SchedulingSettings />);

    expect(screen.getByTestId('scheduling-booking-link').textContent).toBe(
      'https://book.advisorprephero.com/jamie-daines',
    );

    fireEvent.change(screen.getByTestId('scheduling-timezone-input'), {
      target: { value: 'America/Los_Angeles' },
    });

    expect(useProfileStore.getState().advisorTimezone).toBe('America/Los_Angeles');
  });

  it('edits meeting type duration and buffer settings', () => {
    render(<SchedulingSettings />);

    fireEvent.change(screen.getByTestId('scheduling-meeting-duration-intro'), {
      target: { value: '45' },
    });
    fireEvent.change(screen.getByTestId('scheduling-buffer-after-intro'), {
      target: { value: '20' },
    });

    const [meetingType] = useSchedulingStore.getState().availabilityRule.meetingTypes;
    expect(meetingType?.durationMin).toBe(45);
    expect(meetingType?.bufferAfterMin).toBe(20);
  });

  it('toggles weekday working hours', () => {
    render(<SchedulingSettings />);

    fireEvent.click(screen.getByTestId('scheduling-day-toggle-saturday'));

    expect(useSchedulingStore.getState().availabilityRule.workingHours.saturday).toEqual([
      { startLocal: '09:00', endLocal: '17:00' },
    ]);
  });
});

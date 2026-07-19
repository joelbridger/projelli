import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BLESSED_MEETING_PANEL_IDS,
  getMeetingPanelComposition,
} from '@/features/meetings';
import {
  createMeetingAgendaPanelDescriptor,
  useMeetingAgendaCompatibility,
} from './meetingAgendaCompatibility';

function MeetingHostProbe() {
  useMeetingAgendaCompatibility();
  return null;
}

describe('Agenda compatibility binding', () => {
  it('imports the exact blessed Agenda id and registers only while a real host is mounted', async () => {
    const blessedAgendaId = BLESSED_MEETING_PANEL_IDS.find(
      (id) => id === 'agenda'
    );
    expect(createMeetingAgendaPanelDescriptor().id).toBe(blessedAgendaId);
    expect(
      getMeetingPanelComposition().panels.some((panel) => panel.id === 'agenda')
    ).toBe(false);

    const view = render(<MeetingHostProbe />);
    await waitFor(() => {
      expect(
        getMeetingPanelComposition().panels.filter(
          (panel) => panel.id === 'agenda'
        )
      ).toHaveLength(1);
    });

    view.unmount();
    expect(
      getMeetingPanelComposition().panels.some((panel) => panel.id === 'agenda')
    ).toBe(false);
  });
});

import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  BLESSED_MEETING_PANEL_IDS,
  defaultMeetingPanelComposition,
  getMeetingPanelComposition,
} from '@/features/meetings';
import {
  createMeetingFollowUpPanelDescriptor,
  useMeetingFollowUpCompatibility,
} from './meetingFollowUpCompatibility';

function MeetingHostProbe() {
  useMeetingFollowUpCompatibility();
  return null;
}

describe('Follow-up compatibility binding', () => {
  it('imports F2 blessed Follow-up id and adds no base descriptor', async () => {
    const blessed = BLESSED_MEETING_PANEL_IDS.find((id) => id === 'follow-up');
    expect(createMeetingFollowUpPanelDescriptor().id).toBe(blessed);
    expect(
      defaultMeetingPanelComposition.panels.some(
        (panel) => panel.id === 'follow-up'
      )
    ).toBe(false);

    const view = render(<MeetingHostProbe />);
    await waitFor(() => {
      expect(
        getMeetingPanelComposition().panels.filter(
          (panel) => panel.id === 'follow-up'
        )
      ).toHaveLength(1);
    });
    view.unmount();
    expect(
      getMeetingPanelComposition().panels.some(
        (panel) => panel.id === 'follow-up'
      )
    ).toBe(false);
  });
});

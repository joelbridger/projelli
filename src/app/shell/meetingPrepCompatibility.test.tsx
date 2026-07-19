import { describe, expect, it } from 'vitest';
import {
  BLESSED_MEETING_PANEL_IDS,
  getMeetingPanelComposition,
} from '@/features/meetings';
import { meetingPrepPanelDescriptor } from './meetingPrepCompatibility';

describe('meeting Prep compatibility binding', () => {
  it('clean-registers the exact blessed Prep slot into the live host', () => {
    expect(meetingPrepPanelDescriptor.id).toBe(BLESSED_MEETING_PANEL_IDS[0]);
    expect(getMeetingPanelComposition().panels).toContain(
      meetingPrepPanelDescriptor
    );
    expect(
      getMeetingPanelComposition().panels.filter(
        (panel) => panel.id === BLESSED_MEETING_PANEL_IDS[0]
      )
    ).toHaveLength(1);
  });
});

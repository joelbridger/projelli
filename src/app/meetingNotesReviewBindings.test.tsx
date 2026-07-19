import { describe, expect, it } from 'vitest';
import {
  BLESSED_MEETING_PANEL_IDS,
  defaultMeetingPanelComposition,
  getMeetingPanelComposition,
} from '@/features/meetings';
import { registerMeetingNotesReviewCompatibilityPanels } from './meetingNotesReviewBindings';

describe('meeting Tasks/CRM compatibility bindings', () => {
  it('fills the exact F2 slots as contributions without adding base descriptors', () => {
    expect(defaultMeetingPanelComposition.panels.map((panel) => panel.id)).not.toContain(
      BLESSED_MEETING_PANEL_IDS[4]
    );
    expect(defaultMeetingPanelComposition.panels.map((panel) => panel.id)).not.toContain(
      BLESSED_MEETING_PANEL_IDS[5]
    );

    registerMeetingNotesReviewCompatibilityPanels();
    const ids = getMeetingPanelComposition().panels.map((panel) => panel.id);
    expect(ids).toContain(BLESSED_MEETING_PANEL_IDS[4]);
    expect(ids).toContain(BLESSED_MEETING_PANEL_IDS[5]);
    expect(ids.filter((id) => id === BLESSED_MEETING_PANEL_IDS[4])).toHaveLength(1);
    expect(ids.filter((id) => id === BLESSED_MEETING_PANEL_IDS[5])).toHaveLength(1);
  });
});

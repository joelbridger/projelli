import { describe, expect, it } from 'vitest';
import {
  BLESSED_MEETING_PANEL_IDS,
  defaultMeetingPanelComposition,
  getMeetingPanelComposition,
} from '@/features/meetings';
import {
  hasMatchingCompleteMeetingReviewIdentity,
  registerMeetingNotesReviewCompatibilityPanels,
} from './meetingNotesReviewBindings';

describe('meeting Tasks/CRM compatibility bindings', () => {
  it('never treats two missing or partial identities as a matching pair', () => {
    const cases = [
      [
        { id: '', householdRef: '', matterId: '' },
        { householdRef: '', matterId: '' },
      ],
      [
        { id: 'meeting-a', householdRef: '', matterId: 'matter-a' },
        { householdRef: '', matterId: 'matter-a' },
      ],
      [
        { id: 'meeting-a', householdRef: 'household-a', matterId: '' },
        { householdRef: 'household-a', matterId: '' },
      ],
    ] as const;

    for (const [meeting, client] of cases) {
      expect(hasMatchingCompleteMeetingReviewIdentity(meeting, client)).toBe(
        false
      );
    }
    expect(
      hasMatchingCompleteMeetingReviewIdentity(
        {
          id: 'meeting-a',
          householdRef: 'household-a',
          matterId: 'matter-a',
        },
        { householdRef: 'household-a', matterId: 'matter-a' }
      )
    ).toBe(true);
  });

  it('fills the exact F2 slots as contributions without adding base descriptors', () => {
    expect(
      defaultMeetingPanelComposition.panels.map((panel) => panel.id)
    ).not.toContain(BLESSED_MEETING_PANEL_IDS[4]);
    expect(
      defaultMeetingPanelComposition.panels.map((panel) => panel.id)
    ).not.toContain(BLESSED_MEETING_PANEL_IDS[5]);

    registerMeetingNotesReviewCompatibilityPanels();
    const ids = getMeetingPanelComposition().panels.map((panel) => panel.id);
    expect(ids).toContain(BLESSED_MEETING_PANEL_IDS[4]);
    expect(ids).toContain(BLESSED_MEETING_PANEL_IDS[5]);
    expect(
      ids.filter((id) => id === BLESSED_MEETING_PANEL_IDS[4])
    ).toHaveLength(1);
    expect(
      ids.filter((id) => id === BLESSED_MEETING_PANEL_IDS[5])
    ).toHaveLength(1);
  });
});

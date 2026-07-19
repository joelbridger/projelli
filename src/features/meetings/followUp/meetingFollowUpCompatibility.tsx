import { useEffect, useState } from 'react';
import {
  BLESSED_MEETING_PANEL_IDS,
  type MeetingPanelDescriptor,
} from '@/features/meetings';
import {
  getMeetingPanelComposition,
  registerMeetingPanel,
} from '../meetingPanelRegistry';
import { LiveMeetingFollowUpPanel } from './MeetingFollowUpPanel';

let mountedHostCount = 0;
let unregisterOwnedPanel: (() => void) | null = null;

/** Rule (b): claim the blessed Follow-up slot without adding a base descriptor. */
export function createMeetingFollowUpPanelDescriptor(): MeetingPanelDescriptor {
  const followUpId = BLESSED_MEETING_PANEL_IDS.find((id) => id === 'follow-up');
  if (!followUpId) {
    throw new Error('The blessed Follow-up panel slot is unavailable.');
  }
  return {
    id: followUpId,
    order: 60,
    labelKey: 'meetings.entry.tab-follow-up',
    mount: (context) => <LiveMeetingFollowUpPanel context={context} />,
  };
}

function acquireMeetingFollowUpCompatibility(): () => void {
  mountedHostCount += 1;
  const descriptor = createMeetingFollowUpPanelDescriptor();
  if (
    mountedHostCount === 1 &&
    !unregisterOwnedPanel &&
    !getMeetingPanelComposition().panels.some(
      (candidate) => candidate.id === descriptor.id
    )
  ) {
    unregisterOwnedPanel = registerMeetingPanel(descriptor);
  }
  return () => {
    mountedHostCount = Math.max(0, mountedHostCount - 1);
    if (mountedHostCount === 0 && unregisterOwnedPanel) {
      unregisterOwnedPanel();
      unregisterOwnedPanel = null;
    }
  };
}

/** Bind Follow-up only for the lifetime of a real, sealed MeetingEntry host. */
export function useMeetingFollowUpCompatibility(): void {
  const [, setBound] = useState(false);
  useEffect(() => {
    let mounted = true;
    const release = acquireMeetingFollowUpCompatibility();
    queueMicrotask(() => {
      if (mounted) setBound(true);
    });
    return () => {
      mounted = false;
      release();
    };
  }, []);
}

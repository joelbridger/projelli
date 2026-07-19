import { useEffect, useState } from 'react';
import {
  BLESSED_MEETING_PANEL_IDS,
  type MeetingPanelDescriptor,
} from '@/features/meetings';
import {
  getMeetingPanelComposition,
  registerMeetingPanel,
} from '../meetingPanelRegistry';
import { LiveMeetingAgendaPanel } from './MeetingAgendaPanel';

let mountedHostCount = 0;
let unregisterOwnedPanel: (() => void) | null = null;

/**
 * Rule (b): Agenda had no compatibility descriptor, so this descriptor claims
 * the exact blessed Agenda slot imported through the public meetings doorway.
 */
export function createMeetingAgendaPanelDescriptor(): MeetingPanelDescriptor {
  const agendaId = BLESSED_MEETING_PANEL_IDS.find((id) => id === 'agenda');
  if (!agendaId)
    throw new Error('The blessed Agenda panel slot is unavailable.');
  return {
    id: agendaId,
    order: 20,
    labelKey: 'meetings.entry.tab-agenda',
    mount: (context) => <LiveMeetingAgendaPanel context={context} />,
  };
}

function acquireMeetingAgendaCompatibility(): () => void {
  mountedHostCount += 1;
  const descriptor = createMeetingAgendaPanelDescriptor();
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

/**
 * Bind Agenda only while a real MeetingEntry host is mounted. This keeps the
 * closed registry honest in non-host consumers and safely reference-counts
 * master/detail views that mount more than one meeting at once.
 */
export function useMeetingAgendaCompatibility(): void {
  const [, setBound] = useState(false);
  useEffect(() => {
    let mounted = true;
    const release = acquireMeetingAgendaCompatibility();
    queueMicrotask(() => {
      if (mounted) setBound(true);
    });
    return () => {
      mounted = false;
      release();
    };
  }, []);
}

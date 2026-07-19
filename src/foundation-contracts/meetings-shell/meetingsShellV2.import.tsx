import { createElement, useEffect } from 'react';
import {
  registerMeetingListDescriptor,
  registerMeetingListToolDescriptor,
} from '@/features/meetings';

export const OUTSIDE_MEETINGS_CONTRIBUTIONS = {
  list: 'outside-list-view',
  tool: 'outside-list-tool',
} as const;

/** A consumer outside Meetings that uses only the public package doorway. */
export function OutsideMeetingsShellContributions() {
  useEffect(() => {
    const cleanups = [
      registerMeetingListDescriptor({
        id: OUTSIDE_MEETINGS_CONTRIBUTIONS.list,
        kind: 'primary',
        order: 35,
        labelKey: 'meetings.shell.fixture.list',
        render: (context) =>
          createElement(
            'output',
            {
              'data-testid': 'outside-meeting-list-host',
            },
            context.meetings.length
          ),
      }),
      registerMeetingListToolDescriptor({
        id: OUTSIDE_MEETINGS_CONTRIBUTIONS.tool,
        order: 20,
        labelKey: 'meetings.shell.fixture.tool',
        render: (context) =>
          createElement(
            'button',
            {
              type: 'button',
              'data-testid': 'outside-meeting-tool-control',
              onClick: () => { context.setOwnerFilter(null); },
            },
            context.ownerFilter ?? 'all'
          ),
      }),
    ];
    return () => { cleanups.reverse().forEach((cleanup) => { cleanup(); }); };
  }, []);

  return null;
}

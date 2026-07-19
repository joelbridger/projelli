import { createElement, useEffect } from 'react';
import {
  registerMeetingArtifactDescriptor,
  registerMeetingListDescriptor,
  registerMeetingListToolDescriptor,
  registerNoticeEvidenceProviderDescriptor,
} from '@/features/meetings';

export const OUTSIDE_MEETINGS_CONTRIBUTIONS = {
  list: 'outside-list-view',
  tool: 'outside-list-tool',
  artifact: 'outside-artifact',
  notice: 'outside-notice',
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
      registerMeetingArtifactDescriptor({
        id: OUTSIDE_MEETINGS_CONTRIBUTIONS.artifact,
        order: 10,
        labelKey: 'meetings.shell.fixture.artifact',
        render: (context) =>
          createElement('output', {
            'data-testid': 'outside-meeting-artifact-host',
            'data-meeting-id': context.meeting.id,
          }),
      }),
      registerNoticeEvidenceProviderDescriptor({
        id: OUTSIDE_MEETINGS_CONTRIBUTIONS.notice,
        order: 10,
        labelKey: 'meetings.shell.fixture.notice',
        render: (context) =>
          createElement('output', {
            'data-testid': 'outside-meeting-notice-host',
            'data-meeting-id': context.meeting.id,
          }),
      }),
    ];
    return () => { cleanups.reverse().forEach((cleanup) => { cleanup(); }); };
  }, []);

  return null;
}

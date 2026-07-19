import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import {
  createDirectClientMeetingsAdapter,
  type SealedMeetingClientBoundary,
} from './foundation/contract';
import { MeetingEntry } from './MeetingEntry';

const clientA = {
  householdRef: 'household-a',
  matterId: 'matter-shared',
  displayName: 'Alpha Household',
} as SealedMeetingClientBoundary;
const clientB = {
  householdRef: 'household-b',
  matterId: 'matter-shared',
  displayName: 'Beta Household',
} as SealedMeetingClientBoundary;
const clientFolder = '/workspace/Clients/Alpha';

afterEach(() => {
  useMatterStore.setState({ matters: [] });
});

describe('MeetingEntry synchronous pair-change unmount', () => {
  it('removes the whole detail host before a same-matter new household can render it', async () => {
    useMatterStore.setState({
      matters: [
        {
          id: clientA.matterId,
          name: 'Shared matter',
          client: 'Alpha Household',
          folderPaths: [clientFolder],
          crmHouseholdKeys: [clientA.householdRef],
          createdAt: '2026-07-01T00:00:00.000Z',
        } as Matter,
      ],
    });
    const adapter = createDirectClientMeetingsAdapter({
      client: clientA,
      getActiveClientBoundary: () => clientA,
      matterFolder: clientFolder,
      scan: () =>
        Promise.resolve({
          meetings: [
            {
              dir: `${clientFolder}/Meetings/meeting-a`,
              folderName: 'meeting-a',
            },
          ],
          scanFailed: false,
        }),
    });
    const result = await adapter.list();
    const target = adapter.resolveTarget(result, {
      dir: `${clientFolder}/Meetings/meeting-a`,
      folderName: 'meeting-a',
    });
    if (!target) throw new Error('expected pair-bound target');

    const props = {
      target,
      clientName: 'Alpha Household',
      workspaceRoot: '/workspace',
      workspaceService: null,
      onBack: () => undefined,
    } as const;
    const { rerender } = render(
      <MeetingEntry {...props} activeClientBoundary={clientA} />
    );
    expect(screen.getByTestId('meeting-entry')).toBeInTheDocument();

    rerender(<MeetingEntry {...props} activeClientBoundary={clientB} />);

    expect(screen.queryByTestId('meeting-entry')).toBeNull();
    expect(screen.queryByTestId('meeting-entry-audio-handoff')).toBeNull();
    expect(screen.queryByTestId('meeting-subtab-summary')).toBeNull();
  });
});

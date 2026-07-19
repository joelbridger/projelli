import { afterEach, describe, expect, it } from 'vitest';
import type { Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { ClientScopedLivePort, SealedMeetingClientBoundary } from '@/features/meetings';
import { proveMeetingsLinkStatusPublicDoorway } from './meetingsLinkStatus.import';

const directory = 'Clients/Household One/Meetings/2026-07-20';

function linkedPort(): ClientScopedLivePort & { readonly mutations: string[] } {
  const mutations: string[] = [];
  return {
    records: [],
    workspaceRoot: '/workspace',
    error: null,
    getActiveClientBoundary: () => ({
      householdRef: 'household-1',
      matterId: 'matter-1',
    }) as SealedMeetingClientBoundary,
    save: () => {
      mutations.push('save');
      return Promise.reject(new Error('status must not mutate'));
    },
    reloadRecords: () =>
      Promise.resolve([
        {
          id: 'meeting-1',
          kind: 'meeting',
          matterId: 'matter-1',
          householdRef: 'household-1',
          legacyMeetingLink: {
            meetingDir: directory,
            linkedAt: '2026-07-01T00:00:00.000Z',
          },
        },
      ]),
    mutations,
  };
}

afterEach(() => {
  setActiveWorkspaceService(null);
  useMatterStore.setState({ matters: [] });
});

describe('meetings link-status public doorway', () => {
  it('executes a sealed, read-only linked result through the public index', async () => {
    useMatterStore.setState({
      matters: [
        {
          id: 'matter-1',
          name: 'Household One',
          client: 'Household One',
          folderPaths: ['/workspace/Clients/Household One'],
          crmHouseholdKeys: ['household-1'],
          createdAt: '2026-07-01T00:00:00.000Z',
        } as Matter,
      ],
    });
    setActiveWorkspaceService({
      getRootPath: () => '/workspace',
    } as unknown as WorkspaceService);

    const port = linkedPort();
    const result = await proveMeetingsLinkStatusPublicDoorway(port, {
      meetingDir: directory,
    });

    expect(result.status).toMatchObject({
      kind: 'linked',
      meetingRef: 'meeting-1',
    });
    expect(result.statusVerified).toBe(true);
    expect(result.forgedStatusRejected).toBe(true);
    expect(Object.isFrozen(result.status)).toBe(true);
    expect(port.mutations).toEqual([]);
  });
});

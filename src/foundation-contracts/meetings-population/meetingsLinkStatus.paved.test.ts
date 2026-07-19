import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import {
  readActiveMeetingClientBoundary,
  type ClientScopedLivePort,
  type SealedMeetingClientBoundary,
} from '@/features/meetings';
import { proveMeetingsLinkStatusPublicDoorway } from './meetingsLinkStatus.import';

const meetingBoundaryMint = vi.hoisted(() => ({
  selection: null as null | { householdRef: string; matterId: string },
}));

vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/client-context')>();
  return {
    ...actual,
    readSelectionOperationDecision: (
      request: Parameters<typeof actual.readSelectionOperationDecision>[0]
    ) => {
      const selection = meetingBoundaryMint.selection;
      return selection
        ? {
            kind: 'matter' as const,
            sourceKind: 'matter' as const,
            matter: { id: selection.matterId } as Matter,
            client: {
              provider: 'wealthbox' as const,
              householdId: selection.householdRef,
              displayName: selection.householdRef,
            },
          }
        : actual.readSelectionOperationDecision(request);
    },
  };
});

function mintedBoundary(
  householdRef: string,
  matterId: string
): SealedMeetingClientBoundary {
  meetingBoundaryMint.selection = { householdRef, matterId };
  try {
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected live-authority meeting boundary');
    return boundary;
  } finally {
    meetingBoundaryMint.selection = null;
  }
}

const directory = 'Clients/Household One/Meetings/2026-07-20';

function linkedPort(): ClientScopedLivePort & { readonly mutations: string[] } {
  const mutations: string[] = [];
  return {
    records: [],
    workspaceRoot: '/workspace',
    error: null,
    getActiveClientBoundary: () => mintedBoundary('household-1', 'matter-1'),
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

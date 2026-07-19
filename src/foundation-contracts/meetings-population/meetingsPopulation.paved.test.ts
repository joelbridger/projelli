import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  readActiveMeetingClientBoundary,
  type ClientScopedLivePort,
  type SealedMeetingClientBoundary,
} from '@/features/meetings';
import { proveMeetingsPopulationPavedPath } from './meetingsPopulation.import';

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

// Executable third-contributor proof: run the WHOLE public population paved path
// end-to-end. It supplies only a live-record port; the matter set and workspace
// filesystem are seeded into the TRUSTED platform stores, and the contract
// derives authority from them. A consumer never hands identity in.

function canonicalPort(): ClientScopedLivePort & {
  readCanonical: () => LiveCrmRecord[];
} {
  let canonical: LiveCrmRecord[] = [];
  return {
    records: [],
    workspaceRoot: '/workspace',
    error: null,
    getActiveClientBoundary: () => mintedBoundary('household-1', 'matter-1'),
    getFirmSelectionError: () => null,
    save(record: LiveCrmRecord) {
      const saved = structuredClone(record);
      canonical = canonical.some((item) => item.id === saved.id)
        ? canonical.map((item) => (item.id === saved.id ? saved : item))
        : [...canonical, saved];
      return Promise.resolve(structuredClone(saved));
    },
    reloadRecords: () => Promise.resolve(structuredClone(canonical)),
    readCanonical: () => structuredClone(canonical),
  };
}

afterEach(() => {
  setActiveWorkspaceService(null);
  useMatterStore.setState({ matters: [] });
});

describe('meetings-population third-contributor paved path', () => {
  it('runs the public doorway end-to-end and enforces the un-forgeable seal', async () => {
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
      ] as Matter[],
    });
    setActiveWorkspaceService({
      getRootPath: () => '/workspace',
      exists: () => Promise.resolve(true),
      readFile: () => Promise.resolve(JSON.stringify({ matterId: 'matter-1' })),
      isSymlink: () => Promise.resolve(false),
      resolveSymlink: () => Promise.resolve('/workspace'),
    } as unknown as WorkspaceService);

    const result = await proveMeetingsPopulationPavedPath(
      canonicalPort(),
      {
        workspaceId: 'workspace-1',
        householdRef: 'household-1',
        matterId: 'matter-1',
        typeId: 'review',
        ownerRef: 'member-1',
        scheduledStartUtc: '2026-07-20T09:00:00.000Z',
        scheduledEndUtc: '2026-07-20T10:00:00.000Z',
        timezone: 'America/Chicago',
      },
      { meetingDir: 'Clients/Household One/Meetings/2026-07-20' }
    );

    expect(result.linkedMeetingId).toMatch(/^meeting-/);
    expect(result.openTargetVerified).toBe(true);
    expect(result.forgedTargetRejected).toBe(true);
    expect(result.firmListCount).toBe(1);
  });
});

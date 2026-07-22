import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { MeetingEntry } from './MeetingEntry';

const meetingBoundaryMint = vi.hoisted(() => ({
  selection: null as null | {
    householdRef: string;
    matterId: string;
    displayName?: string;
  },
}));

vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/client-context')>();
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
              displayName: selection.displayName ?? selection.householdRef,
            },
          }
        : actual.readSelectionOperationDecision(request);
    },
  };
});

import {
  createDirectClientMeetingsAdapter,
  createMeetingPopulationService,
  readActiveMeetingClientBoundary,
  type DirectClientMeetingTarget,
  type MeetingOpenTarget,
  type SealedMeetingClientBoundary,
} from './foundation/contract';
import {
  meetingEntryHostIdentity,
  type MeetingEntryHostIdentity,
  type MeetingEntryTarget,
} from './meetingEntryHostIdentity';
import { registerMeetingHeaderAction } from './meetingHeaderActionRegistry';

declare module './meetingWorkspaceTypes' {
  interface MeetingHeaderActionIdMap {
    host_identity_probe: true;
  }
}

let unregisterHeaderProbe: (() => void) | null = null;

function captureHeaderIdentity(
  capture: (identity: MeetingEntryHostIdentity) => void
): void {
  unregisterHeaderProbe?.();
  unregisterHeaderProbe = registerMeetingHeaderAction({
    id: 'host_identity_probe',
    order: 5,
    labelKey: 'meetings.entry.host-identity-probe',
    placement: 'secondary',
    mount: (context) => {
      capture(context.hostIdentity);
      return createElement('span', { 'data-testid': 'host-identity-probe' });
    },
  });
}

function mintedBoundary(
  householdRef: string,
  matterId: string,
  displayName?: string
): SealedMeetingClientBoundary {
  meetingBoundaryMint.selection = {
    householdRef,
    matterId,
    ...(displayName !== undefined ? { displayName } : {}),
  };
  try {
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected live-authority meeting boundary');
    return boundary;
  } finally {
    meetingBoundaryMint.selection = null;
  }
}

const clientA = mintedBoundary(
  'household-a',
  'matter-shared',
  'Alpha Household'
);
const clientB = mintedBoundary(
  'household-b',
  'matter-shared',
  'Beta Household'
);
const clientFolder = '/workspace/Clients/Alpha';
const meetingDir = `${clientFolder}/Meetings/meeting-a`;

function canonicalPort() {
  let records: LiveCrmRecord[] = [];
  return {
    records,
    workspaceRoot: '/workspace',
    error: null,
    getActiveClientBoundary: () => clientA,
    save(record: LiveCrmRecord) {
      records = [
        ...records.filter((candidate) => candidate.id !== record.id),
        record,
      ];
      return Promise.resolve(structuredClone(record));
    },
    reloadRecords: () => Promise.resolve(structuredClone(records)),
  };
}

function seedTrustedAuthority(): void {
  useMatterStore.setState({
    matters: [
      {
        id: clientA.matterId,
        name: 'Shared matter',
        client: 'Alpha Household',
        folderPaths: [clientFolder],
        crmHouseholdKeys: [clientA.householdRef, clientB.householdRef],
        createdAt: '2026-07-01T00:00:00.000Z',
      } as Matter,
    ],
  });
  setActiveWorkspaceService({
    getRootPath: () => '/workspace',
    exists: () => Promise.resolve(true),
    readFile: () =>
      Promise.resolve(JSON.stringify({ matterId: clientA.matterId })),
    isSymlink: () => Promise.resolve(false),
    resolveSymlink: () => Promise.resolve('/workspace'),
  } as unknown as WorkspaceService);
}

async function mintCanonicalTarget(): Promise<MeetingOpenTarget> {
  const service = createMeetingPopulationService(canonicalPort());
  const meeting = await service.createAndLink(
    {
      workspaceId: 'workspace-1',
      householdRef: clientA.householdRef,
      matterId: clientA.matterId,
      typeId: 'review',
      ownerRef: 'member-1',
      scheduledStartUtc: '2026-07-20T09:00:00.000Z',
      scheduledEndUtc: '2026-07-20T10:00:00.000Z',
      timezone: 'America/Chicago',
      references: [],
    },
    { meetingDir: 'Clients/Alpha/Meetings/meeting-a' }
  );
  return service.openTarget(meeting.id);
}

async function mintDirectTarget(): Promise<DirectClientMeetingTarget> {
  const adapter = createDirectClientMeetingsAdapter({
    client: clientA,
    getActiveClientBoundary: () => clientA,
    matterFolder: clientFolder,
    scan: () =>
      Promise.resolve({
        meetings: [{ dir: meetingDir, folderName: 'meeting-a' }],
        scanFailed: false,
      }),
  });
  const result = await adapter.list();
  const target = adapter.resolveTarget(result, {
    dir: meetingDir,
    folderName: 'meeting-a',
  });
  if (!target) throw new Error('expected direct target');
  return target;
}

afterEach(() => {
  unregisterHeaderProbe?.();
  unregisterHeaderProbe = null;
  setActiveWorkspaceService(null);
  useMatterStore.setState({ matters: [] });
});

describe('F11 meeting detail mount identity chokepoint', () => {
  it('makes matter/folder-only construction and MeetingEntry mounts fail typechecking', () => {
    const compileNegativeShapes = () => {
      // @ts-expect-error the constructor requires an F8-minted target too.
      void meetingEntryHostIdentity({ activeClientBoundary: clientA });
      void createElement(MeetingEntry, {
        // @ts-expect-error matter/folder-only JSX-era props cannot mount detail.
        matterId: clientA.matterId,
        meetingDir,
        clientName: 'Alpha Household',
        workspaceRoot: '/workspace',
        workspaceService: null,
        onBack: () => undefined,
      });
    };
    expect(compileNegativeShapes).toBeTypeOf('function');
  });

  it('accepts a genuine canonical resolver target for the exact pair', async () => {
    seedTrustedAuthority();
    const target = await mintCanonicalTarget();
    let received: MeetingEntryHostIdentity | null = null;
    captureHeaderIdentity((identity) => {
      received = identity;
    });

    render(
      createElement(MeetingEntry, {
        activeClientBoundary: clientA,
        target,
        clientName: 'Alpha Household',
        workspaceRoot: '/workspace',
        workspaceService: null,
        onBack: () => undefined,
      })
    );

    expect(screen.getByTestId('host-identity-probe')).toBeInTheDocument();
    expect(received).toMatchObject({
      matterId: clientA.matterId,
      meetingDir,
      canonicalMeeting: { householdRef: clientA.householdRef },
      clientBoundary: clientA,
    });
  });

  it('accepts a genuine F8 direct-adapter target for the exact pair', async () => {
    seedTrustedAuthority();
    const target = await mintDirectTarget();
    let received: MeetingEntryHostIdentity | null = null;
    captureHeaderIdentity((identity) => {
      received = identity;
    });

    render(
      createElement(MeetingEntry, {
        activeClientBoundary: clientA,
        target,
        clientName: 'Alpha Household',
        workspaceRoot: '/workspace',
        workspaceService: null,
        onBack: () => undefined,
      })
    );

    expect(screen.getByTestId('host-identity-probe')).toBeInTheDocument();
    expect(received).toMatchObject({
      matterId: clientA.matterId,
      meetingDir,
      folderName: 'meeting-a',
      canonicalMeeting: null,
      clientBoundary: clientA,
    });
  });

  it('returns no identity for an absent or forged runtime target', () => {
    const absentInput = meetingEntryHostIdentity(
      undefined as unknown as Parameters<typeof meetingEntryHostIdentity>[0]
    );
    const absent = meetingEntryHostIdentity({
      activeClientBoundary: clientA,
      target: undefined as unknown as MeetingEntryTarget,
    });
    const forged = meetingEntryHostIdentity({
      activeClientBoundary: clientA,
      target: {
        kind: 'direct-client-meeting',
        client: clientA,
        meetingDir,
        folderName: 'meeting-a',
      } as unknown as MeetingEntryTarget,
    });
    expect(absentInput).toBeNull();
    expect(absent).toBeNull();
    expect(forged).toBeNull();
  });

  it('refuses forged, malformed, and absent active pairs even with a genuine target', async () => {
    seedTrustedAuthority();
    const target = await mintDirectTarget();
    const forgedA = {
      householdRef: clientA.householdRef,
      matterId: clientA.matterId,
    } as SealedMeetingClientBoundary;
    const malformed = {
      householdRef: {},
      matterId: clientA.matterId,
    } as unknown as SealedMeetingClientBoundary;

    for (const activeClientBoundary of [forgedA, malformed, undefined]) {
      expect(() =>
        meetingEntryHostIdentity({
          activeClientBoundary:
            activeClientBoundary as SealedMeetingClientBoundary,
          target,
        })
      ).not.toThrow();
      expect(
        meetingEntryHostIdentity({
          activeClientBoundary:
            activeClientBoundary as SealedMeetingClientBoundary,
          target,
        })
      ).toBeNull();
    }
  });

  it('mounts no detail host when the runtime target is absent', () => {
    render(
      createElement(MeetingEntry, {
        activeClientBoundary: clientA,
        target: undefined as unknown as MeetingEntryTarget,
        clientName: 'Alpha Household',
        workspaceRoot: '/workspace',
        workspaceService: null,
        onBack: () => undefined,
      })
    );

    expect(screen.queryByTestId('meeting-entry')).toBeNull();
    expect(screen.queryByTestId('meeting-entry-audio-handoff')).toBeNull();
    expect(screen.queryByTestId('meeting-subtab-summary')).toBeNull();
  });

  it('mounts no detail host when the runtime target is forged', () => {
    render(
      createElement(MeetingEntry, {
        activeClientBoundary: clientA,
        target: {
          kind: 'direct-client-meeting',
          client: clientA,
          meetingDir,
          folderName: 'meeting-a',
        } as unknown as MeetingEntryTarget,
        clientName: 'Alpha Household',
        workspaceRoot: '/workspace',
        workspaceService: null,
        onBack: () => undefined,
      })
    );

    expect(screen.queryByTestId('meeting-entry')).toBeNull();
    expect(screen.queryByTestId('meeting-entry-audio-handoff')).toBeNull();
    expect(screen.queryByTestId('meeting-subtab-summary')).toBeNull();
  });

  it('returns no identity after a same-matter, different-household switch', async () => {
    seedTrustedAuthority();
    const directTarget = await mintDirectTarget();
    const canonicalTarget = await mintCanonicalTarget();
    expect(
      meetingEntryHostIdentity({
        activeClientBoundary: clientB,
        target: directTarget,
      })
    ).toBeNull();
    expect(
      meetingEntryHostIdentity({
        activeClientBoundary: clientB,
        target: canonicalTarget,
      })
    ).toBeNull();
  });
});

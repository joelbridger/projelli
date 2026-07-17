import { afterEach, describe, expect, it } from 'vitest';
import type { Matter } from '@/platform/types/matter';
import { useMatterStore } from '@/platform/matter/matterStore';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  createMeetingPopulationService,
  type MeetingOpenTarget,
} from './foundation/contract';
import { resolveMeetingEntryHostIdentity } from './meetingEntryHostIdentity';

// A real host-context probe: the MeetingEntry host binds identity through
// resolveMeetingEntryHostIdentity. This proves that ONLY a target the trusted
// resolver minted can move the host off its legacy folder props, and that a
// forged/legacy-conflicting object cannot redirect the host to another client.

function canonicalPort(initial: readonly LiveCrmRecord[] = []) {
  let canonical = structuredClone(initial) as LiveCrmRecord[];
  return {
    records: structuredClone(canonical),
    workspaceRoot: '/workspace',
    error: null as string | null,
    getActiveMatterId: () => 'matter-1' as string | null,
    save(record: LiveCrmRecord) {
      const saved = structuredClone(record);
      canonical = canonical.some((item) => item.id === saved.id)
        ? canonical.map((item) => (item.id === saved.id ? saved : item))
        : [...canonical, saved];
      return Promise.resolve(structuredClone(saved));
    },
    reloadRecords() {
      return Promise.resolve(structuredClone(canonical));
    },
    readCanonical: () => structuredClone(canonical),
  };
}

function seedTrustedAuthority(): void {
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
}

const draft = {
  workspaceId: 'workspace-1',
  householdRef: 'household-1',
  matterId: 'matter-1',
  typeId: 'review',
  ownerRef: 'member-1',
  scheduledStartUtc: '2026-07-20T09:00:00.000Z',
  scheduledEndUtc: '2026-07-20T10:00:00.000Z',
  timezone: 'America/Chicago',
  references: [],
};

afterEach(() => {
  setActiveWorkspaceService(null);
  useMatterStore.setState({ matters: [] });
});

describe('MeetingEntry host identity binding', () => {
  it('a genuine sealed target owns identity over conflicting legacy props', async () => {
    seedTrustedAuthority();
    const service = createMeetingPopulationService(canonicalPort());
    const linked = await service.createAndLink(draft, {
      meetingDir: 'Clients/Household One/Meetings/2026-07-20',
    });
    const target = await service.openTarget(linked.id);

    // The host is handed DELIBERATELY conflicting legacy props (a different
    // matter and folder). The trusted canonical target must win.
    const identity = resolveMeetingEntryHostIdentity(
      target,
      'matter-legacy-attacker',
      'Clients/Someone Else/legacy'
    );
    expect(identity.matterId).toBe('matter-1');
    expect(identity.meetingDir).toBe(
      '/workspace/Clients/Household One/Meetings/2026-07-20'
    );
    expect(identity.canonicalMeeting?.id).toBe(linked.id);
    expect(identity.clientBoundary).toMatchObject({
      householdRef: 'household-1',
      matterId: 'matter-1',
    });
  });

  it('a forged (unsealed) target confers NO identity — host keeps legacy props', async () => {
    seedTrustedAuthority();
    const service = createMeetingPopulationService(canonicalPort());
    const linked = await service.createAndLink(draft, {
      meetingDir: 'Clients/Household One/Meetings/2026-07-20',
    });
    const genuine = await service.openTarget(linked.id);

    // A consumer hand-builds a target pointing at a victim client. It is not in
    // the trusted seal, so the host ignores it and stays on its legacy props.
    const forged = {
      kind: 'linked-legacy-meeting',
      meeting: { ...genuine.meeting, matterId: 'matter-victim' },
      client: { householdRef: 'household-victim', matterId: 'matter-victim' },
      legacyLink: genuine.legacyLink,
      meetingDir: '/workspace/Clients/Victim/Meetings/secret',
    } as unknown as MeetingOpenTarget;

    const identity = resolveMeetingEntryHostIdentity(
      forged,
      'matter-legacy',
      'Clients/Legacy/folder'
    );
    expect(identity.matterId).toBe('matter-legacy');
    expect(identity.meetingDir).toBe('Clients/Legacy/folder');
    expect(identity.canonicalMeeting).toBeNull();
    expect(identity.clientBoundary).toBeNull();
  });

  it('no target at all leaves the host on its legacy props', () => {
    const identity = resolveMeetingEntryHostIdentity(
      undefined,
      'matter-legacy',
      'Clients/Legacy/folder'
    );
    expect(identity.matterId).toBe('matter-legacy');
    expect(identity.meetingDir).toBe('Clients/Legacy/folder');
    expect(identity.canonicalMeeting).toBeNull();
  });
});

import '@/i18n';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import { setMeetingMaterialViewerResolver } from '@/platform/fs/meetingMaterialViewer';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  issueSharedClientSelection,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';

const nativeRecords = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke:
    vi.fn<
      (command: string, args?: Record<string, unknown>) => Promise<unknown>
    >(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: Record<string, unknown>) =>
    nativeRecords.invoke(command, args),
}));

import {
  createMeetingStore,
  readActiveMeetingClientBoundary,
  resolveMeetingOpenTarget,
} from '../foundation/contract';
import { MeetingsDetailHost } from './MeetingsWorkspace';

const MEETING_DIR = 'Clients/Household One/Meetings/2026-07-20';
const CLIENT = {
  provider: 'wealthbox' as const,
  householdId: 'household-1',
  displayName: 'Household One',
};
let records: LiveCrmRecord[] = [];

class DetailHostBackend implements FSBackend {
  private rootPath = '/workspace';

  read(path: string): Promise<string> {
    if (path.endsWith('transcript.json')) {
      return Promise.resolve(
        JSON.stringify({
          segments: [],
          meta: {
            startedAt: '2026-07-20T09:00:00.000Z',
            durationMs: 3_600_000,
            matterId: 'matter-1',
            consent: {
              mode: 'one-party',
              confirmedBy: 'advisor',
              confirmedAt: '2026-07-20T08:59:00.000Z',
            },
          },
        })
      );
    }
    return Promise.resolve(
      JSON.stringify({
        matterId: 'matter-1',
        startedAt: '2026-07-20T09:00:00.000Z',
        durationMs: 3_600_000,
        typeId: 'annual-review',
        reviewedAt: '2026-07-20T11:00:00.000Z',
        consent: {
          mode: 'one-party',
          confirmedBy: 'advisor',
          confirmedAt: '2026-07-20T08:59:00.000Z',
        },
        // CONTAINMENT (WB-085): file-backed meeting material carries the same
        // owner + visibility policy as the pool record for this meeting
        // (`ownerRef: 'advisor-1'` below), so the two mechanisms agree. Without
        // the stamp this material fails closed and no detail renders.
        ownerRef: 'advisor-1',
        visibilityPolicyId: 'owner-private',
      })
    );
  }

  readBinary(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }

  write(): Promise<void> {
    return Promise.resolve();
  }

  writeBinary(): Promise<void> {
    return Promise.resolve();
  }

  exists(path: string): Promise<boolean> {
    return Promise.resolve(
      !path.endsWith('notes.docx') && !path.endsWith('audio.wav')
    );
  }

  delete(): Promise<void> {
    return Promise.resolve();
  }

  move(): Promise<void> {
    return Promise.resolve();
  }

  copy(): Promise<void> {
    return Promise.resolve();
  }

  rename(): Promise<void> {
    return Promise.resolve();
  }

  mkdir(): Promise<void> {
    return Promise.resolve();
  }

  list(): Promise<[]> {
    return Promise.resolve([]);
  }

  stat(path: string): Promise<FileStat> {
    return Promise.resolve({
      path,
      name: path.split('/').at(-1) ?? 'workspace',
      type: 'folder',
      size: 0,
      modifiedAt: new Date('2026-07-20T00:00:00.000Z'),
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
      isSymlink: false,
    });
  }

  isSymlink(): Promise<boolean> {
    return Promise.resolve(false);
  }

  resolveSymlink(path: string): Promise<string> {
    return Promise.resolve(path);
  }

  getRootPath(): string {
    return this.rootPath;
  }

  setRootPath(path: string): Promise<void> {
    this.rootPath = path;
    return Promise.resolve();
  }
}

function DetailHarness({
  target,
  service,
}: {
  target: Awaited<ReturnType<typeof resolveMeetingOpenTarget>>;
  service: WorkspaceService;
}) {
  return (
    <MeetingsDetailHost
      target={target}
      runtime={{
        workspace: {
          rootPath: '/workspace',
          serviceRef: { current: service },
        },
      }}
      onBack={vi.fn()}
    />
  );
}

describe('Meetings sealed detail host', () => {
  let service: WorkspaceService;

  beforeEach(async () => {
    localStorage.clear();
    nativeRecords.invoke.mockReset();
    nativeRecords.invoke.mockImplementation((command) => {
      if (command === 'crm_set_workspace') return Promise.resolve(null);
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(nativeRecords.records));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
    useWorkspaceStore.setState({ rootPath: '/workspace' });
    // CONTAINMENT (WB-085): the file gate needs a resolved viewer. This is the
    // advisor who owns the fixture material, so the reads below are the OWNER
    // path; the refusal path is proved in meetingMaterialVisibility.wb085.test.
    setMeetingMaterialViewerResolver(() => 'advisor-1');
    setDevFlagOverride('selection-authority-boot-gate', false);
    replaceCanonicalHouseholdDirectory('wealthbox', null);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', true);
    service = new WorkspaceService();
    await service.initialize(new DetailHostBackend(), '/workspace');
    setActiveWorkspaceService(service);
    useMatterStore.setState({
      matters: [
        {
          id: 'matter-1',
          name: 'Household One',
          client: 'Household One',
          folderPaths: ['/workspace/Clients/Household One'],
          crmHouseholdKeys: ['household-1'],
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      activeMatterId: 'matter-1',
    });
    replaceCanonicalHouseholdDirectory('wealthbox', [CLIENT]);
    await expect(
      requestSharedClientSelection(issueSharedClientSelection(CLIENT))
    ).resolves.toMatchObject({ kind: 'selected' });
    records = [
      {
        id: 'meeting-a',
        kind: 'meeting',
        matterId: 'matter-1',
        workspaceId: 'workspace-1',
        householdRef: 'household-1',
        typeId: 'annual-review',
        ownerRef: 'advisor-1',
        scheduledStartUtc: '2026-07-20T09:00:00.000Z',
        scheduledEndUtc: '2026-07-20T10:00:00.000Z',
        timezone: 'UTC',
        state: 'completed',
        references: [],
        legacyMeetingLink: {
          meetingDir: MEETING_DIR,
          linkedAt: '2026-07-18T00:00:00.000Z',
        },
        createdAt: '2026-07-18T00:00:00.000Z',
        updatedAt: '2026-07-18T00:00:00.000Z',
      },
    ];
    nativeRecords.records = records;
  });

  afterEach(() => {
    cleanup();
    setActiveWorkspaceService(null);
    setMeetingMaterialViewerResolver(null);
    setDevFlagOverride('selection-authority-boot-gate', false);
    useMatterStore.setState({ matters: [], activeMatterId: null });
    replaceCanonicalHouseholdDirectory('wealthbox', null);
    requestClearClientSelection();
    useWorkspaceStore.setState({ rootPath: null });
    setDevFlagOverride('selection-authority-boot-gate', undefined);
    localStorage.clear();
  });

  it('renders the real detail panels from a genuine sealed client target', async () => {
    const port = {
      records,
      workspaceRoot: '/workspace',
      error: null,
      getActiveClientBoundary: readActiveMeetingClientBoundary,
      getSelectionError: () => null,
      save: (record: LiveCrmRecord) => Promise.resolve(record),
      reloadRecords: () => Promise.resolve(records),
    };
    const target = await resolveMeetingOpenTarget(
      createMeetingStore(port),
      'meeting-a',
      readActiveMeetingClientBoundary
    );

    render(<DetailHarness target={target} service={service} />);

    expect(await screen.findByTestId('meetings-linked-detail')).toBeTruthy();

    expect(await screen.findByTestId('meeting-summary-tab')).toBeTruthy();
    for (const tab of ['summary', 'transcript']) {
      expect(screen.getByTestId(`meeting-subtab-${tab}`)).toBeTruthy();
    }
  });

  it('mounts no detail after live client authority disappears', async () => {
    const port = {
      records,
      workspaceRoot: '/workspace',
      error: null,
      getActiveClientBoundary: readActiveMeetingClientBoundary,
      getSelectionError: () => null,
      save: (record: LiveCrmRecord) => Promise.resolve(record),
      reloadRecords: () => Promise.resolve(records),
    };
    const target = await resolveMeetingOpenTarget(
      createMeetingStore(port),
      'meeting-a',
      readActiveMeetingClientBoundary
    );
    useMatterStore.setState({ matters: [], activeMatterId: null });

    render(<DetailHarness target={target} service={service} />);

    expect(screen.queryByTestId('meetings-linked-detail')).toBeNull();
  });
});

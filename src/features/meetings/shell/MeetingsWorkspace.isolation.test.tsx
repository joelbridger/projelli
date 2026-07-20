import '@/i18n';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import { setMeetingMaterialViewerResolver } from '@/platform/fs/meetingMaterialViewer';
import { useMatterStore } from '@/platform/matter/matterStore';

const nativeRecords = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  commands: [] as string[],
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
import {
  issueSharedClientSelection,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';
import { isEnabled } from '@/platform/flags';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { meetingsSurface } from './appSurface';
import { resolveMeetingsSurfaceNavigation } from './navigation';

const MEETING_A_DIR = 'Clients/Client A/Meetings/2026-07-20';
const CLIENT_A = {
  provider: 'wealthbox' as const,
  householdId: 'household-a',
  displayName: 'Client A',
};
const CLIENT_B = {
  provider: 'wealthbox' as const,
  householdId: 'household-b',
  displayName: 'Client B',
};

async function selectClient(client: typeof CLIENT_A | typeof CLIENT_B) {
  return requestSharedClientSelection(issueSharedClientSelection(client));
}

class IsolationBackend implements FSBackend {
  private rootPath = '/workspace';

  read(path: string): Promise<string> {
    if (path.endsWith('transcript.json')) {
      return Promise.resolve(
        JSON.stringify({
          segments: [],
          meta: {
            startedAt: '2026-07-20T09:00:00.000Z',
            durationMs: 3_600_000,
            matterId: 'matter-a',
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
        matterId: 'matter-a',
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
        // owner + visibility policy as the pool record for this meeting, so the
        // file and record mechanisms agree. Unstamped material fails closed.
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

function meeting(
  id: string,
  matterId: string,
  householdRef: string,
  legacyMeetingLink?: { meetingDir: string; linkedAt: string }
): LiveCrmRecord {
  return {
    id,
    kind: 'meeting',
    matterId,
    workspaceId: 'workspace-1',
    householdRef,
    typeId: 'annual-review',
    ownerRef: 'advisor-1',
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'UTC',
    state: 'completed',
    references: [],
    ...(legacyMeetingLink ? { legacyMeetingLink } : {}),
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
  };
}

function taskReviewArtifact(
  id: string,
  meetingId: string,
  matterId: string,
  householdRef: string
): LiveCrmRecord {
  return {
    id,
    kind: 'meeting_artifact',
    matterId,
    householdRef,
    createdAt: '2026-07-18T10:00:00.000Z',
    updatedAt: '2026-07-18T10:00:00.000Z',
    meetingId,
    artifactKind: 'action-update-proposal',
    schemaVersion: 2,
    producedAt: '2026-07-18T10:00:00.000Z',
    artifactState: 'produced',
    sourceRefs: [],
    provenance: 'local-processing',
    payload: {
      proposal: {
        id: `${id}-proposal`,
        kind: 'task',
        title: 'Review beneficiary follow-up',
        detail: 'Confirm the follow-up task from this meeting.',
        ownerRef: null,
        dueDate: null,
        transcriptRef: `transcript:${meetingId}`,
      },
    },
  };
}

describe('Meetings cross-client isolation in the mounted shell', () => {
  let service: WorkspaceService;
  const runtime = {
    navigation: {
      setSurface: vi.fn(),
      pushSnapshot: vi.fn(),
    },
    workspace: {
      rootPath: '/workspace',
      activeMatter: null,
      apiKeys: [],
      serviceRef: { current: null as WorkspaceService | null },
      setFileTree: vi.fn(),
      refreshFileTree: vi.fn(),
      requestApiKeySetup: vi.fn(),
    },
  };

  beforeEach(async () => {
    localStorage.clear();
    nativeRecords.commands = [];
    nativeRecords.invoke.mockReset();
    nativeRecords.invoke.mockImplementation((command) => {
      nativeRecords.commands.push(command);
      if (command === 'crm_set_workspace') return Promise.resolve(null);
      if (command === 'crm_live_list') {
        return Promise.resolve(structuredClone(nativeRecords.records));
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
    setDevFlagOverride('selection-authority-boot-gate', false);
    replaceCanonicalHouseholdDirectory('wealthbox', null);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', true);
    setDevFlagOverride('calendar-grid', true);
    setDevFlagOverride('meetings-shell-v1', true);
    useFirmStore.setState({
      session: {
        userId: 'advisor-1',
        email: 'advisor@example.com',
        role: 'member',
        org: null,
        seatId: 'seat-1',
        tier: 'practice',
        packs: [],
        seats: 1,
        lastValidatedAt: null,
        activated: true,
      },
    });
    useWorkspaceStore.setState({ rootPath: '/workspace' });
    service = new WorkspaceService();
    await service.initialize(new IsolationBackend(), '/workspace');
    setActiveWorkspaceService(service);
    // CONTAINMENT (WB-085): resolve the viewer to the owner of the fixture
    // material; the refusal path is proved in meetingMaterialVisibility.wb085.
    setMeetingMaterialViewerResolver(() => 'advisor-1');
    runtime.workspace.serviceRef.current = service;
    runtime.navigation.setSurface.mockReset();
    runtime.navigation.pushSnapshot.mockReset();
    useMatterStore.setState({
      matters: [
        {
          id: 'matter-a',
          name: 'Client A',
          client: 'Client A',
          folderPaths: ['/workspace/Clients/Client A'],
          crmHouseholdKeys: ['household-a'],
          createdAt: '2026-07-01T00:00:00.000Z',
        },
        {
          id: 'matter-b',
          name: 'Client B',
          client: 'Client B',
          folderPaths: ['/workspace/Clients/Client B'],
          crmHouseholdKeys: ['household-b'],
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      activeMatterId: 'matter-b',
    });
    replaceCanonicalHouseholdDirectory('wealthbox', [CLIENT_A, CLIENT_B]);
    await expect(selectClient(CLIENT_B)).resolves.toMatchObject({
      kind: 'selected',
    });
    nativeRecords.records = [
      meeting('meeting-a', 'matter-a', 'household-a', {
        meetingDir: MEETING_A_DIR,
        linkedAt: '2026-07-18T00:00:00.000Z',
      }),
      meeting('meeting-b', 'matter-b', 'household-b', {
        meetingDir: 'Clients/Client B/Meetings/2026-07-20',
        linkedAt: '2026-07-18T00:00:00.000Z',
      }),
      meeting('meeting-folder-only', 'matter-b', 'household-b'),
      taskReviewArtifact('artifact-a', 'meeting-a', 'matter-a', 'household-a'),
      taskReviewArtifact('artifact-b', 'meeting-b', 'matter-b', 'household-b'),
    ];
  });

  afterEach(() => {
    cleanup();
    setActiveWorkspaceService(null);
    setMeetingMaterialViewerResolver(null);
    setDevFlagOverride('selection-authority-boot-gate', false);
    useMatterStore.setState({ matters: [], activeMatterId: null });
    replaceCanonicalHouseholdDirectory('wealthbox', null);
    requestClearClientSelection();
    useFirmStore.setState({ session: null });
    useWorkspaceStore.setState({ rootPath: null });
    setDevFlagOverride('calendar-grid', undefined);
    setDevFlagOverride('meetings-shell-v1', undefined);
    setDevFlagOverride('selection-authority-boot-gate', undefined);
    localStorage.clear();
  });

  it('selects A before opening, then removes every A detail and row under B and blocked-none', async () => {
    const port = {
      records: nativeRecords.records,
      workspaceRoot: '/workspace',
      error: null,
      getActiveClientBoundary: readActiveMeetingClientBoundary,
      getSelectionError: () => null,
      save: (record: LiveCrmRecord) => Promise.resolve(record),
      reloadRecords: () => Promise.resolve(nativeRecords.records),
    };
    await expect(
      resolveMeetingOpenTarget(
        createMeetingStore(port),
        'meeting-a',
        readActiveMeetingClientBoundary
      )
    ).rejects.toThrow('unavailable to the active client');

    expect(meetingsSurface.availabilityFlag).toBe('meetings-shell-v1');
    expect(isEnabled('meetings-shell-v1')).toBe(true);
    render(meetingsSurface.render(runtime));

    expect(await screen.findByTestId('meetings-row-meeting-b')).toBeTruthy();
    expect(screen.getByTestId('meetings-owner-mine')).not.toBeDisabled();
    expect(screen.queryByTestId('meetings-row-meeting-a')).toBeNull();
    expect(
      screen.queryByTestId('meetings-open-meeting-folder-only')
    ).toBeNull();
    expect(screen.getByText('Not linked to a client')).toBeTruthy();
    fireEvent.click(screen.getByTestId('meetings-view-past'));
    expect(await screen.findByTestId('meetings-past-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('meetings-view-actions'));
    expect(
      await screen.findByTestId('meetings-action-artifact-b')
    ).toBeTruthy();
    expect(screen.queryByTestId('meetings-action-artifact-a')).toBeNull();
    expect(screen.getByTestId('meetings-actions-badge')).toHaveTextContent('1');
    expect(screen.getByTestId('meetings-actions-view-filter')).toHaveValue(
      'need-attention'
    );
    fireEvent.click(screen.getByTestId('meetings-view-templates'));
    expect(await screen.findByTestId('meeting-template-panel')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('meeting-template-create'));
    expect(screen.getByTestId('meeting-template-editor')).toBeTruthy();
    fireEvent.click(screen.getByTestId('meeting-template-cancel'));
    fireEvent.click(screen.getByTestId('meetings-view-upcoming'));
    fireEvent.click(screen.getByTestId('meetings-owner-all'));

    await act(async () => {
      await resolveMeetingsSurfaceNavigation('meeting-a', runtime);
    });

    expect(await screen.findByTestId('meetings-linked-detail')).toBeTruthy();

    fireEvent.click(screen.getByTestId('meeting-entry-back'));
    expect(await screen.findByTestId('meetings-shell-v2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('meetings-view-templates'));
    expect(await screen.findByTestId('meeting-template-panel')).toBeTruthy();
    fireEvent.click(await screen.findByTestId('meeting-template-create'));
    expect(screen.getByTestId('meeting-template-editor')).toBeTruthy();
    fireEvent.click(screen.getByTestId('meeting-template-cancel'));
    fireEvent.click(screen.getByTestId('meetings-view-upcoming'));

    await act(async () => {
      await resolveMeetingsSurfaceNavigation('meeting-a', runtime);
    });
    expect(await screen.findByTestId('meetings-linked-detail')).toBeTruthy();

    await act(async () => {
      await selectClient(CLIENT_B);
    });
    await waitFor(() => {
      expect(screen.queryByTestId('meetings-linked-detail')).toBeNull();
      expect(screen.queryByTestId('meetings-row-meeting-a')).toBeNull();
      expect(screen.getByTestId('meetings-row-meeting-b')).toBeTruthy();
    });

    act(() => {
      useMatterStore.setState({ matters: [], activeMatterId: null });
    });
    await waitFor(() => {
      expect(screen.getByTestId('meetings-selection-blocked')).toBeTruthy();
      expect(screen.queryByTestId('meetings-linked-detail')).toBeNull();
      expect(screen.queryByTestId('meetings-row-meeting-a')).toBeNull();
      expect(screen.queryByTestId('meetings-row-meeting-b')).toBeNull();
    });
    expect(nativeRecords.commands).toContain('crm_live_list');
  });
});

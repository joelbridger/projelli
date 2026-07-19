import '@/i18n';
import { useSyncExternalStore } from 'react';
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
import { useMatterStore } from '@/platform/matter/matterStore';

type Presentation = {
  scope: { kind: 'matter'; matterId: string } | { kind: 'blocked-unresolved' };
  sourceScope: { kind: 'matter'; matterId: string } | { kind: 'blocked-unresolved' };
  followerStatus: 'converged';
  matterId: string | null;
  blocked: boolean;
  allMatters: false;
  stale: false;
  authorityEnabled: true;
};

const seam = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const matterPresentation = (matterId: string): Presentation => ({
    scope: { kind: 'matter', matterId },
    sourceScope: { kind: 'matter', matterId },
    followerStatus: 'converged',
    matterId,
    blocked: false,
    allMatters: false,
    stale: false,
    authorityEnabled: true,
  });
  return {
    records: [] as LiveCrmRecord[],
    resolve: vi.fn(),
    client: {
      householdId: 'household-b',
      displayName: 'Client B',
    } as { householdId: string; displayName: string } | null,
    presentation: matterPresentation('matter-b'),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMatter(matterId: string, householdId: string, displayName: string) {
      this.client = { householdId, displayName };
      this.presentation = matterPresentation(matterId);
      listeners.forEach((listener) => { listener(); });
    },
    setBlocked() {
      this.client = null;
      this.presentation = {
        scope: { kind: 'blocked-unresolved' },
        sourceScope: { kind: 'blocked-unresolved' },
        followerStatus: 'converged',
        matterId: null,
        blocked: true,
        allMatters: false,
        stale: false,
        authorityEnabled: true,
      };
      listeners.forEach((listener) => { listener(); });
    },
  };
});

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({
    records: seam.records,
    workspaceRoot: '/workspace',
    error: null,
    save: vi.fn(),
    reload: vi.fn(() => Promise.resolve()),
    reloadRecords: vi.fn(() => Promise.resolve(seam.records)),
    sharedMatterId: null,
    sharedLocalMatterId: null,
    freshness: { kind: 'idle' },
    publishSavedRecord: vi.fn(),
  }),
}));

vi.mock('@/platform/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/flags')>()),
  useFlag: (id: string) => id === 'calendar-grid',
}));

vi.mock('@/platform/client-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/client-context')>()),
  useSelectionPresentation: () =>
    useSyncExternalStore(
      (listener) => seam.subscribe(listener),
      () => seam.presentation
    ),
  useClientContextStore: <T,>(
    selector: (state: { client: typeof seam.client }) => T
  ) =>
    useSyncExternalStore(
      (listener) => seam.subscribe(listener),
      () => selector({ client: seam.client })
    ),
  useSelectionOperationDecision: () =>
    seam.presentation.blocked
      ? { kind: 'refused', reason: 'blocked-unresolved', message: 'Blocked.' }
      : {
          kind: 'matter',
          sourceKind: 'matter',
          matter: { id: seam.presentation.matterId },
          client: seam.client,
        },
  readSelectionOperationDecision: () =>
    seam.presentation.blocked
      ? { kind: 'refused', reason: 'blocked-unresolved', message: 'Blocked.' }
      : {
          kind: 'matter',
          sourceKind: 'matter',
          matter: { id: seam.presentation.matterId },
          client: seam.client,
        },
  requestSharedClientSelection: () => {
    seam.setMatter('matter-a', 'household-a', 'Client A');
    return Promise.resolve({ kind: 'selected', client: seam.client });
  },
}));

vi.mock('../foundation/contract', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../foundation/contract')>()),
  resolveMeetingNavigation: seam.resolve,
}));

import { createMeetingStore, resolveMeetingOpenTarget } from '../foundation/contract';
import { MeetingsWorkspace } from './MeetingsWorkspace';
import { resolveMeetingsSurfaceNavigation } from './navigation';

const MEETING_A_DIR = 'Clients/Client A/Meetings/2026-07-20';

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
    service = new WorkspaceService();
    await service.initialize(new IsolationBackend(), '/workspace');
    setActiveWorkspaceService(service);
    runtime.workspace.serviceRef.current = service;
    runtime.navigation.setSurface.mockReset();
    runtime.navigation.pushSnapshot.mockReset();
    seam.resolve.mockReset();
    seam.setMatter('matter-b', 'household-b', 'Client B');
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
    seam.records = [
      meeting('meeting-a', 'matter-a', 'household-a', {
        meetingDir: MEETING_A_DIR,
        linkedAt: '2026-07-18T00:00:00.000Z',
      }),
      meeting('meeting-b', 'matter-b', 'household-b', {
        meetingDir: 'Clients/Client B/Meetings/2026-07-20',
        linkedAt: '2026-07-18T00:00:00.000Z',
      }),
      meeting('meeting-folder-only', 'matter-b', 'household-b'),
      taskReviewArtifact(
        'artifact-a',
        'meeting-a',
        'matter-a',
        'household-a'
      ),
      taskReviewArtifact(
        'artifact-b',
        'meeting-b',
        'matter-b',
        'household-b'
      ),
    ];
  });

  afterEach(() => {
    cleanup();
    setActiveWorkspaceService(null);
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('selects A before opening, then removes every A detail and row under B and blocked-none', async () => {
    const port = {
      records: seam.records,
      workspaceRoot: '/workspace',
      error: null,
      getActiveMatterId: () => seam.presentation.matterId,
      getSelectionError: () =>
        seam.presentation.blocked ? 'Selection is blocked.' : null,
      save: (record: LiveCrmRecord) => Promise.resolve(record),
      reloadRecords: () => Promise.resolve(seam.records),
    };
    await expect(
      resolveMeetingOpenTarget(createMeetingStore(port), 'meeting-a')
    ).rejects.toThrow('unavailable to the active client');

    render(<MeetingsWorkspace runtime={runtime} />);

    expect(await screen.findByTestId('meetings-row-meeting-b')).toBeTruthy();
    expect(screen.queryByTestId('meetings-row-meeting-a')).toBeNull();
    expect(
      screen.queryByTestId('meetings-open-meeting-folder-only')
    ).toBeNull();
    expect(screen.getByText('Not linked to a client')).toBeTruthy();
    fireEvent.click(screen.getByTestId('meetings-view-past'));
    expect(await screen.findByTestId('meetings-past-empty')).toBeTruthy();
    fireEvent.click(screen.getByTestId('meetings-view-actions'));
    expect(await screen.findByTestId('meetings-action-artifact-b')).toBeTruthy();
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

    seam.resolve.mockResolvedValue({
      kind: 'linked',
      clientBoundary: { sealed: true },
    });
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

    act(() => {
      seam.setMatter('matter-b', 'household-b', 'Client B');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('meetings-linked-detail')).toBeNull();
      expect(screen.queryByTestId('meetings-row-meeting-a')).toBeNull();
      expect(screen.getByTestId('meetings-row-meeting-b')).toBeTruthy();
    });

    act(() => {
      seam.setBlocked();
    });
    await waitFor(() => {
      expect(screen.getByTestId('meetings-selection-blocked')).toBeTruthy();
      expect(screen.queryByTestId('meetings-linked-detail')).toBeNull();
      expect(screen.queryByTestId('meetings-row-meeting-a')).toBeNull();
      expect(screen.queryByTestId('meetings-row-meeting-b')).toBeNull();
    });
  });
});

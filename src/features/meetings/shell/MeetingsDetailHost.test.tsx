import '@/i18n';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  OutsideMeetingsShellContributions,
} from '@/foundation-contracts/meetings-shell/meetingsShellV2.import';

const seam = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
}));

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

vi.mock('@/platform/client-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/client-context')>()),
  useSelectionOperationDecision: () => ({
    kind: 'matter',
    sourceKind: 'matter-only',
    matter: { id: 'matter-1' },
    client: null,
  }),
  readSelectionOperationDecision: () => ({
    kind: 'matter',
    sourceKind: 'matter-only',
    matter: { id: 'matter-1' },
    client: null,
  }),
}));

import {
  createMeetingStore,
  resolveMeetingOpenTarget,
} from '../foundation/contract';
import { MeetingsDetailHost } from './MeetingsWorkspace';

const MEETING_DIR = 'Clients/Household One/Meetings/2026-07-20';

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
  const [withContributions, setWithContributions] = useState(true);
  return (
    <>
      <button
        type="button"
        data-testid="detail-contributions-toggle"
        onClick={() => { setWithContributions((current) => !current); }}
      />
      {withContributions ? <OutsideMeetingsShellContributions /> : null}
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
    </>
  );
}

describe('Meetings sealed detail contribution hosts', () => {
  let service: WorkspaceService;

  beforeEach(async () => {
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
    seam.records = [
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
  });

  afterEach(() => {
    cleanup();
    setActiveWorkspaceService(null);
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('renders and removes outside artifact and notice contributions in the real sealed detail host', async () => {
    const port = {
      records: seam.records,
      workspaceRoot: '/workspace',
      error: null,
      getActiveMatterId: () => 'matter-1',
      getSelectionError: () => null,
      save: (record: LiveCrmRecord) => Promise.resolve(record),
      reloadRecords: () => Promise.resolve(seam.records),
    };
    const target = await resolveMeetingOpenTarget(
      createMeetingStore(port),
      'meeting-a'
    );

    render(<DetailHarness target={target} service={service} />);

    expect(await screen.findByTestId('meetings-linked-detail')).toBeTruthy();
    expect(await screen.findByTestId('outside-meeting-artifact-host')).toHaveAttribute(
      'data-meeting-id',
      'meeting-a'
    );
    expect(await screen.findByTestId('outside-meeting-notice-host')).toHaveAttribute(
      'data-meeting-id',
      'meeting-a'
    );

    const tabProof = [
      ['prep', 'meeting-recording-tab'],
      ['agenda', 'meeting-agenda-tab'],
      ['summary', 'meeting-summary-tab'],
      ['transcript', 'meeting-transcript-tab'],
      ['tasks', 'meeting-tasks-tab'],
      ['crm-update', 'meeting-crm-update-tab'],
      ['follow-up', 'meeting-follow-up-tab'],
    ] as const;
    for (const [tab, panel] of tabProof) {
      fireEvent.click(screen.getByTestId(`meeting-subtab-${tab}`));
      expect(screen.getByTestId(panel)).toBeTruthy();
    }
    fireEvent.click(screen.getByTestId('meeting-follow-up-open'));
    expect(await screen.findByTestId('meeting-send-panel')).toBeTruthy();

    fireEvent.click(screen.getByTestId('detail-contributions-toggle'));
    await waitFor(() => {
      expect(screen.queryByTestId('outside-meeting-artifact-host')).toBeNull();
      expect(screen.queryByTestId('outside-meeting-notice-host')).toBeNull();
    });
  });
});

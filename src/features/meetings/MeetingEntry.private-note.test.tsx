import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

const meetingBoundaryMint = vi.hoisted(() => ({
  selection: null as null | { householdRef: string; matterId: string },
}));
const extractStoredNotes = vi.hoisted(() => vi.fn());

vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/client-context')>();
  return {
    ...actual,
    readSelectionOperationDecision: () => {
      const selection = meetingBoundaryMint.selection;
      return selection
        ? {
            kind: 'matter' as const,
            sourceKind: 'matter' as const,
            matter: { id: selection.matterId } as Matter,
            client: {
              provider: 'wealthbox' as const,
              householdId: selection.householdRef,
              displayName: 'Alpha Household',
            },
          }
        : null;
    },
  };
});

vi.mock('@/platform/utils/docx-io', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/docx-io')>();
  return { ...actual, extractDocxText: extractStoredNotes };
});

import {
  createDirectClientMeetingsAdapter,
  readActiveMeetingClientBoundary,
  type SealedMeetingClientBoundary,
} from './foundation/contract';
import { MeetingEntry } from './MeetingEntry';
import {
  createAccountlessUnrestrictedMeetingFileVisibilityManifest,
  FILE_MEETING_OWNER_PRIVATE_POLICY_ID,
} from './meetingFileVisibility';
import { setMeetingsWorkspaceService } from './meetingStore';

const matterId = 'matter-private-note';
const clientFolder = '/workspace/Clients/Alpha';
const meetingDir = `${clientFolder}/Meetings/meeting-private-note`;

function mintedBoundary(): SealedMeetingClientBoundary {
  meetingBoundaryMint.selection = { householdRef: 'household-a', matterId };
  try {
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected client boundary');
    return boundary;
  } finally {
    meetingBoundaryMint.selection = null;
  }
}

const client = mintedBoundary();

function signedIn(userId: string | null): void {
  useFirmStore.setState({
    session: userId
      ? {
          userId,
          email: `${userId}@example.com`,
          role: 'member',
          org: null,
          seatId: null,
          tier: null,
          packs: [],
          seats: 0,
          lastValidatedAt: null,
          activated: false,
        }
      : null,
  });
}

function setup(metaOverride: Record<string, unknown> = {}) {
  const adapter = createDirectClientMeetingsAdapter({
    client,
    getActiveClientBoundary: () => client,
    matterFolder: clientFolder,
    scan: () => Promise.resolve({
      meetings: [{ dir: meetingDir, folderName: 'meeting-private-note' }],
      scanFailed: false,
    }),
  });
  const files = new Map<string, string>();
  const manifest = createAccountlessUnrestrictedMeetingFileVisibilityManifest({
    meetingSubjectId: 'meeting-file:private-note',
    fileNames: ['meeting.json', 'transcript.json', 'notes.docx'],
  });
  files.set(
    `${meetingDir}/meeting.json`,
    JSON.stringify({
      matterId,
      startedAt: '2026-07-23T10:00:00.000Z',
      consent: {
        mode: 'one-party',
        confirmedBy: 'advisor-1',
        confirmedAt: '2026-07-23T09:59:00.000Z',
      },
      meetingFileVisibility: manifest,
      untouchedField: { keep: true },
      ...metaOverride,
    })
  );
  const workspace = {
    readFile: vi.fn((path: string) => {
      const value = files.get(path);
      return value === undefined
        ? Promise.reject(new Error('ENOENT'))
        : Promise.resolve(value);
    }),
    writeFile: vi.fn((path: string, content: string) => {
      files.set(path, content);
      return Promise.resolve();
    }),
    exists: vi.fn((path: string) =>
      Promise.resolve(
        path === `${meetingDir}/meeting.json` || path === `${meetingDir}/notes.docx`
      )
    ),
    readFileBinary: vi.fn(() =>
      Promise.resolve(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    ),
  };
  return { adapter, files, manifest, workspace };
}

async function renderMeeting(
  workspace: ReturnType<typeof setup>['workspace'],
  adapter: ReturnType<typeof setup>['adapter']
) {
  const listed = await adapter.list();
  if (listed.kind !== 'ready') throw new Error('expected listed meeting');
  const target = adapter.resolveTarget(listed, listed.meetings[0]?.meeting);
  if (!target) throw new Error('expected meeting target');
  return render(
    <MeetingEntry
      activeClientBoundary={client}
      target={target}
      clientName="Alpha Household"
      workspaceRoot="/workspace"
      workspaceService={workspace as unknown as WorkspaceService}
      onBack={() => undefined}
    />
  );
}

beforeEach(() => {
  extractStoredNotes.mockResolvedValue({
    plainText: 'Private meeting summary.',
    html: '<p>Private meeting summary.</p>',
  });
  useMatterStore.setState({
    matters: [{
      id: matterId,
      name: 'Alpha matter',
      client: 'Alpha Household',
      folderPaths: [clientFolder],
      crmHouseholdKeys: ['household-a'],
      createdAt: '2026-07-23T00:00:00.000Z',
    } as Matter],
  });
  useWorkspaceStore.setState({ rootPath: '/workspace', rootGeneration: 1 });
  signedIn('advisor-1');
});

afterEach(() => {
  setMeetingsWorkspaceService(null);
  signedIn(null);
  useMatterStore.setState({ matters: [] });
  extractStoredNotes.mockReset();
});

describe('MeetingEntry private note route', () => {
  it('changes only notes.docx, preserves the map and fields, and survives an owner reopen', async () => {
    const { adapter, files, manifest, workspace } = setup();
    setMeetingsWorkspaceService(workspace as never);
    const first = await renderMeeting(workspace, adapter);

    expect(await screen.findByTestId('meeting-private-note-action')).toBeEnabled();
    fireEvent.click(screen.getByTestId('meeting-private-note-action'));

    await screen.findByTestId('meeting-private-note-saved');
    const persisted = JSON.parse(files.get(`${meetingDir}/meeting.json`) ?? '{}') as {
      untouchedField?: unknown;
      meetingFileVisibility: {
        meetingSubject: unknown;
        files: Record<string, unknown>;
      };
    };
    expect(persisted.untouchedField).toEqual({ keep: true });
    expect(persisted.meetingFileVisibility.meetingSubject).toEqual(
      manifest.meetingSubject
    );
    expect(persisted.meetingFileVisibility.files['meeting.json']).toEqual(
      manifest.files['meeting.json']
    );
    expect(persisted.meetingFileVisibility.files['transcript.json']).toEqual(
      manifest.files['transcript.json']
    );
    expect(persisted.meetingFileVisibility.files['notes.docx']).toMatchObject({
      id: manifest.files['notes.docx']?.id,
      kind: 'meeting-note',
      lineage: 'root',
      ownerRef: 'advisor-1',
      visibilityPolicyId: FILE_MEETING_OWNER_PRIVATE_POLICY_ID,
    });

    first.unmount();
    await renderMeeting(workspace, adapter);
    expect(await screen.findByTestId('meeting-summary-text')).toHaveTextContent(
      'Private meeting summary.'
    );
    expect(screen.getByTestId('meeting-private-note-saved')).toBeInTheDocument();
  });

  it('does not expose or mutate a private note for another or missing viewer', async () => {
    const { adapter, files, workspace } = setup({
      meetingFileVisibility: {
        version: 1,
        meetingSubject: {
          id: 'meeting-file:private-note',
          kind: 'meeting-note',
          lineage: 'accountless-unrestricted',
        },
        files: {
          'meeting.json': {
            id: 'meeting-file:private-note:file:meeting.json',
            kind: 'file-reference',
            lineage: 'accountless-unrestricted',
          },
          'notes.docx': {
            id: 'meeting-file:private-note:file:notes.docx',
            kind: 'meeting-note',
            lineage: 'root',
            ownerRef: 'advisor-1',
            visibilityPolicyId: FILE_MEETING_OWNER_PRIVATE_POLICY_ID,
          },
        },
      },
    });
    setMeetingsWorkspaceService(workspace as never);
    signedIn('advisor-2');
    await renderMeeting(workspace, adapter);

    await waitFor(() => {
      expect(screen.queryByTestId('meeting-summary-text')).toBeNull();
    });
    expect(screen.queryByTestId('meeting-private-note-action')).toBeNull();
    expect(workspace.readFileBinary).not.toHaveBeenCalled();
    expect(workspace.writeFile).not.toHaveBeenCalled();

    signedIn(null);
    await waitFor(() => {
      expect(screen.queryByTestId('meeting-private-note-action')).toBeNull();
    });
    expect(workspace.writeFile).not.toHaveBeenCalled();
    expect(files.get(`${meetingDir}/meeting.json`)).toContain('advisor-1');
  });

  it('fails closed without a write for stale workspaces, malformed maps, or an incompatible restriction', async () => {
    const stale = setup();
    setMeetingsWorkspaceService(stale.workspace as never);
    const staleRender = await renderMeeting(stale.workspace, stale.adapter);
    expect(await screen.findByTestId('meeting-private-note-action')).toBeEnabled();
    useWorkspaceStore.setState({ rootPath: '/different-workspace', rootGeneration: 2 });
    fireEvent.click(screen.getByTestId('meeting-private-note-action'));
    expect(await screen.findByTestId('meeting-private-note-notice')).toHaveTextContent(
      "couldn't be made private"
    );
    expect(stale.workspace.writeFile).not.toHaveBeenCalled();
    staleRender.unmount();

    useWorkspaceStore.setState({ rootPath: '/workspace', rootGeneration: 1 });
    const malformed = setup({ meetingFileVisibility: { version: 1, files: {} } });
    setMeetingsWorkspaceService(malformed.workspace as never);
    const second = await renderMeeting(malformed.workspace, malformed.adapter);
    await waitFor(() => {
      expect(screen.queryByTestId('meeting-private-note-action')).toBeNull();
    });
    expect(malformed.workspace.writeFile).not.toHaveBeenCalled();
    second.unmount();

    const incompatible = setup({
      meetingFileVisibility: {
        version: 1,
        meetingSubject: {
          id: 'restricted-meeting',
          kind: 'meeting-note',
          lineage: 'root',
          ownerRef: 'advisor-1',
          visibilityPolicyId: FILE_MEETING_OWNER_PRIVATE_POLICY_ID,
        },
        files: {
          'meeting.json': {
            id: 'restricted-meeting:file:meeting.json',
            kind: 'file-reference',
            lineage: 'derived',
            parentRef: { id: 'restricted-meeting', kind: 'meeting-note' },
          },
          'notes.docx': {
            id: 'restricted-meeting:file:notes.docx',
            kind: 'file-reference',
            lineage: 'derived',
            parentRef: { id: 'restricted-meeting', kind: 'meeting-note' },
          },
        },
      },
    });
    setMeetingsWorkspaceService(incompatible.workspace as never);
    await renderMeeting(incompatible.workspace, incompatible.adapter);
    await waitFor(() => {
      expect(screen.queryByTestId('meeting-private-note-action')).toBeNull();
    });
    expect(incompatible.workspace.writeFile).not.toHaveBeenCalled();
  });
});

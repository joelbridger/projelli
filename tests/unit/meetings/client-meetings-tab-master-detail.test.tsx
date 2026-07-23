import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientMeetingsTab } from '@/features/meetings/ClientMeetingsTab';
import {
  readActiveMeetingClientBoundary,
  type SealedMeetingClientBoundary,
} from '@/features/meetings';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import { createLegacyUnrestrictedMeetingFileVisibilityManifest } from '@/features/meetings';

const meetingBoundaryMint = vi.hoisted(() => ({
  selection: null as null | { householdRef: string; matterId: string },
}));
const ensureMeetingNoticeVerifiedMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/meetings/meetingStore', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/meetings/meetingStore')>();
  return {
    ...actual,
    ensureMeetingNoticeVerified: ensureMeetingNoticeVerifiedMock,
  };
});

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

const clientBoundary = mintedBoundary('household-acme', 'm1');

beforeEach(() => {
  ensureMeetingNoticeVerifiedMock.mockReset();
  ensureMeetingNoticeVerifiedMock.mockResolvedValue(false);
  useMatterStore.setState({
    matters: [{
      id: 'm1',
      name: 'Acme',
      client: 'Acme',
      folderPaths: ['C:/WS/Clients/Acme'],
      crmHouseholdKeys: ['household-acme'],
      createdAt: '2026-07-04T00:00:00.000Z',
    }],
  });
});

afterEach(() => {
  useMatterStore.setState({ matters: [] });
});

const baseMeta = {
  matterId: 'm1',
  consent: {
    mode: 'one-party',
    confirmedBy: 'user',
    confirmedAt: '2026-07-04T10:00:00Z',
  },
};

function makeWorkspace() {
  const metas: Record<string, Record<string, unknown>> = {
    a: {
      ...baseMeta,
      startedAt: '2026-07-04T10:00:00Z',
      customTitle: 'Annual review',
      meetingFileVisibility: createLegacyUnrestrictedMeetingFileVisibilityManifest({
        meetingSubjectId: 'legacy-meeting-a',
        fileNames: ['meeting.json', 'transcript.json'],
      }),
    },
    b: {
      ...baseMeta,
      startedAt: '2026-07-05T10:00:00Z',
      customTitle: 'Roth planning',
      meetingFileVisibility: createLegacyUnrestrictedMeetingFileVisibilityManifest({
        meetingSubjectId: 'legacy-meeting-b',
        fileNames: ['meeting.json', 'transcript.json'],
      }),
    },
  };
  return {
    exists: vi.fn(async (path: string) => !path.endsWith('notes.docx')),
    list: vi.fn(async (path: string) => {
      if (path.endsWith('/Meetings')) {
        return [
          {
            name: 'a',
            path: 'C:/WS/Clients/Acme/Meetings/a',
            type: 'folder' as const,
          },
          {
            name: 'b',
            path: 'C:/WS/Clients/Acme/Meetings/b',
            type: 'folder' as const,
          },
        ];
      }
      return [
        {
          name: 'meeting.json',
          path: `${path}/meeting.json`,
          type: 'file' as const,
        },
        {
          name: 'transcript.json',
          path: `${path}/transcript.json`,
          type: 'file' as const,
        },
      ];
    }),
    readFile: vi.fn(async (path: string) => {
      const folder = path.includes('/Meetings/b/') ? 'b' : 'a';
      if (path.endsWith('meeting.json')) return JSON.stringify(metas[folder]);
      if (path.endsWith('transcript.json'))
        return JSON.stringify({ segments: [] });
      throw new Error('not present');
    }),
    writeFile: vi.fn(async () => {}),
    readFileBinary: vi.fn(async () => {
      throw new Error('not present');
    }),
    writeFileBinary: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
}

function meetingsScanCount(workspace: ReturnType<typeof makeWorkspace>): number {
  return workspace.list.mock.calls.filter(
    ([path]) => typeof path === 'string' && path.endsWith('/Meetings')
  ).length;
}

describe('ClientMeetingsTab — master-detail rail', () => {
  it('keeps a selected meeting open when mount verification makes no durable change', async () => {
    const workspace = makeWorkspace();
    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={workspace as never}
      />
    );

    await screen.findByTestId('meeting-entry');
    await waitFor(() =>
      expect(ensureMeetingNoticeVerifiedMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    const scansBeforeSelection = meetingsScanCount(workspace);
    const rows = await screen.findAllByTestId('meeting-row');
    fireEvent.click(rows[1]!);
    await waitFor(() =>
      expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    );
    const selectedDetail = screen.getByTestId('meeting-entry');
    await waitFor(() =>
      expect(
        within(selectedDetail).getByText('Annual review')
      ).toBeVisible()
    );
    expect(screen.getByTestId('meeting-entry')).toBe(selectedDetail);
    expect(meetingsScanCount(workspace)).toBe(scansBeforeSelection);
    expect(ensureMeetingNoticeVerifiedMock).toHaveBeenCalled();
  });

  it('refreshes exactly once after a real notice write and preserves the selected detail host', async () => {
    let releaseDurableNotice: ((changed: boolean) => void) | undefined;
    const durableNotice = new Promise<boolean>((resolve) => {
      releaseDurableNotice = resolve;
    });
    ensureMeetingNoticeVerifiedMock
      .mockReturnValueOnce(durableNotice)
      .mockResolvedValue(false);
    const workspace = makeWorkspace();
    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={workspace as never}
      />
    );

    const detail = await screen.findByTestId('meeting-entry');
    await waitFor(() =>
      expect(ensureMeetingNoticeVerifiedMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    );
    const scansBeforeDurableChange = meetingsScanCount(workspace);
    await act(async () => {
      releaseDurableNotice?.(true);
      await durableNotice;
    });
    // One adapter refresh reads the Meetings directory twice: once for the
    // visibility migration check and once for the authorized row scan.
    await waitFor(() =>
      expect(meetingsScanCount(workspace)).toBe(scansBeforeDurableChange + 2)
    );
    expect(screen.getByTestId('meeting-entry')).toBe(detail);
    expect(screen.getAllByTestId('meeting-row')[0]).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(ensureMeetingNoticeVerifiedMock).toHaveBeenCalled();
  });

  it('puts meetings in the left rail and shows the selected meeting detail on the right', async () => {
    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={makeWorkspace() as never}
      />
    );

    await waitFor(() =>
      expect(screen.getAllByTestId('meeting-row')).toHaveLength(2)
    );

    expect(screen.getByRole('listbox', { name: 'Meetings' })).toBeVisible();
    const recordButton = screen.getByTestId('record-meeting-button');
    expect(recordButton).toHaveAttribute('aria-label', 'Record a meeting');
    expect(recordButton).toHaveTextContent('');

    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry')).toBeVisible()
    );
    expect(screen.queryByTestId('meeting-entry-back')).toBeNull();
    expect(screen.queryByTestId('meeting-subtab-recording')).toBeNull();
    expect(screen.getByTestId('meeting-subtab-transcript')).toBeVisible();
    expect(screen.getByTestId('meeting-subtab-summary')).toBeVisible();
    // Send moved out of the tab row into a header action (meetings audit item 1).
    expect(screen.queryByTestId('meeting-subtab-send-to-team')).toBeNull();
    expect(screen.getByTestId('meeting-entry-send')).toBeVisible();

    await waitFor(() =>
      expect(
        within(screen.getByTestId('meeting-entry')).getByText('Roth planning')
      ).toBeVisible()
    );
    const rows = screen.getAllByTestId('meeting-row');
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByTestId('meeting-title-rename'));
    expect(screen.getByTestId('meeting-title-input')).toHaveValue(
      'Roth planning'
    );

    fireEvent.click(rows[1]!);
    await waitFor(() =>
      expect(screen.getAllByTestId('meeting-row')[1]).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    expect(screen.queryByTestId('meeting-title-input')).toBeNull();
  });

  it('opens a direct requested meeting inside the rail with no embedded back arrow', async () => {
    render(
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => clientBoundary}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={makeWorkspace() as never}
        initialSelectedMeeting={{
          dir: 'C:/WS/Clients/Acme/Meetings/a',
          folderName: 'a',
          startMs: 45_000,
        }}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('client-meetings-tab')).toBeVisible()
    );
    expect(screen.getByRole('listbox', { name: 'Meetings' })).toBeVisible();
    await waitFor(() =>
      expect(
        within(screen.getByTestId('meeting-entry')).getByText('Annual review')
      ).toBeVisible()
    );
    expect(screen.queryByTestId('meeting-entry-back')).toBeNull();
    expect(screen.getAllByTestId('meeting-row')[1]).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('removes the direct client route when only the household half changes', async () => {
    let active = clientBoundary;
    const renderTab = () => (
      <ClientMeetingsTab
        clientBoundary={clientBoundary}
        getActiveClientBoundary={() => active}
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={makeWorkspace() as never}
      />
    );
    const view = render(renderTab());
    await screen.findByTestId('client-meetings-tab');

    active = mintedBoundary('household-other', clientBoundary.matterId);
    view.rerender(renderTab());

    expect(screen.queryByTestId('client-meetings-tab')).toBeNull();
  });
});

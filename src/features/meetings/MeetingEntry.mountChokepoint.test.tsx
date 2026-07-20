import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { Matter } from '@/platform/types/matter';

const meetingBoundaryMint = vi.hoisted(() => ({
  selection: null as null | {
    householdRef: string;
    matterId: string;
    displayName?: string;
  },
}));

const extractStoredNotes = vi.hoisted(() => vi.fn());

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

vi.mock('@/platform/utils/docx-io', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/utils/docx-io')>();
  return { ...actual, extractDocxText: extractStoredNotes };
});

import {
  createDirectClientMeetingsAdapter,
  readActiveMeetingClientBoundary,
  type SealedMeetingClientBoundary,
} from './foundation/contract';
import { MeetingEntry } from './MeetingEntry';

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

afterEach(() => {
  useMatterStore.setState({ matters: [] });
  extractStoredNotes.mockReset();
});

describe('MeetingEntry synchronous pair-change unmount', () => {
  it('removes the whole detail host before a same-matter new household can render it', async () => {
    useMatterStore.setState({
      matters: [
        {
          id: clientA.matterId,
          name: 'Shared matter',
          client: 'Alpha Household',
          folderPaths: [clientFolder],
          crmHouseholdKeys: [clientA.householdRef],
          createdAt: '2026-07-01T00:00:00.000Z',
        } as Matter,
      ],
    });
    const adapter = createDirectClientMeetingsAdapter({
      client: clientA,
      getActiveClientBoundary: () => clientA,
      matterFolder: clientFolder,
      scan: () =>
        Promise.resolve({
          meetings: [
            {
              dir: `${clientFolder}/Meetings/meeting-a`,
              folderName: 'meeting-a',
            },
          ],
          scanFailed: false,
        }),
    });
    const result = await adapter.list();
    const target = adapter.resolveTarget(result, {
      dir: `${clientFolder}/Meetings/meeting-a`,
      folderName: 'meeting-a',
    });
    if (!target) throw new Error('expected pair-bound target');

    const props = {
      target,
      clientName: 'Alpha Household',
      workspaceRoot: '/workspace',
      workspaceService: null,
      onBack: () => undefined,
    } as const;
    const { rerender } = render(
      <MeetingEntry {...props} activeClientBoundary={clientA} />
    );
    expect(screen.getByTestId('meeting-entry')).toBeInTheDocument();

    rerender(<MeetingEntry {...props} activeClientBoundary={clientB} />);

    expect(screen.queryByTestId('meeting-entry')).toBeNull();
    expect(screen.queryByTestId('meeting-entry-audio-handoff')).toBeNull();
    expect(screen.queryByTestId('meeting-subtab-summary')).toBeNull();
  });

  it('delivers a stored notes.docx summary as ready after reopening the sealed direct meeting', async () => {
    useMatterStore.setState({
      matters: [
        {
          id: clientA.matterId,
          name: 'Shared matter',
          client: 'Alpha Household',
          folderPaths: [clientFolder],
          crmHouseholdKeys: [clientA.householdRef],
          createdAt: '2026-07-01T00:00:00.000Z',
        } as Matter,
      ],
    });
    const adapter = createDirectClientMeetingsAdapter({
      client: clientA,
      getActiveClientBoundary: () => clientA,
      matterFolder: clientFolder,
      scan: () =>
        Promise.resolve({
          meetings: [
            {
              dir: `${clientFolder}/Meetings/meeting-a`,
              folderName: 'meeting-a',
            },
          ],
          scanFailed: false,
        }),
    });
    const listed = await adapter.list();
    const target = adapter.resolveTarget(listed, {
      dir: `${clientFolder}/Meetings/meeting-a`,
      folderName: 'meeting-a',
    });
    if (!target) throw new Error('expected pair-bound target');

    extractStoredNotes.mockResolvedValue({
      plainText:
        'Summary\nAnnual review recap.\n\nDecisions\n- Complete the Roth conversion.\n\nPersonal notes\n- The family move is complete.',
      html: '<p>Annual review recap.</p>',
    });
    const workspace = {
      readFile: vi.fn((path: string) =>
        path.endsWith('meeting.json')
          ? Promise.resolve(JSON.stringify({ matterId: clientA.matterId }))
          : Promise.reject(new Error('not found'))
      ),
      exists: vi.fn((path: string) =>
        Promise.resolve(path.endsWith('notes.docx'))
      ),
      readFileBinary: vi.fn((path: string) =>
        path.endsWith('notes.docx')
          ? Promise.resolve(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
          : Promise.reject(new Error('not found'))
      ),
    };
    const props = {
      activeClientBoundary: clientA,
      target,
      clientName: 'Alpha Household',
      workspaceRoot: '/workspace',
      workspaceService: workspace as unknown as WorkspaceService,
      onBack: () => undefined,
    } as const;

    const first = render(<MeetingEntry {...props} />);
    expect(await screen.findByTestId('meeting-summary-text')).toHaveTextContent(
      'Annual review recap.'
    );
    expect(screen.getByTestId('meeting-summary-decisions')).toHaveTextContent(
      'Complete the Roth conversion.'
    );
    first.unmount();

    render(<MeetingEntry {...props} />);
    expect(await screen.findByTestId('meeting-summary-text')).toHaveTextContent(
      'Annual review recap.'
    );
    expect(extractStoredNotes).toHaveBeenCalledTimes(2);
  });
});

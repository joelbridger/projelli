import { act, render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type {
  MeetingProjection,
  SealedMeetingClientBoundary,
} from './foundation/contract';
import { meetingPanelRegistry } from './meetingPanelRegistry';
import type { MeetingPanelContext } from './meetingWorkspaceTypes';
import {
  StructuredMeetingSummaryPanel,
  structuredSummaryFromText,
  type StructuredMeetingSummaryLoader,
  type StructuredMeetingSummaryLoadRequest,
  type StructuredMeetingSummaryPanelLoadResult,
} from './StructuredMeetingSummaryPanel';

const connectedStores = vi.hoisted(() => ({
  meetings: { list: [], error: null },
  artifacts: {
    readerFor: vi.fn(() => ({
      listForMeeting: () => [],
      get: () => null,
    })),
  },
}));

const extractFolderDocx = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve({
      plainText: 'Private household A folder recap',
      html: '<p>Private household A folder recap</p>',
    })
  )
);

vi.mock('./foundation/contract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./foundation/contract')>();
  return {
    ...actual,
    useMeetingFoundationStore: () => connectedStores.meetings,
    useMeetingArtifactStore: () => connectedStores.artifacts,
  };
});

vi.mock('@/platform/utils/docx-io', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/platform/utils/docx-io')
  >();
  return { ...actual, extractDocxText: extractFolderDocx };
});

const translations: Record<string, string> = {
  'meetings.entry.structured-summary-loading': 'Loading summary',
  'meetings.entry.structured-summary-read-error': 'Could not load summary',
  'meetings.entry.structured-summary-title': 'Meeting summary',
  'meetings.entry.structured-summary-recap': 'Summary',
  'meetings.entry.structured-summary-decisions': 'Decisions',
  'meetings.entry.structured-summary-personal-notes': 'Personal notes',
  'meetings.entry.structured-summary-processing': 'Processing',
  'meetings.entry.structured-summary-ready': 'Summary ready',
  'meetings.entry.structured-summary-needs-review': 'Needs review',
  'meetings.entry.reviewed': 'Reviewed',
  'meetings.entry.summary-not-ready': 'Summary not ready',
};

function boundary(householdRef: string): SealedMeetingClientBoundary {
  return {
    householdRef,
    matterId: 'shared-matter',
  } as SealedMeetingClientBoundary;
}

function meeting(id: string, householdRef: string): MeetingProjection {
  return {
    id,
    workspaceId: 'workspace-1',
    householdRef,
    matterId: 'shared-matter',
    typeId: 'review',
    ownerRef: 'owner-1',
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'America/Chicago',
    state: 'completed',
    references: [],
  };
}

function context(id: string, householdRef: string): MeetingPanelContext {
  return {
    t: ((key: string) => translations[key] ?? key) as TFunction,
    matterId: 'shared-matter',
    canonicalMeeting: meeting(id, householdRef),
    clientBoundary: boundary(householdRef),
    meetingDir: `/workspace/${householdRef}/${id}`,
    clientName: householdRef,
    workspaceRoot: '/workspace',
    workspaceService: null,
    firm: { org: null, role: null },
    meta: null,
    transcript: null,
    summaryExtraction: null,
    summaryText: '',
    audioSrc: null,
    renderAudioPlayer: () => null,
    seekMs: undefined,
    hasAudio: false,
    hasNotes: false,
    summaryReady: false,
    crmBlockedReason: null,
    retryingNotes: false,
    retryingTranscript: false,
    onSeek: vi.fn(),
    onRetryNotes: vi.fn(),
    onRetryTranscript: vi.fn(),
  };
}

function ready(
  summary: string,
  overrides: Partial<
    Extract<StructuredMeetingSummaryPanelLoadResult, { kind: 'ready' }>
  > = {}
): StructuredMeetingSummaryPanelLoadResult {
  return {
    kind: 'ready',
    content: { summary, decisions: [], personalNotes: [] },
    reviewState: 'needs-review',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('StructuredMeetingSummaryPanel', () => {
  it('renders only real populated sections and omits absent cards', async () => {
    const loader: StructuredMeetingSummaryLoader = () =>
      Promise.resolve(
        ready('The plan review is complete.', {
          content: {
            summary: 'The plan review is complete.',
            decisions: ['Fund the Roth conversion.'],
            personalNotes: [],
          },
        })
      );
    render(
      <StructuredMeetingSummaryPanel
        context={context('meeting-a', 'household-a')}
        loadSummary={loader}
      />
    );

    expect(
      await screen.findByText('The plan review is complete.')
    ).toBeTruthy();
    expect(screen.getByTestId('meeting-summary-decisions')).toHaveTextContent(
      'Fund the Roth conversion.'
    );
    expect(screen.queryByTestId('meeting-summary-personal-notes')).toBeNull();
    expect(screen.getByTestId('meeting-summary-processing')).toHaveTextContent(
      'Summary ready'
    );
    expect(screen.getByTestId('meeting-summary-processing')).toHaveTextContent(
      'Needs review'
    );
  });

  it('clears client A synchronously and ignores A when its async read finishes late', async () => {
    const readA = deferred<StructuredMeetingSummaryPanelLoadResult>();
    const readB = deferred<StructuredMeetingSummaryPanelLoadResult>();
    const loader: StructuredMeetingSummaryLoader = vi.fn(
      (request: StructuredMeetingSummaryLoadRequest) =>
        request.meeting.id === 'meeting-a' ? readA.promise : readB.promise
    );
    const { rerender } = render(
      <StructuredMeetingSummaryPanel
        context={context('meeting-a', 'household-a')}
        loadSummary={loader}
      />
    );
    expect(screen.getByTestId('meeting-entry-summary-loading')).toBeTruthy();

    rerender(
      <StructuredMeetingSummaryPanel
        context={context('meeting-b', 'household-b')}
        loadSummary={loader}
      />
    );
    expect(screen.getByTestId('meeting-entry-summary-loading')).toBeTruthy();

    await act(async () => {
      readA.resolve(ready('Private A recap'));
      await readA.promise;
    });
    expect(screen.queryByText('Private A recap')).toBeNull();
    expect(screen.getByTestId('meeting-entry-summary-loading')).toBeTruthy();

    await act(async () => {
      readB.resolve(ready('Current B recap'));
      await readB.promise;
    });
    expect(screen.getByText('Current B recap')).toBeTruthy();
  });

  it('fails closed when the folder-only host already extracted a summary', () => {
    const folderOnly = {
      ...context('meeting-shared', 'household-b'),
      canonicalMeeting: null,
      clientBoundary: null,
      meetingDir: '/workspace/shared-meeting',
      hasNotes: true,
      summaryReady: true,
      summaryText: 'Private household A folder recap',
      summaryExtraction: {
        plainText: 'Private household A folder recap',
        html: '<p>Private household A folder recap</p>',
      },
    } satisfies MeetingPanelContext;

    render(<StructuredMeetingSummaryPanel context={folderOnly} />);

    expect(screen.getByTestId('meeting-entry-summary-not-ready')).toBeTruthy();
    expect(screen.queryByText('Private household A folder recap')).toBeNull();
  });

  it('does not give household B household A folder summary when both share a matter and meeting folder', async () => {
    const readFile = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ reviewedAt: '2026-07-20T11:00:00Z' }));
    const exists = vi.fn().mockResolvedValue(true);
    const readFileBinary = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const sharedFolder = {
      readFile,
      exists,
      readFileBinary,
    } as unknown as WorkspaceService;
    const householdB = {
      ...context('meeting-shared', 'household-b'),
      meetingDir: '/workspace/shared-meeting',
      workspaceService: sharedFolder,
    } satisfies MeetingPanelContext;

    render(<StructuredMeetingSummaryPanel context={householdB} />);

    expect(
      await screen.findByTestId('meeting-entry-summary-not-ready')
    ).toBeTruthy();
    expect(screen.queryByText('Private household A folder recap')).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
    expect(readFileBinary).not.toHaveBeenCalled();
    expect(extractFolderDocx).not.toHaveBeenCalled();
  });

  it('rebinds the one existing blessed summary descriptor without registering another', () => {
    const summaries = meetingPanelRegistry.filter(
      (descriptor) => descriptor.id === 'summary'
    );
    expect(summaries).toHaveLength(1);
    const mounted = summaries[0]?.mount(
      context('meeting-a', 'household-a')
    ) as ReactElement;
    expect(mounted.type).toBe(StructuredMeetingSummaryPanel);
  });
});

describe('structuredSummaryFromText', () => {
  it('projects only present sections and leaves action items to their own panel', () => {
    expect(
      structuredSummaryFromText(`
What changed
- Confirmed the updated retirement date.

Decisions
- Model the Roth conversion.

Action items
- Send the application.
`)
    ).toEqual({
      summary: 'Confirmed the updated retirement date.',
      decisions: ['Model the Roth conversion.'],
      personalNotes: [],
    });
  });
});

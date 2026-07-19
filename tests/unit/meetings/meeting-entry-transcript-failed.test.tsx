/**
 * QA-40 — once a transcriptError is recorded on meeting.json, MeetingEntry's
 * transcript pane must show an honest, classified message + a working retry
 * instead of the generic "queued" copy (which used to read as a permanent
 * hang even though the pipeline already gave up — see
 * docs/evidence/meetings-verify3-20260704/RUN-LOG.md). Mirrors
 * meeting-entry-notes-failed.test.tsx (QA-31)'s pattern.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const { retryMeetingTranscriptMock } = vi.hoisted(() => ({ retryMeetingTranscriptMock: vi.fn(async () => {}) }));
vi.mock('@/features/meetings/meetingStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/meetings/meetingStore')>();
  return { ...actual, retryMeetingTranscript: retryMeetingTranscriptMock };
});

// See meeting-entry-notes-failed.test.tsx: MeetingEntry's DocxEditor dynamic
// import is unrelated to this test's subject and flakes under full-suite
// parallel-transform contention. Mock it so the import resolves synchronously.
vi.mock('@/features/documents/media/DocxEditor', () => ({ DocxEditor: () => null }));

import { meetingEntryTestMount } from './meetingEntryTestMount';
import { MeetingEntry } from '@/features/meetings/MeetingEntry';

function makeWorkspace(meetingJson: Record<string, unknown>) {
  return {
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith('meeting.json')) return JSON.stringify(meetingJson);
      throw new Error('not present');
    }),
    readFileBinary: vi.fn(async () => { throw new Error('no audio'); }),
    exists: vi.fn(async () => false),
    writeFile: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
}

const baseProps = {
  ...meetingEntryTestMount(),
  clientName: 'The Hendersons',
  workspaceRoot: '/ws',
  onBack: () => {},
};

describe('MeetingEntry — honest transcript-failed state (QA-40)', () => {
  it('shows the not-installed message when transcriptError.kind is "not-installed", and retry calls retryMeetingTranscript', async () => {
    retryMeetingTranscriptMock.mockClear();
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
      transcriptError: { kind: 'not-installed', at: '2026-07-04T10:05:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    screen.getByTestId('meeting-subtab-transcript').click();

    await waitFor(() => expect(screen.getByTestId('meeting-entry-transcript-failed')).toBeTruthy());
    expect(screen.queryByTestId('meeting-entry-transcript-pending')).toBeNull();
    expect(screen.getByTestId('meeting-entry-transcript-failed').textContent).toMatch(/isn't installed/i);

    screen.getByTestId('meeting-entry-retry-transcript').click();
    await waitFor(() =>
      expect(retryMeetingTranscriptMock).toHaveBeenCalledWith('/ws/C/Meetings/x', '/ws', 'm-1'),
    );
  });

  it('shows the timeout-specific message (distinct from a generic error) when transcriptError.kind is "timeout"', async () => {
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
      transcriptError: { kind: 'timeout', at: '2026-07-04T10:05:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    screen.getByTestId('meeting-subtab-transcript').click();

    await waitFor(() => expect(screen.getByTestId('meeting-entry-transcript-failed')).toBeTruthy());
    expect(screen.getByTestId('meeting-entry-transcript-failed').textContent).toMatch(/respond in time/i);
  });

  it('shows the generic-error message when transcriptError.kind is "error"', async () => {
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
      transcriptError: { kind: 'error', at: '2026-07-04T10:05:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    screen.getByTestId('meeting-subtab-transcript').click();

    await waitFor(() => expect(screen.getByTestId('meeting-entry-transcript-failed')).toBeTruthy());
    expect(screen.getByTestId('meeting-entry-transcript-failed').textContent).not.toMatch(/respond in time/i);
    expect(screen.getByTestId('meeting-entry-transcript-failed').textContent).toMatch(/returned an error/i);
  });

  it('still shows the plain "queued" copy when there is no transcriptError yet', async () => {
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    screen.getByTestId('meeting-subtab-transcript').click();

    await waitFor(() => expect(screen.getByTestId('meeting-entry-transcript-pending')).toBeTruthy());
    expect(screen.queryByTestId('meeting-entry-transcript-failed')).toBeNull();
  });

  it('drops a transcript retry result when the advisor switches to another meeting before it finishes', async () => {
    retryMeetingTranscriptMock.mockClear();
    let retried = false;
    let resolveRetry!: () => void;
    retryMeetingTranscriptMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRetry = () => {
        retried = true;
        resolve();
      };
    }));

    const meta = new Map<string, Record<string, unknown>>();
    meta.set('/ws/C/Meetings/A/meeting.json', {
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      customTitle: 'Meeting A',
      transcriptError: { kind: 'error', at: '2026-07-04T10:05:00Z' },
    });
    meta.set('/ws/C/Meetings/B/meeting.json', {
      matterId: 'm-1',
      startedAt: '2026-07-05T10:00:00Z',
      customTitle: 'Meeting B',
    });
    const ws = {
      readFile: vi.fn(async (path: string) => {
        const value = meta.get(path);
        if (value) return JSON.stringify(value);
        if (retried && path === '/ws/C/Meetings/A/transcript.json') {
          return JSON.stringify({
            segments: [{ startMs: 0, endMs: 1000, channel: 'mic', speaker: 'Advisor', text: 'A transcript.' }],
          });
        }
        throw new Error(`missing ${path}`);
      }),
      readFileBinary: vi.fn(async () => { throw new Error('no audio'); }),
      exists: vi.fn(async () => false),
      writeFile: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    const { rerender } = render(
      <MeetingEntry {...baseProps} {...meetingEntryTestMount('/ws/C/Meetings/A', 'A')} workspaceService={ws as never} />,
    );
    screen.getByTestId('meeting-subtab-transcript').click();
    await waitFor(() => expect(screen.getByTestId('meeting-entry-transcript-failed')).toBeTruthy());

    screen.getByTestId('meeting-entry-retry-transcript').click();
    rerender(
      <MeetingEntry {...baseProps} {...meetingEntryTestMount('/ws/C/Meetings/B', 'B')} workspaceService={ws as never} />,
    );
    await waitFor(() => expect(screen.getByTestId('meeting-entry-transcript-pending')).toBeTruthy());

    await act(async () => { resolveRetry(); });

    await waitFor(() => {
      expect(screen.getByTestId('meeting-entry-transcript-pending')).toBeTruthy();
      expect(screen.queryByTestId('transcript-viewer')).toBeNull();
    });
  });
});

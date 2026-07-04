/**
 * QA-40 — once a transcriptError is recorded on meeting.json, MeetingEntry's
 * transcript pane must show an honest, classified message + a working retry
 * instead of the generic "queued" copy (which used to read as a permanent
 * hang even though the pipeline already gave up — see
 * docs/evidence/meetings-verify3-20260704/RUN-LOG.md). Mirrors
 * meeting-entry-notes-failed.test.tsx (QA-31)'s pattern.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const { retryMeetingTranscriptMock } = vi.hoisted(() => ({ retryMeetingTranscriptMock: vi.fn(async () => {}) }));
vi.mock('@/features/meetings/meetingStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/meetings/meetingStore')>();
  return { ...actual, retryMeetingTranscript: retryMeetingTranscriptMock };
});

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
  matterId: 'm-1',
  meetingDir: '/ws/C/Meetings/x',
  folderName: 'x',
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

    await waitFor(() => expect(screen.getByTestId('meeting-entry-transcript-pending')).toBeTruthy());
    expect(screen.queryByTestId('meeting-entry-transcript-failed')).toBeNull();
  });
});

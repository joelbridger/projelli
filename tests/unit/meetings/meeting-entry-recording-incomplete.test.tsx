/**
 * QA-35 review round 2 — a disk-full `capture_stop` that salvaged NO audio
 * at all (most commonly `finalize_session` itself failing because the disk
 * was STILL full when Stop tried to write the merged audio.wav) used to
 * leave the meeting's notes/transcript panes stuck at "pending" forever —
 * nothing was ever asked to generate them, since `stopRecording`'s failure
 * path used to return before the post-stop pipeline ever ran. This is the
 * exact eternal-pending class QA-31/QA-40/QA-41 already killed for the
 * healthy-recording path; MeetingEntry must show an honest, no-retry
 * "didn't finish saving" state instead — never a silent forever-wait.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { MeetingEntry } from '@/features/meetings/MeetingEntry';

function makeWorkspace(
  meetingJson: Record<string, unknown>,
  opts: { audioExists: boolean } = { audioExists: false }
) {
  return {
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith('meeting.json')) return JSON.stringify(meetingJson);
      throw new Error('not present');
    }),
    readFileBinary: vi.fn(async () => {
      if (opts.audioExists) return new ArrayBuffer(8);
      throw new Error('no audio');
    }),
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

describe('MeetingEntry — honest recording-incomplete state (QA-35 review round 2)', () => {
  it('shows the durable "didn\'t finish saving" message in Transcript, not a retired audio tab, when a recordingError left no audio at all', async () => {
    const ws = makeWorkspace(
      {
        matterId: 'm-1',
        startedAt: '2026-07-04T10:00:00Z',
        consent: {
          mode: 'one-party',
          confirmedBy: 'user',
          confirmedAt: '2026-07-04T10:00:00Z',
        },
        recordingError: {
          kind: 'error',
          at: '2026-07-04T10:05:00Z',
          message: 'No space left on device',
        },
      },
      { audioExists: false }
    );

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    fireEvent.click(screen.getByTestId('meeting-subtab-transcript'));
    await waitFor(() =>
      expect(
        screen.getByTestId('meeting-entry-recording-incomplete-transcript')
      ).toBeTruthy()
    );
    expect(
      screen.queryByTestId('meeting-entry-recording-incomplete')
    ).toBeNull();
    expect(screen.queryByTestId('meeting-entry-transcript-pending')).toBeNull();
    // No retry offered — there's nothing to regenerate from; re-recording the
    // meeting is the only way forward, which this component has no action for.
    expect(screen.queryByTestId('meeting-entry-retry-notes')).toBeNull();
    expect(screen.queryByTestId('meeting-entry-retry-transcript')).toBeNull();
  });

  it('still shows the ordinary "pending" state when a recordingError is set but real audio WAS salvaged (the disk-full-with-partial-audio case, handled by continuing the normal pipeline instead)', async () => {
    const ws = makeWorkspace(
      {
        matterId: 'm-1',
        startedAt: '2026-07-04T10:00:00Z',
        consent: {
          mode: 'one-party',
          confirmedBy: 'user',
          confirmedAt: '2026-07-04T10:00:00Z',
        },
        recordingError: {
          kind: 'disk-full',
          at: '2026-07-04T10:05:00Z',
          message: 'partial audio at ...',
        },
      },
      { audioExists: true }
    );

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry-notes-pending')).toBeTruthy()
    );
    fireEvent.click(screen.getByTestId('meeting-subtab-transcript'));
    expect(screen.getByTestId('meeting-entry-transcript-pending')).toBeTruthy();
    expect(
      screen.queryByTestId('meeting-entry-recording-incomplete')
    ).toBeNull();
    expect(
      screen.queryByTestId('meeting-entry-recording-incomplete-transcript')
    ).toBeNull();
  });

  it('still shows the plain "pending" state when there is no recordingError at all', async () => {
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: {
        mode: 'one-party',
        confirmedBy: 'user',
        confirmedAt: '2026-07-04T10:00:00Z',
      },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry-notes-pending')).toBeTruthy()
    );
    expect(
      screen.queryByTestId('meeting-entry-recording-incomplete')
    ).toBeNull();
  });
});

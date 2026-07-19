/**
 * QA-71 — "Delete audio · keep transcript" must not imply anything is kept
 * when transcription never produced transcript.json. In that state the audio
 * is the only meeting content left.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { meetingEntryTestMount } from './meetingEntryTestMount';
import { MeetingEntry } from '@/features/meetings/MeetingEntry';

/** Delete audio now lives in the header `...` menu (meetings audit item 7). */
function openActionsMenu() {
  const trigger = screen.getByTestId('meeting-entry-actions-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

vi.mock('@/features/documents/media/DocxEditor', () => ({ DocxEditor: () => null }));
vi.mock('@/features/dictation/audio/AudioPlayer', async () => {
  const React = await import('react');
  return {
    AudioPlayer: React.forwardRef(() =>
      React.createElement('div', { 'data-testid': 'mock-audio-player' }),
    ),
  };
});

function makeWorkspace({ withTranscript = false }: { withTranscript?: boolean } = {}) {
  return {
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith('meeting.json')) {
        return JSON.stringify({
          matterId: 'm-1',
          startedAt: '2026-07-04T10:00:00Z',
          consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
        });
      }
      if (withTranscript && path.endsWith('transcript.json')) {
        return JSON.stringify({
          segments: [{ id: 's1', startMs: 0, endMs: 1000, speaker: 'Advisor', text: 'Hello.' }],
        });
      }
      throw new Error('not present');
    }),
    readFileBinary: vi.fn(async (path: string) => {
      if (path.endsWith('audio.wav')) return new Uint8Array([1, 2, 3]).buffer;
      throw new Error('not present');
    }),
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

describe('MeetingEntry — delete audio confirmation without transcript (QA-71)', () => {
  it('warns that deleting audio before transcript exists loses the only copy', async () => {
    const ws = makeWorkspace();

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    await waitFor(() => expect(screen.getByTestId('meeting-entry-actions-menu')).toBeTruthy());
    openActionsMenu();
    fireEvent.click(await screen.findByTestId('meeting-entry-delete-audio'));

    await waitFor(() => expect(screen.getByTestId('delete-audio-confirm')).toBeTruthy());
    const copy = screen.getByTestId('delete-audio-confirm').textContent ?? '';

    expect(copy).toMatch(/no transcript/i);
    expect(copy).toMatch(/no notes/i);
    expect(copy).toMatch(/only copy/i);
  });

  it('keeps the existing transcript-preserved copy when transcript.json exists', async () => {
    const ws = makeWorkspace({ withTranscript: true });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    await waitFor(() => expect(screen.getByTestId('meeting-entry-actions-menu')).toBeTruthy());
    openActionsMenu();
    const deleteItem = await screen.findByTestId('meeting-entry-delete-audio');
    expect(deleteItem.textContent).toMatch(/keep transcript/i);

    fireEvent.click(deleteItem);

    await waitFor(() => expect(screen.getByTestId('delete-audio-confirm')).toBeTruthy());
    const copy = screen.getByTestId('delete-audio-confirm').textContent ?? '';

    expect(copy).toMatch(/transcript and notes stay/i);
    expect(copy).not.toMatch(/only copy/i);
  });
});

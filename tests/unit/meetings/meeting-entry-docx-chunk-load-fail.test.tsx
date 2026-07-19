/**
 * R7 — MeetingEntry no longer mounts the live DocxEditor pane. A real
 * notes.docx exists on disk; the meeting page should show the Summary tab and
 * export actions instead of trying to lazy-load the Word editor inline.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { meetingEntryTestMount } from './meetingEntryTestMount';
import { MeetingEntry } from '@/features/meetings/MeetingEntry';

function makeWorkspace(meetingJson: Record<string, unknown>) {
  return {
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith('meeting.json')) return JSON.stringify(meetingJson);
      throw new Error('not present');
    }),
    readFileBinary: vi.fn(async () => { throw new Error('could not read notes'); }),
    // notes.docx genuinely exists — the chunk-load failure is the ONLY
    // problem here.
    exists: vi.fn(async (path: string) => path.endsWith('notes.docx')),
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

describe('MeetingEntry — Summary tab replaces the live DocxEditor pane (R7)', () => {
  it('does not mount the lazy Word editor pane when notes.docx exists', async () => {
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));

    await waitFor(() => {
      expect(screen.getByTestId('meeting-summary-tab')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('lazy-boundary-fallback')).toBeNull();
    expect(screen.queryByTestId('meeting-entry-notes-pending')).toBeNull();
    // notes.docx exists but its bytes couldn't be read, so the Summary tab
    // shows the static not-ready message, never the lazy Word editor pane.
    expect(screen.getByTestId('meeting-entry-summary-not-ready')).toBeInTheDocument();
  });
});

/**
 * QA-47 — a DocxEditor chunk-load failure (dynamic import rejects, e.g. a
 * flaky network mid-fetch of the code-split bundle) must not be mistaken for
 * "notes pending". A real notes.docx exists on disk; MeetingEntry must show
 * a load-failed / retry state, not the false "still generating" copy.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/features/documents/media/DocxEditor', () => {
  throw new Error('Failed to fetch dynamically imported module');
});

import { MeetingEntry } from '@/features/meetings/MeetingEntry';

function makeWorkspace(meetingJson: Record<string, unknown>) {
  return {
    readFile: vi.fn(async (path: string) => {
      if (path.endsWith('meeting.json')) return JSON.stringify(meetingJson);
      throw new Error('not present');
    }),
    readFileBinary: vi.fn(async () => { throw new Error('no audio'); }),
    // notes.docx genuinely exists — the chunk-load failure is the ONLY
    // problem here.
    exists: vi.fn(async (path: string) => path.endsWith('notes.docx')),
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

describe('MeetingEntry — DocxEditor chunk-load failure (QA-47)', () => {
  it('shows a load-failed / retry state instead of the false "notes pending" copy when notes.docx exists but the editor chunk fails to load', async () => {
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    await waitFor(() => {
      expect(screen.queryByTestId('meeting-entry-notes-pending')).not.toBeInTheDocument();
    });

    // The load-failed / retry surface must appear instead — NOT a silent
    // false "pending" state. The chunk import + Suspense/error-boundary
    // settle asynchronously, so give it its own waitFor.
    await waitFor(() => {
      expect(screen.getByTestId('lazy-boundary-fallback')).toBeInTheDocument();
    });
    expect(screen.getByTestId('lazy-boundary-retry')).toBeInTheDocument();
  });
});

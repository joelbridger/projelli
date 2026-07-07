import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/platform/utils/docx-io', () => ({
  extractDocxText: vi.fn(async () => ({ html: '<p>Summary body</p>', plainText: 'Summary body' })),
  markdownToDocxBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  applyLetterheadIfConfigured: vi.fn(async (bytes: Uint8Array) => bytes),
}));

vi.mock('@/platform/utils/docx-commands', () => ({
  docxConvertToPdf: vi.fn(async () => '/tmp/meeting.pdf'),
}));

import { MeetingEntry } from '@/features/meetings/MeetingEntry';
import { setMeetingsWorkspaceService } from '@/features/meetings/meetingStore';

function makeWorkspace() {
  const files = new Map<string, string>();
  files.set('/ws/C/Meetings/x/meeting.json', JSON.stringify({
    matterId: 'm-1',
    startedAt: '2026-07-04T10:00:00Z',
    consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
  }));
  files.set('/ws/C/Meetings/x/transcript.json', JSON.stringify({
    segments: [{ startMs: 0, endMs: 1000, channel: 'mic', speaker: 'Advisor', text: 'Hello client.' }],
  }));
  const ws = {
    readFile: vi.fn(async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`missing ${path}`);
      return value;
    }),
    readFileBinary: vi.fn(async (path: string) => {
      if (path.endsWith('audio.wav')) return new Uint8Array([80, 75, 3, 4]).buffer;
      throw new Error(`missing binary ${path}`);
    }),
    exists: vi.fn(async () => false),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    writeFileBinary: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  return ws;
}

const baseProps = {
  matterId: 'm-1',
  meetingDir: '/ws/C/Meetings/x',
  folderName: 'x',
  clientName: 'The Hendersons',
  workspaceRoot: '/ws',
  onBack: () => {},
};

describe('MeetingEntry R7 tabs, rename, and exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Recording, Transcript, Summary tabs; renames the meeting; exports transcript and Summary Word into the client documents folder', async () => {
    const ws = makeWorkspace();
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    expect(screen.getByTestId('meeting-subtab-recording')).toBeTruthy();
    expect(screen.getByTestId('meeting-subtab-transcript')).toBeTruthy();
    expect(screen.getByTestId('meeting-subtab-summary')).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId('meeting-entry-mark-reviewed')).toBeTruthy());
    fireEvent.click(screen.getByTestId('meeting-title-rename'));
    fireEvent.change(screen.getByTestId('meeting-title-input'), { target: { value: 'Quarterly plan review' } });
    fireEvent.click(screen.getByTestId('meeting-title-save'));
    await waitFor(() => {
      const write = ws.writeFile.mock.calls.find((c) => c[0] === '/ws/C/Meetings/x/meeting.json');
      expect(write).toBeTruthy();
      expect(JSON.parse(write?.[1] as string).customTitle).toBe('Quarterly plan review');
    });

    fireEvent.click(screen.getByTestId('meeting-subtab-transcript'));
    await waitFor(() => expect(screen.getByTestId('transcript-viewer')).toBeTruthy());
    fireEvent.click(screen.getByTestId('meeting-transcript-export'));
    await waitFor(() => {
      expect(ws.writeFile).toHaveBeenCalledWith('/ws/C/Meetings/x/transcript.txt', expect.stringContaining('Advisor: Hello client.'));
    });

    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() => expect(screen.getByTestId('meeting-summary-tab')).toBeTruthy());
    fireEvent.click(screen.getByTestId('meeting-summary-export-docx'));
    await waitFor(() => {
      expect(ws.writeFileBinary).toHaveBeenCalledWith('/ws/C/Documents/Quarterly plan review summary.docx', expect.any(ArrayBuffer));
    });
  });
});

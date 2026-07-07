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

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/utils/mail-commands')>();
  return {
    ...actual,
    mailConnectedAccounts: vi.fn(async () => [{ provider: 'm365', account: 'default', label: 'Outlook' }]),
  };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(async () => new Uint8Array([4, 5, 6])),
}));

import { MeetingEntry } from '@/features/meetings/MeetingEntry';
import { setMeetingsWorkspaceService } from '@/features/meetings/meetingStore';

function makeWorkspace(opts: { notesExists?: boolean; existingExports?: string[] } = {}) {
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
      if (path.endsWith('notes.docx')) return new Uint8Array([80, 75, 3, 4]).buffer;
      throw new Error(`missing binary ${path}`);
    }),
    exists: vi.fn(async (path: string) => {
      if (path.endsWith('/notes.docx')) return opts.notesExists ?? false;
      return opts.existingExports?.includes(path) ?? false;
    }),
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

  it('keeps four sub-tabs at the top and mounts the send panels only on Send to team', async () => {
    const ws = makeWorkspace({ notesExists: true });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    await waitFor(() => expect(screen.getByTestId('notice-trail')).toBeInTheDocument());

    const recordingTab = screen.getByTestId('meeting-subtab-recording');
    const transcriptTab = screen.getByTestId('meeting-subtab-transcript');
    const summaryTab = screen.getByTestId('meeting-subtab-summary');
    const sendToTeamTab = screen.getByTestId('meeting-subtab-send-to-team');
    const tabs = [recordingTab, transcriptTab, summaryTab, sendToTeamTab];
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Recording', 'Transcript', 'Summary', 'Send to team']);
    for (const [left, right] of [
      [recordingTab, transcriptTab],
      [transcriptTab, summaryTab],
      [summaryTab, sendToTeamTab],
    ] as const) {
      expect(left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(
      sendToTeamTab.compareDocumentPosition(screen.getByTestId('meeting-entry-tab-scroll')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sendToTeamTab.compareDocumentPosition(screen.getByTestId('notice-trail')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(screen.getByTestId('meeting-recording-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-recipients-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-artifact-send-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('meeting-subtab-transcript'));
    await waitFor(() => expect(screen.getByTestId('transcript-viewer')).toBeInTheDocument());
    expect(screen.queryByTestId('meeting-recipients-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-artifact-send-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() => expect(screen.getByTestId('meeting-summary-text')).toBeInTheDocument());
    expect(screen.queryByTestId('meeting-recipients-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-artifact-send-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('meeting-subtab-send-to-team'));
    await waitFor(() => expect(screen.getByTestId('meeting-recipients-panel')).toBeInTheDocument());
    expect(screen.getByTestId('meeting-artifact-send-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-recording-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-transcript-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-summary-tab')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('meeting-subtab-recording'));
    expect(screen.getByTestId('meeting-recording-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-recipients-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('meeting-artifact-send-panel')).not.toBeInTheDocument();
  });

  it('shows Recording, Transcript, Summary tabs; renames the meeting; exports transcript and Summary Word into the client documents folder', async () => {
    const ws = makeWorkspace({ notesExists: true });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    expect(screen.getByTestId('meeting-subtab-recording')).toBeTruthy();
    expect(screen.getByTestId('meeting-subtab-transcript')).toBeTruthy();
    expect(screen.getByTestId('meeting-subtab-summary')).toBeTruthy();
    expect(screen.getByTestId('meeting-subtab-send-to-team')).toBeTruthy();

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

  it('does not copy or export a summary until real notes text exists', async () => {
    const ws = makeWorkspace({ notesExists: false });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() => expect(screen.getByTestId('meeting-entry-notes-pending')).toBeTruthy());
    expect(screen.getByTestId('meeting-summary-copy')).toBeDisabled();
    expect(screen.getByTestId('meeting-summary-export-docx')).toBeDisabled();
    expect(screen.getByTestId('meeting-summary-export-pdf')).toBeDisabled();

    fireEvent.click(screen.getByTestId('meeting-summary-export-docx'));
    expect(ws.writeFileBinary).not.toHaveBeenCalled();
  });

  it('adds a suffix instead of overwriting an existing title-based summary export', async () => {
    const ws = makeWorkspace({
      notesExists: true,
      existingExports: ['/ws/C/Documents/Meeting summary.docx'],
    });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() => expect(screen.getByTestId('meeting-summary-text')).toBeTruthy());
    fireEvent.click(screen.getByTestId('meeting-summary-export-docx'));

    await waitFor(() => {
      expect(ws.writeFileBinary).toHaveBeenCalledWith('/ws/C/Documents/Meeting summary 2.docx', expect.any(ArrayBuffer));
    });
  });

  it('exports Summary PDF without leaving an extra Word document in the client documents folder', async () => {
    const ws = makeWorkspace({ notesExists: true });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() => expect(screen.getByTestId('meeting-summary-text')).toBeTruthy());
    fireEvent.click(screen.getByTestId('meeting-summary-export-pdf'));

    await waitFor(() => {
      expect(ws.writeFileBinary).toHaveBeenCalledWith(
        '/ws/C/Documents/Meeting summary.pdf',
        expect.any(ArrayBuffer)
      );
    });
    expect(ws.writeFileBinary).not.toHaveBeenCalledWith(
      '/ws/C/Documents/Meeting summary.docx',
      expect.any(ArrayBuffer)
    );
  });

  it('clears loaded meeting state before a different meeting can export stale notes', async () => {
    const files = new Map<string, string>();
    files.set('/ws/C/Meetings/A/meeting.json', JSON.stringify({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      customTitle: 'Meeting A',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
    }));
    files.set('/ws/C/Meetings/A/transcript.json', JSON.stringify({
      segments: [{ startMs: 0, endMs: 1000, channel: 'mic', speaker: 'Advisor', text: 'A transcript.' }],
    }));
    files.set('/ws/C/Meetings/B/meeting.json', JSON.stringify({
      matterId: 'm-1',
      startedAt: '2026-07-05T10:00:00Z',
      customTitle: 'Meeting B',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-05T10:00:00Z' },
    }));
    const ws = {
      readFile: vi.fn(async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error(`missing ${path}`);
        return value;
      }),
      readFileBinary: vi.fn(async (path: string) => {
        if (path === '/ws/C/Meetings/A/notes.docx') return new Uint8Array([80, 75, 3, 4]).buffer;
        throw new Error(`missing binary ${path}`);
      }),
      exists: vi.fn(async (path: string) => path === '/ws/C/Meetings/A/notes.docx'),
      writeFile: vi.fn(async () => {}),
      writeFileBinary: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    setMeetingsWorkspaceService(ws as never);

    const { rerender } = render(
      <MeetingEntry {...baseProps} meetingDir="/ws/C/Meetings/A" folderName="A" workspaceService={ws as never} />,
    );
    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() => expect(screen.getByTestId('meeting-summary-text')).toBeTruthy());

    rerender(
      <MeetingEntry {...baseProps} meetingDir="/ws/C/Meetings/B" folderName="B" workspaceService={ws as never} />,
    );

    await waitFor(() => expect(screen.getByTestId('meeting-summary-export-docx')).toBeDisabled());
    expect(screen.queryByTestId('meeting-summary-text')).toBeNull();
    fireEvent.click(screen.getByTestId('meeting-summary-export-docx'));
    expect(ws.writeFileBinary).not.toHaveBeenCalled();
  });
});

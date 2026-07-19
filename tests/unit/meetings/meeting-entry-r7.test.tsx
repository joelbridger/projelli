import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const { firmState, docxExtraction } = vi.hoisted(() => ({
  firmState: {
    current: {
      org: null as { org_id: string } | null,
      role: null as 'admin' | 'member' | null,
    },
  },
  docxExtraction: {
    current: { html: '<p>Summary body</p>', plainText: 'Summary body' },
  },
}));

vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => firmState.current,
}));

vi.mock('@/platform/utils/docx-io', () => ({
  extractDocxText: vi.fn(async () => docxExtraction.current),
  markdownToDocxBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  applyLetterheadIfConfigured: vi.fn(async (bytes: Uint8Array) => bytes),
}));

vi.mock('@/platform/utils/docx-commands', () => ({
  docxConvertToPdf: vi.fn(async () => '/tmp/meeting.pdf'),
}));

vi.mock('@/platform/utils/mail-commands', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/utils/mail-commands')>();
  return {
    ...actual,
    mailConnectedAccounts: vi.fn(async () => [
      { provider: 'm365', account: 'default', label: 'Outlook' },
    ]),
  };
});

vi.mock('@/platform/fs/tauriFsPlugin', () => ({
  readTauriFile: vi.fn(async () => new Uint8Array([4, 5, 6])),
}));

import { meetingEntryTestMount } from './meetingEntryTestMount';
import { MeetingEntry } from '@/features/meetings/MeetingEntry';
import { setMeetingsWorkspaceService } from '@/features/meetings/meetingStore';
import {
  registerMeetingPanel,
  getMeetingPanelComposition,
  type MeetingPanelId,
} from '@/features/meetings';

/** The utility actions (copy/export/download/delete audio) now live behind the
 *  header `...` menu (meetings audit items 7, 13). Open it the radix way. */
async function openActionsMenu() {
  const trigger = screen.getByTestId('meeting-entry-actions-menu');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
}

function makeWorkspace(
  opts: { notesExists?: boolean; existingExports?: string[] } = {}
) {
  const files = new Map<string, string>();
  files.set(
    '/ws/C/Meetings/x/meeting.json',
    JSON.stringify({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: {
        mode: 'one-party',
        confirmedBy: 'user',
        confirmedAt: '2026-07-04T10:00:00Z',
      },
    })
  );
  files.set(
    '/ws/C/Meetings/x/transcript.json',
    JSON.stringify({
      segments: [
        {
          startMs: 0,
          endMs: 1000,
          channel: 'mic',
          speaker: 'Advisor',
          text: 'Hello client.',
        },
      ],
    })
  );
  const ws = {
    readFile: vi.fn(async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error(`ENOENT: ${path}`);
      return value;
    }),
    readFileBinary: vi.fn(async (path: string) => {
      if (path.endsWith('audio.wav'))
        return new Uint8Array([80, 75, 3, 4]).buffer;
      if (path.endsWith('notes.docx'))
        return new Uint8Array([80, 75, 3, 4]).buffer;
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
  ...meetingEntryTestMount(),
  clientName: 'The Hendersons',
  workspaceRoot: '/ws',
  onBack: () => {},
};

describe('MeetingEntry R7 tabs, rename, and exports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firmState.current = { org: null, role: null };
    docxExtraction.current = {
      html: '<p>Summary body</p>',
      plainText: 'Summary body',
    };
  });

  it('does not show Word-native folder content without a sealed summary artifact', async () => {
    docxExtraction.current = {
      html: [
        '<h2>Action items</h2>',
        '<ul>',
        '<li>Start the rollover paperwork.</li>',
        '<li>Confirm every beneficiary designation.</li>',
        '</ul>',
        '<h2>Facts worth keeping</h2>',
        '<ul><li>The next review is in fall.</li></ul>',
      ].join(''),
      plainText: [
        'Action items',
        '',
        'Start the rollover paperwork.',
        '',
        'Confirm every beneficiary designation.',
        '',
        'Facts worth keeping',
        '',
        'The next review is in fall.',
      ].join('\n'),
    };
    const ws = makeWorkspace({ notesExists: true });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));

    expect(
      await screen.findByTestId('meeting-entry-summary-not-ready')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('notes-review-panel')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Start the rollover paperwork.')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('The next review is in fall.')
    ).not.toBeInTheDocument();
  });

  it('renders a registered panel contribution in the real host composition', async () => {
    // A dependent registers a panel through the public weave path.
    const unregister = registerMeetingPanel({
      id: 'agenda' as MeetingPanelId,
      order: 25,
      labelKey: 'meetings.woven.tab',
      mount: () => <div data-testid="agenda-body">woven contribution</div>,
    });
    try {
      // The outside host getter now includes the contribution...
      expect(
        getMeetingPanelComposition().panels.map((panel) => panel.id)
      ).toContain('agenda');

      const ws = makeWorkspace();
      setMeetingsWorkspaceService(ws as never);
      render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

      // ...and the real host actually renders that woven tab.
      expect(
        await screen.findByTestId('meeting-subtab-agenda')
      ).toBeInTheDocument();
      // The host-rendered tab order equals the outside composition order.
      const hostTabs = screen
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('data-testid'));
      expect(hostTabs).toEqual(
        getMeetingPanelComposition().panels.map(
          (panel) => `meeting-subtab-${panel.id}`
        )
      );
    } finally {
      unregister();
    }
    // After unregister the host is back to the base tabs.
    expect(
      getMeetingPanelComposition().panels.map((panel) => panel.id)
    ).not.toContain('agenda');
  });

  it('mounts speaker naming and firm templates together in the transcript tab', async () => {
    firmState.current = { org: { org_id: 'firm-1' }, role: 'admin' };
    const ws = makeWorkspace();

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    fireEvent.click(screen.getByTestId('meeting-subtab-transcript'));

    const speakerNames = await screen.findByTestId('speaker-names-panel');
    const templates = await screen.findByTestId('meeting-template-panel');
    expect(
      speakerNames.compareDocumentPosition(templates) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('keeps the two legacy content tabs and opens the merged send surface in a drawer', async () => {
    const ws = makeWorkspace({ notesExists: true });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    await waitFor(() =>
      expect(screen.getByTestId('notice-trail')).toBeInTheDocument()
    );

    const summaryTab = screen.getByTestId('meeting-subtab-summary');
    const transcriptTab = screen.getByTestId('meeting-subtab-transcript');
    expect([summaryTab, transcriptTab].map((tab) => tab.textContent)).toEqual([
      'Summary',
      'Transcript',
    ]);
    expect(
      screen.queryByTestId('meeting-subtab-recording')
    ).not.toBeInTheDocument();
    // Send left the tab row (item 1).
    expect(
      screen.queryByTestId('meeting-subtab-send-to-team')
    ).not.toBeInTheDocument();
    expect(
      summaryTab.compareDocumentPosition(transcriptTab) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // The merged send surface is not mounted until the drawer opens.
    expect(screen.queryByTestId('meeting-send-panel')).not.toBeInTheDocument();

    // Send is disabled until the meeting is reviewed.
    expect(screen.getByTestId('meeting-entry-send')).toBeDisabled();
    fireEvent.click(screen.getByTestId('meeting-entry-mark-reviewed'));
    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry-send')).toBeEnabled()
    );

    fireEvent.click(screen.getByTestId('meeting-entry-send'));
    await waitFor(() =>
      expect(screen.getByTestId('meeting-send-panel')).toBeInTheDocument()
    );
    // The review tabs stay mounted behind the drawer.
    expect(screen.getByTestId('meeting-summary-tab')).toBeInTheDocument();
  });

  it('shows the legacy content tabs; renames the meeting; exports transcript and Summary Word from the actions menu', async () => {
    const ws = makeWorkspace({ notesExists: true });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    expect(screen.queryByTestId('meeting-subtab-recording')).toBeNull();
    expect(screen.getByTestId('meeting-subtab-transcript')).toBeTruthy();
    expect(screen.getByTestId('meeting-subtab-summary')).toBeTruthy();

    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry-mark-reviewed')).toBeTruthy()
    );
    fireEvent.click(screen.getByTestId('meeting-title-rename'));
    fireEvent.change(screen.getByTestId('meeting-title-input'), {
      target: { value: 'Quarterly plan review' },
    });
    fireEvent.click(screen.getByTestId('meeting-title-save'));
    await waitFor(() => {
      const write = ws.writeFile.mock.calls.find(
        (c) => c[0] === '/ws/C/Meetings/x/meeting.json'
      );
      expect(write).toBeTruthy();
      expect(JSON.parse(write?.[1] as string).customTitle).toBe(
        'Quarterly plan review'
      );
    });

    await openActionsMenu();
    fireEvent.click(await screen.findByTestId('meeting-transcript-export'));
    await waitFor(() => {
      expect(ws.writeFile).toHaveBeenCalledWith(
        '/ws/C/Meetings/x/transcript.txt',
        expect.stringContaining('Advisor: Hello client.')
      );
    });

    await openActionsMenu();
    fireEvent.click(await screen.findByTestId('meeting-summary-export-docx'));
    await waitFor(() => {
      expect(ws.writeFileBinary).toHaveBeenCalledWith(
        '/ws/C/Documents/Quarterly plan review summary.docx',
        expect.any(ArrayBuffer)
      );
    });
  });

  it('does not copy or export a summary until real notes text exists', async () => {
    const ws = makeWorkspace({ notesExists: false });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry-notes-pending')).toBeTruthy()
    );

    await openActionsMenu();
    // Menu items are radix menuitems, disabled via aria-disabled, and clicking
    // them writes nothing.
    expect(await screen.findByTestId('meeting-summary-copy')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByTestId('meeting-summary-export-docx')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByTestId('meeting-summary-export-pdf')).toHaveAttribute(
      'aria-disabled',
      'true'
    );
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

    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry-actions-menu')).toBeTruthy()
    );
    await openActionsMenu();
    fireEvent.click(await screen.findByTestId('meeting-summary-export-docx'));

    await waitFor(() => {
      expect(ws.writeFileBinary).toHaveBeenCalledWith(
        '/ws/C/Documents/Meeting summary 2.docx',
        expect.any(ArrayBuffer)
      );
    });
  });

  it('exports Summary PDF without leaving an extra Word document in the client documents folder', async () => {
    const ws = makeWorkspace({ notesExists: true });
    setMeetingsWorkspaceService(ws as never);

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);

    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry-actions-menu')).toBeTruthy()
    );
    await openActionsMenu();
    fireEvent.click(await screen.findByTestId('meeting-summary-export-pdf'));

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

  it('keeps folder summaries hidden while clearing export state for a different meeting', async () => {
    const files = new Map<string, string>();
    files.set(
      '/ws/C/Meetings/A/meeting.json',
      JSON.stringify({
        matterId: 'm-1',
        startedAt: '2026-07-04T10:00:00Z',
        customTitle: 'Meeting A',
        consent: {
          mode: 'one-party',
          confirmedBy: 'user',
          confirmedAt: '2026-07-04T10:00:00Z',
        },
      })
    );
    files.set(
      '/ws/C/Meetings/A/transcript.json',
      JSON.stringify({
        segments: [
          {
            startMs: 0,
            endMs: 1000,
            channel: 'mic',
            speaker: 'Advisor',
            text: 'A transcript.',
          },
        ],
      })
    );
    files.set(
      '/ws/C/Meetings/B/meeting.json',
      JSON.stringify({
        matterId: 'm-1',
        startedAt: '2026-07-05T10:00:00Z',
        customTitle: 'Meeting B',
        consent: {
          mode: 'one-party',
          confirmedBy: 'user',
          confirmedAt: '2026-07-05T10:00:00Z',
        },
      })
    );
    const ws = {
      readFile: vi.fn(async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error(`missing ${path}`);
        return value;
      }),
      readFileBinary: vi.fn(async (path: string) => {
        if (path === '/ws/C/Meetings/A/notes.docx')
          return new Uint8Array([80, 75, 3, 4]).buffer;
        throw new Error(`missing binary ${path}`);
      }),
      exists: vi.fn(
        async (path: string) => path === '/ws/C/Meetings/A/notes.docx'
      ),
      writeFile: vi.fn(async () => {}),
      writeFileBinary: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    setMeetingsWorkspaceService(ws as never);

    const { rerender } = render(
      <MeetingEntry
        {...baseProps}
        {...meetingEntryTestMount('/ws/C/Meetings/A', 'A')}
        workspaceService={ws as never}
      />
    );
    fireEvent.click(screen.getByTestId('meeting-subtab-summary'));
    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry-summary-not-ready')).toBeTruthy()
    );
    expect(screen.queryByTestId('meeting-summary-text')).toBeNull();

    rerender(
      <MeetingEntry
        {...baseProps}
        {...meetingEntryTestMount('/ws/C/Meetings/B', 'B')}
        workspaceService={ws as never}
      />
    );

    // Meeting B has no notes: the summary export in the actions menu is disabled
    // and writes nothing. Neither meeting's folder summary enters the panel.
    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry-notes-pending')).toBeTruthy()
    );
    expect(screen.queryByTestId('meeting-summary-text')).toBeNull();
    await openActionsMenu();
    expect(
      await screen.findByTestId('meeting-summary-export-docx')
    ).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('meeting-summary-export-docx'));
    expect(ws.writeFileBinary).not.toHaveBeenCalled();
  });
});

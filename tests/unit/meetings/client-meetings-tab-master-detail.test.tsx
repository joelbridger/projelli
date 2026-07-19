import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClientMeetingsTab } from '@/features/meetings/ClientMeetingsTab';

const baseMeta = {
  matterId: 'm1',
  consent: {
    mode: 'one-party',
    confirmedBy: 'user',
    confirmedAt: '2026-07-04T10:00:00Z',
  },
};

function makeWorkspace() {
  const metas: Record<string, Record<string, unknown>> = {
    a: {
      ...baseMeta,
      startedAt: '2026-07-04T10:00:00Z',
      customTitle: 'Annual review',
    },
    b: {
      ...baseMeta,
      startedAt: '2026-07-05T10:00:00Z',
      customTitle: 'Roth planning',
    },
  };
  return {
    exists: vi.fn(async (path: string) => !path.endsWith('notes.docx')),
    list: vi.fn(async (path: string) => {
      if (path.endsWith('/Meetings')) {
        return [
          {
            name: 'a',
            path: 'C:/WS/Clients/Acme/Meetings/a',
            type: 'folder' as const,
          },
          {
            name: 'b',
            path: 'C:/WS/Clients/Acme/Meetings/b',
            type: 'folder' as const,
          },
        ];
      }
      return [
        {
          name: 'meeting.json',
          path: `${path}/meeting.json`,
          type: 'file' as const,
        },
        {
          name: 'transcript.json',
          path: `${path}/transcript.json`,
          type: 'file' as const,
        },
      ];
    }),
    readFile: vi.fn(async (path: string) => {
      const folder = path.includes('/Meetings/b/') ? 'b' : 'a';
      if (path.endsWith('meeting.json')) return JSON.stringify(metas[folder]);
      if (path.endsWith('transcript.json'))
        return JSON.stringify({ segments: [] });
      throw new Error('not present');
    }),
    writeFile: vi.fn(async () => {}),
    readFileBinary: vi.fn(async () => {
      throw new Error('not present');
    }),
    writeFileBinary: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
}

describe('ClientMeetingsTab — master-detail rail', () => {
  it('puts meetings in the left rail and shows the selected meeting detail on the right', async () => {
    render(
      <ClientMeetingsTab
        matterId="m1"
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={makeWorkspace() as never}
      />
    );

    await waitFor(() =>
      expect(screen.getAllByTestId('meeting-row')).toHaveLength(2)
    );

    expect(screen.getByRole('listbox', { name: 'Meetings' })).toBeVisible();
    const recordButton = screen.getByTestId('record-meeting-button');
    expect(recordButton).toHaveAttribute('aria-label', 'Record a meeting');
    expect(recordButton).toHaveTextContent('');

    await waitFor(() =>
      expect(screen.getByTestId('meeting-entry')).toBeVisible()
    );
    expect(screen.queryByTestId('meeting-entry-back')).toBeNull();
    expect(screen.queryByTestId('meeting-subtab-recording')).toBeNull();
    expect(screen.getByTestId('meeting-subtab-transcript')).toBeVisible();
    expect(screen.getByTestId('meeting-subtab-summary')).toBeVisible();
    // Send moved out of the tab row into a header action (meetings audit item 1).
    expect(screen.queryByTestId('meeting-subtab-send-to-team')).toBeNull();
    expect(screen.getByTestId('meeting-entry-send')).toBeVisible();

    await waitFor(() =>
      expect(
        within(screen.getByTestId('meeting-entry')).getByText('Roth planning')
      ).toBeVisible()
    );
    const rows = screen.getAllByTestId('meeting-row');
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByTestId('meeting-title-rename'));
    expect(screen.getByTestId('meeting-title-input')).toHaveValue(
      'Roth planning'
    );

    fireEvent.click(rows[1]!);
    await waitFor(() =>
      expect(screen.getAllByTestId('meeting-row')[1]).toHaveAttribute(
        'aria-selected',
        'true'
      )
    );
    expect(screen.queryByTestId('meeting-title-input')).toBeNull();
  });

  it('opens a direct requested meeting inside the rail with no embedded back arrow', async () => {
    render(
      <ClientMeetingsTab
        matterId="m1"
        matterFolder="C:/WS/Clients/Acme"
        workspaceService={makeWorkspace() as never}
        initialSelectedMeeting={{
          dir: 'C:/WS/Clients/Acme/Meetings/a',
          folderName: 'a',
          startMs: 45_000,
        }}
      />
    );

    await waitFor(() =>
      expect(screen.getByTestId('client-meetings-tab')).toBeVisible()
    );
    expect(screen.getByRole('listbox', { name: 'Meetings' })).toBeVisible();
    await waitFor(() =>
      expect(
        within(screen.getByTestId('meeting-entry')).getByText('Annual review')
      ).toBeVisible()
    );
    expect(screen.queryByTestId('meeting-entry-back')).toBeNull();
    expect(screen.getAllByTestId('meeting-row')[1]).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});

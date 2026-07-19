/**
 * QA-31 — once a notesError is recorded on meeting.json, MeetingEntry's notes
 * pane must show an honest, classified message + a working retry instead of
 * the generic "still generating" copy (which would otherwise read as an
 * eternal wait even though the pipeline already gave up).
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const { retryMeetingNotesMock } = vi.hoisted(() => ({ retryMeetingNotesMock: vi.fn(async () => {}) }));
vi.mock('@/features/meetings/meetingStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/meetings/meetingStore')>();
  return { ...actual, retryMeetingNotes: retryMeetingNotesMock };
});

vi.mock('@/platform/utils/docx-io', () => ({
  extractDocxText: vi.fn(async () => ({ html: '<p>Retried summary</p>', plainText: 'Retried summary' })),
  markdownToDocxBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  applyLetterheadIfConfigured: vi.fn(async (bytes: Uint8Array) => bytes),
}));

// MeetingEntry mounts DocxEditor via a real dynamic import(), unrelated to
// this test's actual subject (the pending/failed/notesError copy logic — no
// assertion here touches the rendered editor). Under full-suite parallelism
// that real import's transform competes with hundreds of other worker
// processes and can resolve slower than this test's waitFor window, which
// flips the assertion below flaky (`meeting-entry-notes-pending` still
// showing because `DocxEditorComp` hadn't loaded yet even though `hasNotes`
// had gone true). Mocking it makes the import resolve synchronously so the
// test only exercises the logic it's actually about.
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

describe('MeetingEntry — honest notes-failed state (QA-31)', () => {
  it('shows a generic-error message (NOT the timeout copy) when notesError.kind is "error", and retry calls retryMeetingNotes', async () => {
    retryMeetingNotesMock.mockClear();
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
      notesError: { kind: 'error', at: '2026-07-04T10:05:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    screen.getByTestId('meeting-subtab-summary').click();

    await waitFor(() => expect(screen.getByTestId('meeting-entry-notes-failed')).toBeTruthy());
    expect(screen.queryByTestId('meeting-entry-notes-pending')).toBeNull();
    // codex-review P3: a plain provider/docx error must not claim "didn't
    // respond in time" — that's specifically the timeout story.
    expect(screen.getByTestId('meeting-entry-notes-failed').textContent).not.toMatch(/respond in time/i);
    expect(screen.getByTestId('meeting-entry-notes-failed').textContent).toMatch(/returned an error/i);

    screen.getByTestId('meeting-entry-retry-notes').click();
    await waitFor(() => expect(retryMeetingNotesMock).toHaveBeenCalledWith('/ws/C/Meetings/x', 'm-1'));
  });

  it('shows the timeout-specific message (distinct from a generic error) when notesError.kind is "timeout"', async () => {
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
      notesError: { kind: 'timeout', at: '2026-07-04T10:05:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    screen.getByTestId('meeting-subtab-summary').click();

    await waitFor(() => expect(screen.getByTestId('meeting-entry-notes-failed')).toBeTruthy());
    expect(screen.getByTestId('meeting-entry-notes-failed').textContent).toMatch(/respond in time/i);
  });

  it('shows the confidentiality-gate-blocked copy (not a generic failure) when notesError.kind is "gate-blocked"', async () => {
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
      notesError: { kind: 'gate-blocked', at: '2026-07-04T10:05:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    screen.getByTestId('meeting-subtab-summary').click();

    await waitFor(() => expect(screen.getByTestId('meeting-entry-notes-failed')).toBeTruthy());
    const text = screen.getByTestId('meeting-entry-notes-failed').textContent ?? '';
    expect(text).toMatch(/local-only/i);

    // R3 (trust review): this message must not coach a confidentiality-anxious
    // advisor to downgrade their own privacy as the FIRST suggested fix. The
    // privacy-preserving option (connect a local model) must be offered before
    // "turn off Local-only mode".
    const localModelIdx = text.search(/connect a local model/i);
    const turnOffIdx = text.search(/turn off local-only mode/i);
    expect(localModelIdx).toBeGreaterThanOrEqual(0);
    expect(turnOffIdx).toBeGreaterThanOrEqual(0);
    expect(localModelIdx).toBeLessThan(turnOffIdx);
  });

  // Coordinator P2 (independent pass): a real notes.docx is BINARY. Reading it
  // with the text reader (readFile / readTextFile on Tauri) can throw on real
  // docx bytes even though the file is right there on disk — which, before
  // this fix, meant a SUCCESSFUL retry could still fall back to "notes are
  // being written" forever, recreating the exact confusion QA-31 fixed.
  it('flips to hasNotes and loads the summary text after a successful retry even though notes.docx cannot be decoded as text (binary content)', async () => {
    retryMeetingNotesMock.mockClear();
    let retried = false;
    retryMeetingNotesMock.mockImplementationOnce(async () => { retried = true; });

    const ws = {
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('meeting.json')) {
          return JSON.stringify({
            matterId: 'm-1',
            startedAt: '2026-07-04T10:00:00Z',
            consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
            ...(retried ? {} : { notesError: { kind: 'error', at: '2026-07-04T10:05:00Z' } }),
          });
        }
        if (path.endsWith('notes.docx')) throw new Error('stream did not contain valid UTF-8');
        throw new Error('not present');
      }),
      readFileBinary: vi.fn(async (path: string) => {
        if (retried && path.endsWith('notes.docx')) return new Uint8Array([80, 75, 3, 4]).buffer;
        throw new Error('no audio');
      }),
      exists: vi.fn(async (path: string) => retried && path.endsWith('notes.docx')),
      writeFile: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    screen.getByTestId('meeting-subtab-summary').click();
    await waitFor(() => expect(screen.getByTestId('meeting-entry-notes-failed')).toBeTruthy());

    screen.getByTestId('meeting-entry-retry-notes').click();

    await waitFor(() => {
      expect(screen.queryByTestId('meeting-entry-notes-pending')).toBeNull();
      expect(screen.queryByTestId('meeting-entry-notes-failed')).toBeNull();
      expect(screen.getByTestId('meeting-summary-text').textContent).toContain('Retried summary');
    });
  });

  it('drops a notes retry result when the advisor switches to another meeting before it finishes', async () => {
    retryMeetingNotesMock.mockClear();
    let retried = false;
    let resolveRetry!: () => void;
    retryMeetingNotesMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRetry = () => {
        retried = true;
        resolve();
      };
    }));

    const files = new Map<string, Record<string, unknown>>();
    files.set('/ws/C/Meetings/A/meeting.json', {
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      customTitle: 'Meeting A',
      notesError: { kind: 'error', at: '2026-07-04T10:05:00Z' },
    });
    files.set('/ws/C/Meetings/B/meeting.json', {
      matterId: 'm-1',
      startedAt: '2026-07-05T10:00:00Z',
      customTitle: 'Meeting B',
    });
    const ws = {
      readFile: vi.fn(async (path: string) => {
        const value = files.get(path);
        if (!value) throw new Error(`missing ${path}`);
        return JSON.stringify(value);
      }),
      readFileBinary: vi.fn(async (path: string) => {
        if (retried && path === '/ws/C/Meetings/A/notes.docx') return new Uint8Array([80, 75, 3, 4]).buffer;
        throw new Error(`missing binary ${path}`);
      }),
      exists: vi.fn(async (path: string) => retried && path === '/ws/C/Meetings/A/notes.docx'),
      writeFile: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };

    const { rerender } = render(
      <MeetingEntry {...baseProps} {...meetingEntryTestMount('/ws/C/Meetings/A', 'A')} workspaceService={ws as never} />,
    );
    screen.getByTestId('meeting-subtab-summary').click();
    await waitFor(() => expect(screen.getByTestId('meeting-entry-notes-failed')).toBeTruthy());

    screen.getByTestId('meeting-entry-retry-notes').click();
    rerender(
      <MeetingEntry {...baseProps} {...meetingEntryTestMount('/ws/C/Meetings/B', 'B')} workspaceService={ws as never} />,
    );
    await waitFor(() => expect(screen.getByTestId('meeting-entry-notes-pending')).toBeTruthy());

    await act(async () => { resolveRetry(); });

    await waitFor(() => {
      expect(screen.getByTestId('meeting-entry-notes-pending')).toBeTruthy();
      expect(screen.queryByTestId('meeting-entry-summary-not-ready')).toBeNull();
      expect(screen.queryByTestId('meeting-summary-text')).toBeNull();
    });
  });

  it('still shows the plain "still generating" copy when there is no notesError yet', async () => {
    const ws = makeWorkspace({
      matterId: 'm-1',
      startedAt: '2026-07-04T10:00:00Z',
      consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
    });

    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    screen.getByTestId('meeting-subtab-summary').click();

    await waitFor(() => expect(screen.getByTestId('meeting-entry-notes-pending')).toBeTruthy());
    expect(screen.queryByTestId('meeting-entry-notes-failed')).toBeNull();
  });
});

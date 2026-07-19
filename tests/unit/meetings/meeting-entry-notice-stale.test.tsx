/**
 * Coordinator P2 (independent pass): MeetingEntry is reused for different
 * meetings (a Client Map / Activity link opened while one is on screen). A
 * late-finishing notices read from the PREVIOUS meeting must never set state
 * for the meeting now displayed — a wrong-meeting verified/resolved/quarantined
 * trail is the one thing this compliance surface must not show. The fix clears
 * the trail on a meeting switch and guards the async result by a load token.
 */
import { render, screen, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// See meeting-entry-notes-failed.test.tsx: MeetingEntry's DocxEditor dynamic
// import is unrelated to this test's subject and flakes under full-suite
// parallel-transform contention. Mock it so the import resolves synchronously.
vi.mock('@/features/documents/media/DocxEditor', () => ({ DocxEditor: () => null }));

import { meetingEntryTestMount } from './meetingEntryTestMount';
import { MeetingEntry } from '@/features/meetings/MeetingEntry';
import type { NoticeEntry } from '@/features/meetings/noticeLedger';

const META = () => JSON.stringify({
  matterId: 'm-1',
  startedAt: '2026-07-04T10:00:00Z',
  consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:00:00Z' },
});

// The ledger for this client carries a VERIFIED entry for meeting A only.
const LEDGER = JSON.stringify({
  entries: [],
  notices: [
    { kind: 'verbal-notice-verified', meetingDir: '/ws/C/Meetings/A', at: 't', audioMs: 14000, snippet: 'I am recording this for my notes.', confidence: 0.9 } satisfies NoticeEntry,
  ],
});

const baseProps = {
  ...meetingEntryTestMount('/ws/C/Meetings/A', 'A'),
  clientName: 'The Hendersons',
  workspaceRoot: '/ws',
  onBack: () => {},
};

describe('MeetingEntry — cross-meeting notice staleness (coordinator P2)', () => {
  it('discards a slow notices read from the previous meeting after switching meetings', async () => {
    // Control the FIRST ledger read (meeting A's) so it resolves only after we
    // switch to meeting B. Later ledger reads resolve immediately.
    let releaseA: (v: string) => void = () => {};
    let ledgerReadCount = 0;

    const ws = {
      readFile: vi.fn((path: string) => {
        if (path.endsWith('meeting.json')) return Promise.resolve(META());
        if (path.endsWith('.consent-ledger.json')) {
          ledgerReadCount += 1;
          if (ledgerReadCount === 1) {
            return new Promise<string>((res) => { releaseA = res; }); // A's read — held open
          }
          return Promise.resolve(LEDGER); // B's read — resolves now
        }
        return Promise.reject(new Error('not present'));
      }),
      readFileBinary: vi.fn(() => Promise.reject(new Error('no audio'))),
      exists: vi.fn(() => Promise.resolve(false)),
      writeFile: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };

    const { rerender } = render(
      <MeetingEntry {...baseProps} workspaceService={ws as never} />,
    );
    // A's notice trail read is in flight (held). Switch to meeting B before it lands.
    await waitFor(() => expect(ledgerReadCount).toBeGreaterThanOrEqual(1));
    rerender(
      <MeetingEntry {...baseProps} {...meetingEntryTestMount('/ws/C/Meetings/B', 'B')} workspaceService={ws as never} />,
    );
    // B's (immediate, empty-for-B) read lands: no verified chip.
    await waitFor(() => expect(screen.queryByTestId('meeting-entry')).toBeTruthy());
    expect(screen.queryByTestId('notice-verified-chip')).toBeNull();

    // NOW let meeting A's slow read finish — it must be discarded, not shown under B.
    await act(async () => {
      releaseA(LEDGER);
      await Promise.resolve();
    });
    // A's verified chip must NOT appear while meeting B is on screen.
    await waitFor(() => expect(screen.getByTestId('notice-trail')).toBeTruthy());
    expect(screen.queryByTestId('notice-verified-chip')).toBeNull();
  });

  it('shows the verified chip for a meeting whose own read lands normally', async () => {
    const ws = {
      readFile: vi.fn((path: string) => {
        if (path.endsWith('meeting.json')) return Promise.resolve(META());
        if (path.endsWith('.consent-ledger.json')) return Promise.resolve(LEDGER);
        return Promise.reject(new Error('not present'));
      }),
      readFileBinary: vi.fn(() => Promise.reject(new Error('no audio'))),
      exists: vi.fn(() => Promise.resolve(false)),
      writeFile: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
    };
    render(<MeetingEntry {...baseProps} workspaceService={ws as never} />);
    await waitFor(() => expect(screen.getByTestId('notice-verified-chip')).toBeTruthy());
    expect(screen.getByTestId('notice-verified-chip').textContent).toContain('0:14');
  });
});

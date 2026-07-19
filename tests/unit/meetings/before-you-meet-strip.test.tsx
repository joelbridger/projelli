import '@/i18n';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toDocx = vi.fn(async () => new Uint8Array([1, 2, 3]));
const save = vi.fn(async () => undefined);
const agendaFromBrief = vi.fn<(...args: unknown[]) => Promise<string>>(
  async () => '## Topics to cover\n- x'
);
const listEvents = vi.fn<(...args: unknown[]) => Promise<unknown[]>>(
  async () => []
);
const generateBrief = vi.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({})
);
vi.mock('@/platform/utils/docx-io', () => ({ markdownToDocxBytes: toDocx }));
vi.mock('@/platform/utils/saveFile', () => ({ saveFile: save }));
vi.mock('@/platform/utils/calendar-commands', () => ({
  CALENDAR_SYNC_EVENT: 'calendar-sync-progress',
  calendarListEvents: (...a: unknown[]) => listEvents(...a),
}));
vi.mock('@/features/meetings/agendaExport', () => ({
  agendaMarkdownFromBrief: (...a: unknown[]) => agendaFromBrief(...a),
}));
// briefQueue.ts and briefStore.ts run FOR REAL in this test (not mocked) —
// that's the whole point of the regression test below: it needs the real
// enqueueBriefs skip-check to prove refresh() doesn't trip it. Only the
// leaf dependency (the actual headless AI call) is mocked.
vi.mock('@/features/meetings/generateBrief', () => ({
  generateMeetingBrief: (...a: unknown[]) => generateBrief(...a),
}));
vi.mock('@/features/meetings/foundation/contract', () => ({
  useActiveMeetingClientBoundary: () => ({
    householdRef: 'household-1',
    matterId: 'm-1',
  }),
}));

import { BeforeYouMeetStrip } from '@/features/meetings/BeforeYouMeetStrip';
import {
  briefKey,
  localDay,
  useBriefStore,
} from '@/features/meetings/briefStore';
import type { SealedMeetingClientBoundary } from '@/features/meetings';
import { useMatterStore } from '@/platform/matter/matterStore';

const clientBoundary = {
  householdRef: 'household-1',
  matterId: 'm-1',
} as SealedMeetingClientBoundary;

function keyFor(eventId = 'e1'): string {
  return briefKey({ clientBoundary, eventId, day: localDay() });
}

function openBrief(): void {
  fireEvent.click(screen.getByTestId('brief-collapse-toggle'));
}

function openBriefActions(): void {
  fireEvent.pointerDown(screen.getByTestId('brief-actions-menu'), {
    button: 0,
    ctrlKey: false,
  });
}

describe('BeforeYouMeetStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBriefStore.setState({ briefs: {} });
    useMatterStore.setState((s) => ({
      ...s,
      matters: [
        {
          id: 'm-1',
          name: 'Henderson',
          client: 'Kim Henderson',
          folderPaths: [],
          crmHouseholdKeys: [clientBoundary.householdRef],
          createdAt: '2024-01-01T00:00:00Z',
        },
      ],
    }));
  });

  it('renders nothing without a brief for this client today', () => {
    const { container } = render(<BeforeYouMeetStrip matterId="m-1" />);
    expect(
      container.querySelector('[data-testid="before-you-meet"]')
    ).toBeNull();
  });

  it('renders a ready brief with source chips and exports .docx', async () => {
    const key = keyFor();
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
          householdRef: clientBoundary.householdRef,
          matterId: 'm-1',
          day: localDay(),
          status: 'ready',
          stale: false,
          generatedAt: 'now',
          markdown: '# Briefing\n- Cash position discussed',
          citations: [{ path: '/ws/Henderson/estate-plan.pdf', score: 0.9 }],
          eventTitle: 'Retirement plan review',
        },
      },
    });
    render(<BeforeYouMeetStrip matterId="m-1" />);
    openBrief();
    expect(screen.getByTestId('before-you-meet').textContent).toContain(
      'Cash position'
    );
    expect(screen.getByText('estate-plan.pdf')).toBeTruthy();

    openBriefActions();
    fireEvent.click(screen.getByTestId('brief-export-docx'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(toDocx).toHaveBeenCalledWith(
      expect.stringContaining('Cash position'),
      expect.stringContaining('.docx'),
      expect.anything()
    );
  });

  it('renders per-bullet citation chips with a hover popover quoting the exact source line (P0 prototype fidelity)', () => {
    const key = keyFor();
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
          householdRef: clientBoundary.householdRef,
          matterId: 'm-1',
          day: localDay(),
          status: 'ready',
          stale: false,
          generatedAt: 'now',
          markdown: '# Briefing\n- Cash position discussed',
          citations: [{ path: '/ws/Henderson/estate-plan.pdf', score: 0.9 }],
          bullets: [
            {
              id: 'bullet-0',
              text: 'Robert turns 73 in November, so his first RMD is due by April 1.',
              sourcePath: '/ws/Henderson/2024-ira-statement.pdf',
              quote: 'Owner date of birth: 11/1953.',
            },
          ],
          eventTitle: 'Retirement plan review',
        },
      },
    });
    render(<BeforeYouMeetStrip matterId="m-1" />);
    openBrief();
    const bullets = screen.getByTestId('brief-bullets');
    expect(bullets.textContent).toContain('Robert turns 73 in November');
    expect(bullets.textContent).toContain('2024-ira-statement.pdf');
    expect(screen.getByTestId('cite-chip-popover').textContent).toContain(
      'Owner date of birth: 11/1953.'
    );
    // The per-bullet view replaces the old flat markdown-blob rendering.
    expect(screen.queryByText('estate-plan.pdf')).toBeNull();
  });

  it('falls back to the flat markdown + citation row when bullets is empty (degraded generation, or a pre-existing persisted brief)', () => {
    const key = keyFor();
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
          householdRef: clientBoundary.householdRef,
          matterId: 'm-1',
          day: localDay(),
          status: 'ready',
          stale: false,
          generatedAt: 'now',
          markdown: '# Briefing\n- Cash position discussed',
          citations: [{ path: '/ws/Henderson/estate-plan.pdf', score: 0.9 }],
          bullets: [],
          eventTitle: 'Retirement plan review',
        },
      },
    });
    render(<BeforeYouMeetStrip matterId="m-1" />);
    openBrief();
    expect(screen.queryByTestId('brief-bullets')).toBeNull();
    expect(screen.getByTestId('before-you-meet').textContent).toContain(
      'Cash position'
    );
    expect(screen.getByText('estate-plan.pdf')).toBeTruthy();
  });

  it('shows the stale chip and collapses', () => {
    const key = keyFor();
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
          householdRef: clientBoundary.householdRef,
          matterId: 'm-1',
          day: localDay(),
          status: 'ready',
          stale: true,
          generatedAt: 'now',
          markdown: '# B',
          citations: [],
          eventTitle: 'Review',
        },
      },
    });
    render(<BeforeYouMeetStrip matterId="m-1" />);
    openBrief();
    expect(screen.getByTestId('brief-stale-chip')).toBeTruthy();
    fireEvent.click(screen.getByTestId('brief-collapse-toggle'));
    expect(screen.queryByText('# B')).toBeNull();
  });

  it('exports the client-facing agenda via a second button', async () => {
    const key = keyFor();
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
          householdRef: clientBoundary.householdRef,
          matterId: 'm-1',
          day: localDay(),
          status: 'ready',
          stale: false,
          generatedAt: 'now',
          markdown: '# Briefing\n- Cash position discussed',
          citations: [],
          eventTitle: 'Retirement plan review',
        },
      },
    });
    render(<BeforeYouMeetStrip matterId="m-1" />);
    openBrief();
    openBriefActions();
    fireEvent.click(screen.getByTestId('agenda-export-docx'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(agendaFromBrief).toHaveBeenCalledTimes(1);
    expect(toDocx).toHaveBeenCalledWith(
      '## Topics to cover\n- x',
      expect.stringContaining('Agenda'),
      expect.anything()
    );
  });

  it('Refresh actually regenerates the brief, not stuck at "Preparing..." forever', async () => {
    // COORDINATOR FINDING (P2): refresh() used to upsert status: 'pending'
    // BEFORE calling enqueueBriefs — but enqueueBriefs' own skip-check reads
    // the store and skips any job whose existing status is already
    // pending/generating, so the brief would freeze on "Preparing your
    // briefing…" forever. This test uses the REAL briefQueue.ts/briefStore.ts
    // (not mocked) so that real skip-check actually runs; only the leaf
    // generateMeetingBrief call is mocked.
    const key = keyFor();
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
          householdRef: clientBoundary.householdRef,
          matterId: 'm-1',
          day: localDay(),
          status: 'ready',
          stale: false,
          generatedAt: 'then',
          markdown: '# Old briefing',
          citations: [],
          eventTitle: 'Retirement plan review',
        },
      },
    });
    listEvents.mockResolvedValue([
      {
        id: 'e1',
        provider: 'outlook',
        title: 'Retirement plan review',
        startUtc: '2026-07-02T16:00:00Z',
        endUtc: '2026-07-02T17:00:00Z',
        attendees: [],
        organizerEmail: '',
      },
    ]);
    generateBrief.mockResolvedValue({
      markdown: '# New briefing',
      citations: [],
      generatedAt: 'now',
    });

    render(<BeforeYouMeetStrip matterId="m-1" />);
    openBrief();
    openBriefActions();
    fireEvent.click(screen.getByTestId('brief-refresh'));

    await waitFor(() => expect(generateBrief).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const brief = useBriefStore.getState().briefs[key];
      expect(brief?.status).toBe('ready');
      expect(brief?.markdown).toBe('# New briefing');
    });
  });
});

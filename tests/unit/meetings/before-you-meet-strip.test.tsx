import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toDocx = vi.fn(async () => new Uint8Array([1, 2, 3]));
const save = vi.fn(async () => undefined);
vi.mock('@/platform/utils/docx-io', () => ({ markdownToDocxBytes: toDocx }));
vi.mock('@/platform/utils/saveFile', () => ({ saveFile: save }));
vi.mock('@/platform/utils/calendar-commands', () => ({
  CALENDAR_SYNC_EVENT: 'calendar-sync-progress',
  calendarListEvents: vi.fn(async () => []),
}));

import { BeforeYouMeetStrip } from '@/features/meetings/BeforeYouMeetStrip';
import {
  briefKey,
  localDay,
  useBriefStore,
} from '@/features/meetings/briefStore';

describe('BeforeYouMeetStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBriefStore.setState({ briefs: {} });
  });

  it('renders nothing without a brief for this client today', () => {
    const { container } = render(<BeforeYouMeetStrip matterId="m-1" />);
    expect(
      container.querySelector('[data-testid="before-you-meet"]')
    ).toBeNull();
  });

  it('renders a ready brief with source chips and exports .docx', async () => {
    const key = briefKey(localDay(), 'e1', 'm-1');
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
          matterId: 'm-1',
          day: localDay(),
          status: 'ready',
          stale: false,
          generatedAt: 'now',
          markdown: '# Briefing\n- Cash position discussed',
          citations: [{ path: '/ws/Henderson/estate-plan.pdf', score: 0.9 }],
        },
      },
    });
    render(<BeforeYouMeetStrip matterId="m-1" />);
    expect(screen.getByTestId('before-you-meet').textContent).toContain(
      'Cash position'
    );
    expect(screen.getByText('estate-plan.pdf')).toBeTruthy();

    fireEvent.click(screen.getByTestId('brief-export-docx'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(toDocx).toHaveBeenCalledWith(
      expect.stringContaining('Cash position'),
      expect.stringContaining('.docx'),
      expect.anything()
    );
  });

  it('shows the stale chip and collapses', () => {
    const key = briefKey(localDay(), 'e1', 'm-1');
    useBriefStore.setState({
      briefs: {
        [key]: {
          key,
          eventId: 'e1',
          matterId: 'm-1',
          day: localDay(),
          status: 'ready',
          stale: true,
          generatedAt: 'now',
          markdown: '# B',
          citations: [],
        },
      },
    });
    render(<BeforeYouMeetStrip matterId="m-1" />);
    expect(screen.getByTestId('brief-stale-chip')).toBeTruthy();
    fireEvent.click(screen.getByTestId('brief-collapse-toggle'));
    expect(screen.queryByText('# B')).toBeNull();
  });
});

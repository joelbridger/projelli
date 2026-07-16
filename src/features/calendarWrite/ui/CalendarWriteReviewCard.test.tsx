import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CalendarWriteQueue } from '../useCalendarWrite';
import type { CalendarWriteProposal } from '../types';

// Drive the flag on/off, and spy on the container hook so we can prove the dark
// surface never runs it (no store read, no grant load, no egress).
const { useFlag } = vi.hoisted(() => ({ useFlag: vi.fn() }));
const { useCalendarWrite } = vi.hoisted(() => ({ useCalendarWrite: vi.fn() }));

vi.mock('@/platform/flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/platform/flags')>()),
  useFlag,
}));
vi.mock('../useCalendarWrite', () => ({ useCalendarWrite }));

// i18n: return the key so assertions are copy-independent.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { CalendarWriteReviewCard } from './CalendarWriteReviewCard';
import { CalendarWritePendingBanner } from './CalendarWritePendingBanner';

function queue(overrides: Partial<CalendarWriteQueue> = {}): CalendarWriteQueue {
  return {
    proposals: [],
    pendingCount: 0,
    refresh: vi.fn(),
    approve: vi.fn(),
    resolvePending: vi.fn(),
    ...overrides,
  };
}

const preparedProposal: CalendarWriteProposal = {
  id: 'p1',
  kind: 'create',
  provider: 'outlook',
  targetCalendarId: 'cal-home',
  status: 'prepared',
  idempotencyKey: 'abcdef0123456789abcdef0123456789',
  event: {
    title: 'Client review',
    startUtc: '2026-02-01T15:00:00Z',
    endUtc: '2026-02-01T15:30:00Z',
    displayTimezone: 'America/New_York',
    allDay: false,
    location: null,
    notes: null,
  },
  grantVersion: 2,
  createdAtUtc: '2026-02-01T00:00:00Z',
  updatedAtUtc: '2026-02-01T00:00:00Z',
};

beforeEach(() => {
  useFlag.mockReset();
  useCalendarWrite.mockReset();
  useCalendarWrite.mockReturnValue(queue());
});

describe('CalendarWriteReviewCard — flag-off inert', () => {
  it('renders nothing AND never runs the container hook when the flag is off', () => {
    useFlag.mockReturnValue(false);
    const { container } = render(<CalendarWriteReviewCard />);
    expect(screen.queryByTestId('calendar-write-review-card')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement(); // no phantom layout gap
    expect(useCalendarWrite).not.toHaveBeenCalled(); // zero side-effects
  });

  it('renders the review card with a prepared proposal when the flag is on', () => {
    useFlag.mockReturnValue(true);
    useCalendarWrite.mockReturnValue(queue({ proposals: [preparedProposal] }));
    render(<CalendarWriteReviewCard />);
    expect(screen.getByTestId('calendar-write-review-card')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-write-approve')).toBeInTheDocument();
  });

  it('renders nothing (no card) when the flag is on but nothing is reviewable', () => {
    useFlag.mockReturnValue(true);
    useCalendarWrite.mockReturnValue(queue({ proposals: [] }));
    render(<CalendarWriteReviewCard />);
    expect(screen.queryByTestId('calendar-write-review-card')).not.toBeInTheDocument();
  });
});

describe('CalendarWritePendingBanner — flag-off inert', () => {
  it('renders nothing and never runs the hook when the flag is off', () => {
    useFlag.mockReturnValue(false);
    const { container } = render(<CalendarWritePendingBanner onReviewNow={() => {}} />);
    expect(screen.queryByTestId('calendar-write-pending-banner')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
    expect(useCalendarWrite).not.toHaveBeenCalled();
  });

  it('shows the pending count when the flag is on and work is pending', () => {
    useFlag.mockReturnValue(true);
    useCalendarWrite.mockReturnValue(queue({ pendingCount: 3 }));
    render(<CalendarWritePendingBanner onReviewNow={() => {}} />);
    expect(screen.getByTestId('calendar-write-pending-banner')).toBeInTheDocument();
  });

  it('is inert when nothing is pending even with the flag on', () => {
    useFlag.mockReturnValue(true);
    useCalendarWrite.mockReturnValue(queue({ pendingCount: 0 }));
    render(<CalendarWritePendingBanner onReviewNow={() => {}} />);
    expect(screen.queryByTestId('calendar-write-pending-banner')).not.toBeInTheDocument();
  });
});

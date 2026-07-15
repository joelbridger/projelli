import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormActivitySurface } from './FormActivitySurface';

let enabled = true;
let liveState: {
  records: readonly Record<string, unknown>[];
  error: string | null;
} = {
  records: [],
  error: null,
};

vi.mock('@/platform/flags', () => ({ useFlag: () => enabled }));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => liveState,
}));

const activityRecords = [
  { id: 'form-1', kind: 'intakeLink', name: 'Annual review' },
  { id: 'household-1', kind: 'household', name: 'Chen household' },
  {
    id: 'submission-1',
    kind: 'intakeSubmission',
    intakeLinkId: 'form-1',
    audience: 'client-facing',
    submittedAt: '2026-07-15T14:00:00Z',
    payload: { values: { full_name: 'Avery Chen' } },
    matchingDecisions: {
      linked: {
        decision: 'match',
        decidedAt: '2026-07-15T14:01:00Z',
        householdRef: { id: 'household-1' },
      },
    },
  },
  {
    id: 'submission-2',
    kind: 'intakeSubmission',
    intakeLinkId: 'form-1',
    audience: 'internal',
    submittedAt: '2026-07-14T14:00:00Z',
    payload: { values: { email: 'advisor@example.com' } },
    matchingDecisions: {},
  },
];

describe('FormActivitySurface', () => {
  beforeEach(() => {
    enabled = true;
    liveState = { records: activityRecords, error: null };
  });

  it('renders readable rows with search and firm-wide filters, without team activity controls', () => {
    render(<FormActivitySurface />);

    expect(
      screen.getByTestId('form-activity-row-submission-1')
    ).toHaveTextContent(/Annual review/);
    expect(
      screen.getByTestId('form-activity-row-submission-1')
    ).toHaveTextContent(/Avery Chen/);
    expect(
      screen.getByRole('link', { name: 'Chen household' })
    ).toHaveAttribute('href', '#contact-household-1');
    expect(
      screen.queryByRole('button', { name: /post update|reply|react/i })
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('form-activity-search'), {
      target: { value: 'advisor' },
    });
    expect(
      screen.queryByTestId('form-activity-row-submission-1')
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('form-activity-row-submission-2')
    ).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('form-activity-status-filter'), {
      target: { value: 'matched' },
    });
    expect(screen.getByTestId('form-activity-empty')).toBeInTheDocument();
  });

  it('shows safe empty and error states and stays absent while the flag is off', () => {
    liveState = { records: [], error: null };
    const { rerender } = render(<FormActivitySurface />);
    expect(screen.getByTestId('form-activity-empty')).toHaveTextContent(
      /No form submissions/i
    );

    liveState = { records: [], error: 'offline' };
    rerender(<FormActivitySurface />);
    expect(screen.getByTestId('form-activity-error')).toHaveTextContent(
      /couldn't load/i
    );

    enabled = false;
    rerender(<FormActivitySurface />);
    expect(
      screen.queryByTestId('form-activity-surface')
    ).not.toBeInTheDocument();
  });
});

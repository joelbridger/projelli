import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormActivitySurface } from './FormActivitySurface';

const mocks = vi.hoisted(() => ({
  useLiveCrmRecords: vi.fn(),
}));

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
  useLiveCrmRecords: mocks.useLiveCrmRecords,
}));

const activityRecords = [
  {
    id: 'form-1',
    kind: 'intakeLink',
    matterId: 'firm_home',
    name: 'Annual review',
    audience: 'client-facing',
    fields: {
      client_name: {
        id: 'client_name',
        label: 'Full name',
        kind: 'text',
        required: true,
      },
      client_email: {
        id: 'client_email',
        label: 'Email address',
        kind: 'email',
        required: true,
      },
      account_number: {
        id: 'account_number',
        label: 'Account number',
        kind: 'text',
        required: true,
      },
      social_security_number: {
        id: 'social_security_number',
        label: 'Social Security number',
        kind: 'text',
        required: true,
      },
      home_address: {
        id: 'home_address',
        label: 'Home address',
        kind: 'textarea',
        required: true,
      },
    },
    confirmationCopy: 'Thank you.',
    status: 'active',
  },
  { id: 'household-1', kind: 'household', name: 'Chen household' },
  {
    id: 'submission-1',
    kind: 'intakeSubmission',
    intakeLinkId: 'form-1',
    audience: 'client-facing',
    submittedAt: '2026-07-15T14:00:00Z',
    payload: { values: { client_name: 'Avery Chen' } },
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
    payload: { values: { client_email: 'advisor@example.com' } },
    matchingDecisions: {},
  },
  {
    id: 'submission-sensitive-only',
    kind: 'intakeSubmission',
    intakeLinkId: 'form-1',
    audience: 'client-facing',
    submittedAt: '2026-07-13T14:00:00Z',
    payload: {
      values: {
        account_number: '001234567890',
        social_security_number: '123-45-6789',
        home_address: '42 Pine Street, Hartford, CT 06103',
      },
    },
    matchingDecisions: {},
  },
];

describe('FormActivitySurface', () => {
  beforeEach(() => {
    enabled = true;
    liveState = { records: activityRecords, error: null };
    mocks.useLiveCrmRecords.mockReset();
    mocks.useLiveCrmRecords.mockImplementation(() => liveState);
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
      screen.getByTestId('form-activity-row-submission-sensitive-only')
    ).toHaveTextContent(/Not provided/);
    expect(
      screen.getByTestId('form-activity-row-submission-sensitive-only')
    ).not.toHaveTextContent('001234567890');
    expect(document.body).not.toHaveTextContent('123-45-6789');
    expect(document.body).not.toHaveTextContent('42 Pine Street, Hartford, CT 06103');
    expect(screen.getByText('Chen household')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Chen household' })
    ).not.toBeInTheDocument();
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

  it('shows safe empty and error states', () => {
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
  });

  it('does not start the live CRM reader while the flag is off', () => {
    enabled = false;
    render(<FormActivitySurface />);

    expect(
      screen.queryByTestId('form-activity-surface')
    ).not.toBeInTheDocument();
    expect(mocks.useLiveCrmRecords).not.toHaveBeenCalled();
  });
});

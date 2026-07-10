import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useIntakeStore, type IntakeRecord } from '@/platform/intake/intakeStore';
import { ClientRequestsTab } from '../ClientRequestsTab';

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactList: vi.fn(() => Promise.resolve([])), intakeFactReveal: vi.fn(), intakeFactPurge: vi.fn(), intakeFactUpsert: vi.fn(), intakeFactMatchList: vi.fn(() => Promise.resolve([])),
}));

function intake(overrides: Partial<IntakeRecord>): IntakeRecord {
  return {
    intakeId: overrides.intakeId ?? 'request-1', matterId: 'matter-1', clientFirstName: 'Sarah', firmName: 'North Star',
    status: 'active', link: 'https://forms.example.test/i/request#secret', expiresAt: '2026-08-09T00:00:00.000Z', checklistVersion: 1,
    items: [{ itemId: 'item', label: 'Safe label', state: 'not_started' }], receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [], ...overrides,
  };
}

describe('ClientRequestsTab', () => {
  beforeEach(() => { useIntakeStore.getState().resetForTests(); });

  it('pins onboarding first, keeps each request independent, and opens the request composer', () => {
    const store = useIntakeStore.getState();
    store.upsertIntake(intake({ intakeId: 'standing-old', kind: 'standing', requestTitle: 'Tax return', createdAt: '2026-07-01T00:00:00.000Z', receivedItems: [{ itemId: 'tax', label: 'Tax return', receivedAt: '2026-07-02T00:00:00.000Z', provenance: { channel: 'intake_link', label: 'typed by client', at: '2026-07-02T00:00:00.000Z' } }] }));
    store.upsertIntake(intake({ intakeId: 'onboarding', kind: 'onboarding', requestTitle: 'New client onboarding', createdAt: '2026-07-03T00:00:00.000Z' }));
    store.upsertIntake(intake({ intakeId: 'standing-new', kind: 'standing', requestTitle: 'Beneficiary update', createdAt: '2026-07-04T00:00:00.000Z' }));
    const onRevoke = vi.fn((intakeId: string) => { store.updateIntake(intakeId, { status: 'revoked' }); });

    render(<ClientRequestsTab matterId="matter-1" clientName="Sarah Smith" issueRequest={vi.fn()} onRevoke={onRevoke} activeRequestId="standing-new" />);
    expect(screen.getAllByTestId(/^client-request-/).filter((node) => node.getAttribute('data-testid')?.startsWith('client-request-') && !node.getAttribute('data-testid')?.startsWith('client-request-detail-')).map((node) => node.getAttribute('data-testid'))).toEqual([
      'client-request-onboarding', 'client-request-standing-old', 'client-request-standing-new',
    ]);
    expect(screen.getByTestId('client-request-standing-new').getAttribute('data-selected')).toBe('true');
    expect(within(screen.getByTestId('client-request-standing-old')).getAllByText('Tax return').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('client-request-onboarding')).queryByText('Tax return')).toBeNull();

    fireEvent.click(within(screen.getByTestId('client-request-standing-new')).getByTestId('link-action-revoke'));
    expect(onRevoke).toHaveBeenCalledWith('standing-new');
    expect(onRevoke).not.toHaveBeenCalledWith('onboarding');
    expect(useIntakeStore.getState().intakesById['onboarding']?.status).toBe('active');
    expect(useIntakeStore.getState().intakesById['standing-new']?.status).toBe('revoked');

    fireEvent.click(screen.getByRole('button', { name: /request from client/i }));
    expect(screen.getByTestId('request-from-client-dialog')).toBeTruthy();
  });
});

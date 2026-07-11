import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useIntakeStore,
  type IntakeRecord,
} from '@/platform/intake/intakeStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { ClientRequestsTab } from '../ClientRequestsTab';
import { RequestsBoard } from '../RequestsBoard';

vi.mock('@/platform/intake/factsStore', () => ({
  intakeFactList: vi.fn(() => Promise.resolve([])),
  intakeFactReveal: vi.fn(),
  intakeFactPurge: vi.fn(),
  intakeFactUpsert: vi.fn(),
  intakeFactMatchList: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/platform/intake/emailReplyProposalStore', () => ({
  emailReplyProposalList: vi.fn(() => Promise.resolve([])),
  isEmailReplyProposalItemSelectable: vi.fn(() => true),
}));

vi.mock('@/platform/intake/emailQuarantineStore', () => ({
  listEmailQuarantines: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@/platform/intake/documentExtractionProposalStore', () => ({
  documentExtractionProposalList: vi.fn(() => Promise.resolve([])),
}));

const now = new Date('2026-07-10T12:00:00.000Z');

function record(overrides: Partial<IntakeRecord>): IntakeRecord {
  return {
    intakeId: overrides.intakeId ?? 'request-fixture',
    matterId: overrides.matterId ?? 'fixture-matter-annual',
    kind: overrides.kind ?? 'onboarding',
    requestTitle: overrides.requestTitle ?? 'New client onboarding',
    requestSlug: overrides.requestSlug ?? 'onboarding',
    clientFirstName: 'Demo Client',
    firmName: 'Synthetic Harbor Advisory',
    status: 'active',
    link: 'https://forms.synthetic.invalid/i/fixture#synthetic-secret',
    expiresAt: '2026-08-09T00:00:00.000Z',
    checklistVersion: 1,
    requestItems: overrides.requestItems ?? [
      {
        t: 'typed_field',
        item_id: 'fixture-beneficiary',
        label: 'Beneficiary check',
        help_text: '',
        required: true,
        subject: 'primary',
        fact_kind: 'beneficiary',
        input: 'text',
      },
    ],
    items: overrides.items ?? [
      {
        itemId: 'fixture-beneficiary',
        label: 'Beneficiary check',
        state: 'not_started',
      },
    ],
    receivedItems: overrides.receivedItems ?? [],
    flags: overrides.flags ?? [],
    knownSessionIds: [],
    knownSubmissionIds: [],
    nudges: [],
    ...overrides,
  };
}

describe('Requests board and client Requests tab integration', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    useMatterStore.setState({
      clientMapHubTab: null,
      clientMapHubRequestId: null,
    });
  });

  it('6. renders one onboarding and one standing request independently, navigates each exact request, and scopes link controls', () => {
    const store = useIntakeStore.getState();
    const onboarding = record({
      intakeId: 'onboarding-fixture-ui',
      kind: 'onboarding',
      requestTitle: 'New client onboarding',
      requestSlug: 'onboarding',
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    const standing = record({
      intakeId: 'standing-fixture-ui',
      kind: 'standing',
      requestTitle: 'Annual review update',
      requestSlug: 'request-fixture-annual',
      createdAt: '2026-07-02T00:00:00.000Z',
    });
    store.upsertIntake(onboarding);
    store.upsertIntake(standing);

    expect(
      store
        .getIntakesForMatter('fixture-matter-annual')
        .map((intake) => intake.intakeId)
    ).toEqual(['onboarding-fixture-ui', 'standing-fixture-ui']);

    const onRevoke = vi.fn((intakeId: string) => {
      store.updateIntake(intakeId, { status: 'revoked' });
    });
    const renderSurface = (activeRequestId: string | null) =>
      render(
        <>
          <RequestsBoard now={now} />
          <ClientRequestsTab
            matterId="fixture-matter-annual"
            clientName="Demo Client"
            issueRequest={vi.fn()}
            activeRequestId={activeRequestId}
            onRevoke={onRevoke}
          />
        </>
      );
    const view = renderSurface(null);

    expect(
      screen
        .getAllByTestId(/^requests-board-row-/)
        .map((row) => row.getAttribute('data-testid'))
    ).toEqual(['requests-board-row-onboarding-fixture-ui']);
    fireEvent.click(screen.getByTestId('requests-filter-all'));
    expect(
      screen
        .getAllByTestId(/^requests-board-row-/)
        .map((row) => row.getAttribute('data-testid'))
    ).toEqual(
      expect.arrayContaining([
        'requests-board-row-onboarding-fixture-ui',
        'requests-board-row-standing-fixture-ui',
      ])
    );

    fireEvent.click(
      screen.getByTestId('onboarding-board-row-standing-fixture-ui')
    );
    expect(useMatterStore.getState().clientMapHubTab).toBe('onboarding');
    expect(useMatterStore.getState().clientMapHubRequestId).toBe(
      'standing-fixture-ui'
    );
    view.rerender(
      <>
        <RequestsBoard now={now} />
        <ClientRequestsTab
          matterId="fixture-matter-annual"
          clientName="Demo Client"
          issueRequest={vi.fn()}
          activeRequestId={useMatterStore.getState().clientMapHubRequestId}
          onRevoke={onRevoke}
        />
      </>
    );
    expect(
      screen
        .getByTestId('client-request-standing-fixture-ui')
        .getAttribute('data-selected')
    ).toBe('true');

    fireEvent.click(
      screen.getByTestId('onboarding-board-row-onboarding-fixture-ui')
    );
    expect(useMatterStore.getState().clientMapHubRequestId).toBe(
      'onboarding-fixture-ui'
    );
    view.rerender(
      <>
        <RequestsBoard now={now} />
        <ClientRequestsTab
          matterId="fixture-matter-annual"
          clientName="Demo Client"
          issueRequest={vi.fn()}
          activeRequestId={useMatterStore.getState().clientMapHubRequestId}
          onRevoke={onRevoke}
        />
      </>
    );
    expect(
      screen
        .getByTestId('client-request-onboarding-fixture-ui')
        .getAttribute('data-selected')
    ).toBe('true');

    fireEvent.click(
      within(
        screen.getByTestId('client-request-standing-fixture-ui')
      ).getByTestId('link-action-revoke')
    );
    expect(onRevoke).toHaveBeenCalledWith('standing-fixture-ui');
    expect(onRevoke).not.toHaveBeenCalledWith('onboarding-fixture-ui');
    expect(
      useIntakeStore.getState().intakesById['standing-fixture-ui']?.status
    ).toBe('revoked');
    expect(
      useIntakeStore.getState().intakesById['onboarding-fixture-ui']?.status
    ).toBe('active');
  });
});

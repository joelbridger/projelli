import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const audit = vi.hoisted(() => ({ emitAuditEntry: vi.fn() }));
const privateFacts = vi.hoisted(() => ({
  listMasked: vi.fn().mockResolvedValue([]),
  reveal: vi.fn(),
}));
vi.mock('@/features/audit', () => ({ emitAuditEntry: audit.emitAuditEntry }));
vi.mock('../private-facts', () => ({
  schwabPrivateFacts: {
    listMasked: privateFacts.listMasked,
    reveal: privateFacts.reveal,
  },
}));
import { SchwabPrefillReview } from './SchwabPrefillReview';
import type { SchwabHousehold } from '../mapping';

const household: SchwabHousehold = {
  id: 'h-review',
  name: 'Taylor family',
  facts: [],
  members: [
    {
      id: 'p',
      name: 'Pat Taylor',
      personType: 'person',
      roles: [],
      relatedHouseholds: 1,
      addresses: [
        {
          id: 'a',
          address: '1 Main',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
          kind: 'home',
          primary: true,
        },
      ],
      emails: [
        { id: 'e', address: 'pat@example.test', kind: 'home', primary: true },
      ],
      phones: [{ id: 'p', address: '555', kind: 'mobile', primary: true }],
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  audit.emitAuditEntry.mockReset();
  privateFacts.listMasked.mockReset();
  privateFacts.listMasked.mockResolvedValue([]);
  privateFacts.reveal.mockReset();
});
async function completeRequiredFields(): Promise<void> {
  for (const name of [
    'Owner name',
    'Date of birth',
    'Social Security number',
    'Address',
    'Email',
    'Phone',
    'Funding source',
  ]) {
    const input = screen.getByLabelText(name);
    if (!(input instanceof HTMLInputElement))
      throw new Error('Required field did not render as a text input.');
    if (!input.value) {
      fireEvent.change(input, { target: { value: 'ready' } });
      await waitFor(() => {
        expect(input).toHaveValue('ready');
      });
    }
  }
  for (const checkbox of screen.getAllByRole('checkbox')) {
    const input = checkbox as HTMLInputElement;
    if (!input.disabled) fireEvent.click(input);
  }
}
const privateSsnFact = {
  fact_id: 'owner-ssn',
  matter_id: household.id,
  subject: 'primary',
  kind: 'ssn' as const,
  sensitivity: 'restricted' as const,
  display_value: '•••-••-1234',
  provenance: {
    channel: 'manual' as const,
    entered_by: 'advisor',
    at: '2026-07-16',
  },
  verification: 'advisor_confirmed' as const,
  status: 'active' as const,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve(value);
    },
  };
}
describe('Schwab review approval', () => {
  it('reports an audit stall and does not create a receipt', async () => {
    audit.emitAuditEntry.mockRejectedValue(new Error('writer unavailable'));
    render(<SchwabPrefillReview household={household} />);
    await screen.findByLabelText('Owner name');
    await completeRequiredFields();
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve local prep packet' })
    );
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'durable audit record'
      );
    });
    expect(
      screen.queryByTestId('schwab-prefill-receipt')
    ).not.toBeInTheDocument();
  });
  it('waits for audit persistence before it creates the local receipt', async () => {
    audit.emitAuditEntry.mockResolvedValue({ id: 'audit-1' });
    render(<SchwabPrefillReview household={household} />);
    await screen.findByLabelText('Owner name');
    await completeRequiredFields();
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve local prep packet' })
    );
    await screen.findByTestId('schwab-prefill-receipt');
    expect(audit.emitAuditEntry).toHaveBeenCalledOnce();
  });
  it('allows approval with blank optional fields', async () => {
    audit.emitAuditEntry.mockResolvedValue({ id: 'audit-optional' });
    render(<SchwabPrefillReview household={household} />);
    await screen.findByLabelText('Owner name');
    expect(screen.getByLabelText('Beneficiaries')).toHaveValue('');
    await completeRequiredFields();
    expect(screen.getByLabelText('Beneficiaries')).toHaveValue('');
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve local prep packet' })
    );
    await expect(
      screen.findByTestId('schwab-prefill-receipt')
    ).resolves.toBeInTheDocument();
  });
  it('reveals a private value only on demand and clears it across the session lifecycle', async () => {
    privateFacts.listMasked.mockResolvedValue([privateSsnFact]);
    privateFacts.reveal.mockResolvedValue('111-22-3333');
    const { rerender, unmount } = render(
      <StrictMode>
        <SchwabPrefillReview household={household} />
      </StrictMode>
    );
    await screen.findByLabelText('Owner name');
    expect(screen.queryByText('111-22-3333')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    await expect(
      screen.findByTestId('schwab-prefill-revealed-ownerSsn')
    ).resolves.toHaveTextContent('111-22-3333');
    expect(privateFacts.reveal).toHaveBeenCalledWith(household.id, 'owner-ssn');

    fireEvent.change(screen.getByLabelText('Account type'), {
      target: { value: 'roth-ira' },
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId('schwab-prefill-revealed-ownerSsn')
      ).not.toBeInTheDocument();
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    await screen.findByTestId('schwab-prefill-revealed-ownerSsn');
    rerender(
      <StrictMode>
        <SchwabPrefillReview household={{ ...household, id: 'h-other' }} />
      </StrictMode>
    );
    expect(
      screen.queryByTestId('schwab-prefill-revealed-ownerSsn')
    ).not.toBeInTheDocument();

    unmount();
    render(<SchwabPrefillReview household={household} />);
    await screen.findByLabelText('Owner name');
    expect(
      screen.queryByTestId('schwab-prefill-revealed-ownerSsn')
    ).not.toBeInTheDocument();
  });
  it('invalidates an in-flight private reveal when the review screen closes', async () => {
    privateFacts.listMasked.mockResolvedValue([privateSsnFact]);
    const reveal = deferred<string>();
    privateFacts.reveal.mockReturnValue(reveal.promise);
    const mapSet = vi.spyOn(Map.prototype, 'set');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<SchwabPrefillReview household={household} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    expect(privateFacts.reveal).toHaveBeenCalledWith(household.id, 'owner-ssn');

    unmount();
    reveal.resolve('111-22-3333');
    await Promise.resolve();

    expect(mapSet).not.toHaveBeenCalledWith('owner-ssn', '111-22-3333');
    expect(
      localStorage.getItem('lantern:schwab-prep-packets') ?? ''
    ).not.toContain('111-22-3333');
    expect(consoleError).not.toHaveBeenCalled();
    render(<SchwabPrefillReview household={household} />);
    await screen.findByLabelText('Owner name');
    expect(screen.queryByText('111-22-3333')).not.toBeInTheDocument();
  });
  it('preserves an advisor-edited field when an async household re-seed lands mid-edit', async () => {
    // Simulates the data-loss race: the advisor types into a controlled field,
    // then an async prefill/household resolution hands the component a fresh
    // `household` reference, re-firing the seed effect. The edit must survive;
    // an UNTOUCHED field must still pick up the new prefill (merge, not freeze).
    privateFacts.listMasked.mockResolvedValue([]);
    const { rerender } = render(<SchwabPrefillReview household={household} />);
    const ownerName = await screen.findByLabelText('Owner name');
    const address = screen.getByLabelText('Address');
    // Prefilled from the household member.
    expect(ownerName).toHaveValue('Pat Taylor');
    expect(address).toHaveValue('1 Main, Austin, TX, 78701');

    // Advisor edits the owner name mid-session.
    fireEvent.change(ownerName, { target: { value: 'Jamie Advisor' } });
    expect(ownerName).toHaveValue('Jamie Advisor');

    // Async household data resolves: a NEW object reference, same id, different
    // underlying values. Without the dirty-preserving merge this clobbers the
    // advisor's typed value.
    const resolvedHousehold: SchwabHousehold = {
      ...household,
      members: [
        {
          id: 'p',
          name: 'Robin Newname',
          personType: 'person',
          roles: [],
          relatedHouseholds: 1,
          addresses: [
            {
              id: 'a2',
              address: '9 Oak',
              city: 'Dallas',
              state: 'TX',
              zip: '75201',
              kind: 'home',
              primary: true,
            },
          ],
          emails: [
            { id: 'e', address: 'pat@example.test', kind: 'home', primary: true },
          ],
          phones: [{ id: 'p', address: '555', kind: 'mobile', primary: true }],
        },
      ],
    };
    rerender(<SchwabPrefillReview household={resolvedHousehold} />);

    // Edited field is preserved; untouched field refreshes from the new prefill.
    await waitFor(() => {
      expect(screen.getByLabelText('Owner name')).toHaveValue('Jamie Advisor');
    });
    expect(screen.getByLabelText('Address')).toHaveValue(
      '9 Oak, Dallas, TX, 75201'
    );
  });
  it('keeps advisor edits through repeated async re-seeds', async () => {
    privateFacts.listMasked.mockResolvedValue([]);
    const { rerender } = render(<SchwabPrefillReview household={household} />);
    const ownerName = await screen.findByLabelText('Owner name');
    fireEvent.change(ownerName, { target: { value: 'Advisor Typed' } });
    expect(ownerName).toHaveValue('Advisor Typed');
    for (let i = 0; i < 5; i += 1) {
      rerender(
        <SchwabPrefillReview household={{ ...household, name: `pass-${String(i)}` }} />
      );
      await waitFor(() => {
        expect(screen.getByLabelText('Owner name')).toHaveValue('Advisor Typed');
      });
    }
  });
  it('keeps a revealed value out of durable approval data and audit metadata', async () => {
    audit.emitAuditEntry.mockResolvedValue({ id: 'audit-private' });
    privateFacts.listMasked.mockResolvedValue([privateSsnFact]);
    privateFacts.reveal.mockResolvedValue('111-22-3333');
    render(<SchwabPrefillReview household={household} />);
    await screen.findByLabelText('Owner name');
    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    await screen.findByTestId('schwab-prefill-revealed-ownerSsn');
    await completeRequiredFields();
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve local prep packet' })
    );
    await screen.findByTestId('schwab-prefill-receipt');
    expect(JSON.stringify(audit.emitAuditEntry.mock.calls)).not.toContain(
      '111-22-3333'
    );
    expect(localStorage.getItem('lantern:schwab-prep-packets')).not.toContain(
      '111-22-3333'
    );
  });
});

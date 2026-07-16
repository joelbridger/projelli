import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const audit = vi.hoisted(() => ({ emitAuditEntry: vi.fn() }));
vi.mock('@/features/audit', () => ({ emitAuditEntry: audit.emitAuditEntry }));
vi.mock('../private-facts', () => ({
  schwabPrivateFacts: {
    listMasked: vi.fn().mockResolvedValue([]),
    reveal: vi.fn(),
  },
}));
import { SchwabPrefillReview } from './SchwabPrefillReview';
import type { SchwabHousehold } from '../mapping';

const household: SchwabHousehold = {
  id: 'h-review',
  name: 'Taylor family',
  lifecycle: 'active',
  primaryAdvisor: 'Ada',
  ownership: 'mine',
  serviceTier: 'standard',
  syncState: 'live',
  facts: [],
  accounts: [],
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
  externalParties: [],
  notes: [],
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  audit.emitAuditEntry.mockReset();
});
function completeRequiredFields(): void {
  for (const input of screen.getAllByRole('textbox')) {
    if (!(input as HTMLInputElement).value)
      fireEvent.change(input, { target: { value: 'ready' } });
  }
  for (const checkbox of screen.getAllByRole('checkbox')) {
    const input = checkbox as HTMLInputElement;
    if (!input.disabled) fireEvent.click(input);
  }
}
describe('Schwab review approval', () => {
  it('reports an audit stall and does not create a receipt', async () => {
    audit.emitAuditEntry.mockRejectedValue(new Error('writer unavailable'));
    render(<SchwabPrefillReview household={household} />);
    await screen.findByLabelText('Owner name');
    completeRequiredFields();
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
    completeRequiredFields();
    fireEvent.click(
      screen.getByRole('button', { name: 'Approve local prep packet' })
    );
    await screen.findByTestId('schwab-prefill-receipt');
    expect(audit.emitAuditEntry).toHaveBeenCalledOnce();
  });
});

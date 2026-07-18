import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Matter } from '@/platform/types/matter';

const boundary = vi.hoisted(() => ({
  decision: null as unknown,
  save: vi.fn(),
}));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => boundary.decision,
  readSelectionOperationDecision: () => boundary.decision,
}));
vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({ save: boundary.save }),
}));

import { CrmAskProposalPanel } from './CrmAskProposalPanel';

const matter: Matter = {
  id: 'matter-a',
  name: 'Alpha',
  client: 'Alpha',
  folderPaths: ['/workspace/Alpha'],
  createdAt: '2026-07-18T00:00:00.000Z',
};
const answer = {
  question: 'What changed?',
  answer: 'The address changed.',
  citations: [{
    n: 1,
    label: 'CRM contact',
    excerpt: 'Address changed',
    path: 'crm:contact:contact-a',
    locator: 'CRM contact',
    verified: true,
    grounded: true,
    sourceType: 'crm' as const,
    matterId: 'household-a',
  }],
  sources: [],
};

describe('CrmAskProposalPanel authoritative client selection', () => {
  beforeEach(() => {
    boundary.save.mockReset().mockResolvedValue(undefined);
    boundary.decision = {
      kind: 'matter',
      sourceKind: 'matter',
      matter,
      client: {
        provider: 'wealthbox',
        householdId: 'household-a',
        displayName: 'Alpha',
      },
    };
  });

  it('saves against the proven household identity, not the follower matter id', async () => {
    render(<CrmAskProposalPanel answer={answer} />);
    fireEvent.change(screen.getByTestId('crm-ask-proposal-text'), {
      target: { value: 'Confirm the address' },
    });
    fireEvent.click(screen.getByTestId('crm-ask-proposal-submit'));

    await waitFor(() => {
      expect(boundary.save).toHaveBeenCalledOnce();
    });
    expect(boundary.save.mock.calls[0]?.[0]).toMatchObject({
      matterId: 'household-a',
    });
  });

  it.each([
    ['client-required', 'This action needs a confirmed client.'],
    ['blocked-unresolved', 'The selected client is still unresolved.'],
    ['follower-disagreement', 'The client selection is still catching up.'],
  ])('refuses and surfaces %s before preparing a client proposal', (reason, message) => {
    boundary.decision = { kind: 'refused', reason, message };
    render(<CrmAskProposalPanel answer={answer} />);

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByTestId('crm-ask-proposal-submit')).toBeDisabled();
    expect(boundary.save).not.toHaveBeenCalled();
  });
});

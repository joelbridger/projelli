import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdRecord } from '@/features/crm-clients';

const household: HouseholdRecord = {
  id: 'household-member-rail',
  name: 'Henderson household',
  lifecycle: 'Active',
  primaryAdvisor: 'Maya',
  ownership: 'mine',
  serviceTier: 'Platinum',
  syncState: 'live',
  facts: [],
  accounts: [],
  members: [
    {
      id: 'member-jordan',
      name: 'Jordan Henderson',
      personType: 'person',
      roles: ['Client'],
      householdRole: 'Spouse',
      relatedHouseholds: 1,
      emails: [
        { id: 'email-jordan', address: 'jordan@example.com', kind: 'work', primary: true },
      ],
    },
  ],
  externalParties: [],
  notes: [],
};

afterEach(() => {
  cleanup();
  setDevFlagOverride('record-member-kebab', undefined);
});

describe('household member rail extension', () => {
  it('renders the enabled member rail and limits each kebab action to existing public record contracts', async () => {
    setDevFlagOverride('record-member-kebab', true);
    const { MemberRailTab } = await import('./MemberRailTab');
    const onAdd = vi.fn();
    const onDraftEmail = vi.fn();
    const onReviewRecipient = vi.fn();
    const onSaveHousehold = vi.fn();

    render(
      <MemberRailTab
        household={household}
        actions={{ onAdd, onDraftEmail, onReviewRecipient }}
      />
    );

    expect(screen.getByTestId('crm-household-member-rail')).toBeInTheDocument();
    expect(screen.getByTestId('crm-household-member-member-jordan')).toHaveTextContent(
      'Jordan Henderson'
    );
    expect(screen.getByTestId('crm-household-member-member-jordan')).toHaveTextContent(
      'Spouse · jordan@example.com'
    );

    fireEvent.click(screen.getByTestId('crm-household-member-kebab-member-jordan'));
    expect(screen.getByTestId('crm-household-member-menu-member-jordan')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('crm-household-member-review-member-jordan'));
    expect(onReviewRecipient).toHaveBeenCalledWith('member-jordan');

    fireEvent.click(screen.getByTestId('crm-household-member-kebab-member-jordan'));
    fireEvent.click(screen.getByTestId('crm-household-member-email-member-jordan'));
    expect(onDraftEmail).toHaveBeenCalledWith({
      kind: 'open_mail_surface',
      householdRef: {
        kind: 'household',
        id: 'household-member-rail',
        label: 'Henderson household',
      },
      contextRefs: [
        {
          kind: 'household',
          id: 'household-member-rail',
          label: 'Henderson household',
        },
        { kind: 'person', id: 'member-jordan', label: 'Jordan Henderson' },
      ],
      source: 'crm_household',
    });

    fireEvent.click(screen.getByTestId('crm-household-member-kebab-member-jordan'));
    fireEvent.click(screen.getByTestId('crm-household-member-task-member-jordan'));
    expect(onAdd).toHaveBeenCalledWith({
      kind: 'task',
      householdRef: {
        kind: 'household',
        id: 'household-member-rail',
        label: 'Henderson household',
      },
      contextRefs: [
        {
          kind: 'household',
          id: 'household-member-rail',
          label: 'Henderson household',
        },
        { kind: 'person', id: 'member-jordan', label: 'Jordan Henderson' },
      ],
    });
    expect(onSaveHousehold).not.toHaveBeenCalled();
  });
});

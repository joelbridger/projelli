import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdRecord } from '@/features/crm-clients';
import type { HouseholdTabSurfaceProps } from '../../tabRegistry';

const { memberRailTabMount } = vi.hoisted(() => ({
  memberRailTabMount: vi.fn(() => null),
}));

// This makes the shell test measure this extension alone. The real Client Map
// tab has its own live reader, which is not part of this presentation-only lane.
vi.mock('../../clientMapTab', () => ({
  clientMapTab: {
    id: 'client-map',
    label: 'Client Map',
    route: 'client_map',
    Component: ({ renderLegacySurface }: HouseholdTabSurfaceProps) => (
      <>{renderLegacySurface('client_map')}</>
    ),
  },
}));

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
  vi.doUnmock('./MemberRailTab');
  setDevFlagOverride('record-member-kebab', undefined);
});

beforeEach(() => {
  memberRailTabMount.mockClear();
});

describe('household member rail extension', () => {
  it('is absent at mount while dark, without mounting member-rail work', async () => {
    setDevFlagOverride('record-member-kebab', false);
    vi.resetModules();
    // The stand-in marks the exact boundary where this extension would begin
    // reading its member data or running hooks. The registry must prevent this
    // component from mounting at all while the flag is dark.
    vi.doMock('./MemberRailTab', () => ({ MemberRailTab: memberRailTabMount }));
    const { HouseholdRecordSurface } = await import('../../HouseholdRecordSurface');
    const { householdTabRegistry, validateHouseholdTabDescriptors } = await import(
      '../../tabRegistry'
    );
    const onAdd = vi.fn();
    const onDraftEmail = vi.fn();
    const onReviewRecipient = vi.fn();

    expect(() => {
      validateHouseholdTabDescriptors(householdTabRegistry);
    }).not.toThrow();
    expect(
      householdTabRegistry.some((descriptor) => descriptor.id === 'household-members')
    ).toBe(false);

    render(
      <HouseholdRecordSurface
        household={household}
        actions={{ onAdd, onDraftEmail, onReviewRecipient }}
      />
    );

    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-household-member-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-household-member-jordan')).not.toBeInTheDocument();
    expect(memberRailTabMount).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(onDraftEmail).not.toHaveBeenCalled();
    expect(onReviewRecipient).not.toHaveBeenCalled();
  });

  it('renders through the real registry and limits each kebab action to existing public record contracts', async () => {
    setDevFlagOverride('record-member-kebab', true);
    vi.resetModules();
    const { HouseholdRecordSurface: EnabledHouseholdRecordSurface } =
      await import('../../HouseholdRecordSurface');
    const { householdTabRegistry: enabledRegistry } = await import(
      '../../tabRegistry'
    );
    const onAdd = vi.fn();
    const onDraftEmail = vi.fn();
    const onReviewRecipient = vi.fn();
    const onSaveHousehold = vi.fn();

    render(
      <EnabledHouseholdRecordSurface
        household={household}
        actions={{ onAdd, onDraftEmail, onReviewRecipient }}
        onSaveHousehold={onSaveHousehold}
      />
    );

    expect(
      enabledRegistry.some((descriptor) => descriptor.id === 'household-members')
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Members' }));
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

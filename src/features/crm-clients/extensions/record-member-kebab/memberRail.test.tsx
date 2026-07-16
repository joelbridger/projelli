import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdRecord } from '@/features/crm-clients';
import type { HouseholdTabSurfaceProps } from '../../tabRegistry';

const EmptyTab: ComponentType<HouseholdTabSurfaceProps> = () => null;

// Keep the real registry and household screen under test. Only the unrelated
// tab implementations are replaced, so module reloads stay below this lane's
// five-second test timeout.
vi.mock('../../clientMapTab', () => ({
  clientMapTab: { id: 'client-map', label: 'Client Map', route: 'client_map', Component: EmptyTab },
}));
vi.mock('../../fallbackTabs', () => ({
  activityTab: { id: 'activity', label: 'Activity', route: 'activity', Component: EmptyTab },
}));
vi.mock('@/features/crm-documents/surface', () => ({
  documentsTab: { id: 'documents', label: 'Documents', route: 'documents', Component: EmptyTab },
}));
vi.mock('@/features/crm-timeline/tabSurface', () => ({
  timelineTab: { id: 'timeline', label: 'Timeline', route: 'timeline', Component: EmptyTab },
}));
vi.mock('@/features/crm-connectors/tabSurface', () => ({
  emailTab: { id: 'email', label: 'Email', route: 'email', Component: EmptyTab },
  meetingsTab: { id: 'meetings', label: 'Meetings', route: 'meetings', Component: EmptyTab },
}));
vi.mock('../../meetingNotesTab', () => ({
  meetingNotesTab: { id: 'meeting-notes', label: 'Meeting notes', route: 'meeting_notes', Component: EmptyTab },
}));
vi.mock('../../reviewsTab', () => ({
  reviewsTab: { id: 'reviews', label: 'Reviews', route: 'reviews', Component: EmptyTab },
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
  setDevFlagOverride('record-member-kebab', undefined);
});

describe('household member rail extension', () => {
  it('renders the enabled member rail and limits each kebab action to existing public record contracts', async () => {
    setDevFlagOverride('record-member-kebab', true);
    vi.resetModules();
    const { HouseholdRecordSurface } = await import('../../HouseholdRecordSurface');
    const { householdTabRegistry } = await import('../../tabRegistry');
    const onAdd = vi.fn();
    const onDraftEmail = vi.fn();
    const onReviewRecipient = vi.fn();

    render(
      <HouseholdRecordSurface
        household={household}
        actions={{ onAdd, onDraftEmail, onReviewRecipient }}
      />
    );

    expect(
      householdTabRegistry.some((descriptor) => descriptor.id === 'household-members')
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
  });
});

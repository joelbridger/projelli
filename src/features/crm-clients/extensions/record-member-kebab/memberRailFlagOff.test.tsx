import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { setDevFlagOverride } from '@/platform/flags';
import type { HouseholdTabSurfaceProps } from '../../tabRegistry';

const { memberRailTabMount } = vi.hoisted(() => ({
  memberRailTabMount: vi.fn(() => null),
}));

const EmptyTab: ComponentType<HouseholdTabSurfaceProps> = () => null;

// This test exercises the feature's registration boundary, not the unrelated
// implementation of every existing Client Map tab. Keeping those tabs light
// makes the dark-flag contract deterministic instead of timing out while the
// test runner rebuilds the whole client surface after resetModules().
vi.mock('../../clientMapTab', () => ({
  clientMapTab: {
    id: 'client-map',
    label: 'Client Map',
    route: 'client_map',
    Component: EmptyTab,
  },
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
// This keeps the real household shell and real tab registry in place while
// leaving unrelated header, add-menu, and Client Map extensions out of the
// flag-reset reload path.
vi.mock('../../recordRegistry', () => ({
  getHouseholdAddActions: () => [],
  getHouseholdHeaderActions: () => [],
  getHouseholdRecordExtensions: () => [],
  getHouseholdSections: () => [],
}));
vi.mock('../../NoteEditor', () => ({ NoteEditor: EmptyTab }));
vi.mock('../../ProposalCard', () => ({ ProposalCard: EmptyTab }));
vi.mock('../../RecordMetadataEditor', () => ({ RecordMetadataEditor: EmptyTab }));
vi.mock('../../ContactEditor', () => ({ ContactEditor: EmptyTab }));
afterEach(() => {
  cleanup();
  vi.doUnmock('./MemberRailTab');
  memberRailTabMount.mockClear();
  setDevFlagOverride('record-member-kebab', undefined);
});

describe('household member rail extension while dark', () => {
  it('is absent at mount and does not mount member-rail work', async () => {
    setDevFlagOverride('record-member-kebab', false);
    vi.resetModules();
    // This is the real extension descriptor and real registry. The stand-in
    // marks the member-rail boundary that must stay unreachable while dark.
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
        household={{
          id: 'household-member-rail',
          name: 'Henderson household',
          lifecycle: 'Active',
          primaryAdvisor: 'Maya',
          ownership: 'mine',
          serviceTier: 'Platinum',
          syncState: 'live',
          facts: [],
          accounts: [],
          members: [],
          externalParties: [],
          notes: [],
        }}
        actions={{ onAdd, onDraftEmail, onReviewRecipient }}
      />
    );

    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-household-member-rail')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crm-household-member-member-jordan')).not.toBeInTheDocument();
    expect(memberRailTabMount).not.toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
    expect(onDraftEmail).not.toHaveBeenCalled();
    expect(onReviewRecipient).not.toHaveBeenCalled();
  });
});

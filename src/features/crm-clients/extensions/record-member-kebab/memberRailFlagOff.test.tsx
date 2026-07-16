import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
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
vi.mock('@/features/crm-clients/extensions/record-member-kebab', () => ({
  memberRailTab: {
    id: 'household-members',
    label: 'Members',
    route: 'household_members',
    Component: memberRailTabMount,
  },
}));

afterEach(() => {
  cleanup();
  memberRailTabMount.mockClear();
  setDevFlagOverride('record-member-kebab', undefined);
});

describe('household member rail extension while dark', () => {
  it('is absent at mount and does not mount member-rail work', async () => {
    setDevFlagOverride('record-member-kebab', false);
    vi.resetModules();
    const { householdTabRegistry, validateHouseholdTabDescriptors } = await import(
      '../../tabRegistry'
    );

    expect(() => {
      validateHouseholdTabDescriptors(householdTabRegistry);
    }).not.toThrow();
    expect(
      householdTabRegistry.some((descriptor) => descriptor.id === 'household-members')
    ).toBe(false);

    // This is the same registry-driven mount shape used by the household
    // screen. With no descriptor there is no path that can reach the extension.
    const selectedTab = householdTabRegistry[0];
    if (!selectedTab) throw new Error('Expected the legacy Client Map tab');
    render(
      <selectedTab.Component
        household={{} as HouseholdTabSurfaceProps['household']}
        proposals={[]}
        timelineRecords={[]}
        renderLegacySurface={() => null}
      />
    );

    expect(memberRailTabMount).not.toHaveBeenCalled();
  });
});

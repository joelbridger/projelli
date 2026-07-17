import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  getHouseholdSections,
  householdSectionRegistry,
  householdTabRegistry,
  toMeetingClientBoundary,
  validateHouseholdSectionDescriptors,
  validateHouseholdTabDescriptors,
  type HouseholdTabSurfaceProps,
} from '@/features/crm-clients';
import {
  thirdContributorClientBoundary,
  thirdContributorSectionContext,
  thirdContributorTab,
} from './pavedPath.import';

const tabProps: HouseholdTabSurfaceProps = {
  household: {
    id: 'household-northcrest',
    name: 'Northcrest household',
    lifecycle: 'Active',
    primaryAdvisor: 'Maya',
    ownership: 'mine',
    serviceTier: 'Standard',
    syncState: 'live',
    facts: [],
    accounts: [],
    members: [],
    externalParties: [],
    notes: [],
  },
  proposals: [],
  timelineRecords: [],
  renderLegacySurface: (route) => (
    <div data-testid="third-contributor-tab-mount">{route}</div>
  ),
};

describe('crm-clients public doorways', () => {
  it('lets a third contributor inspect and validate the household-section registry', () => {
    validateHouseholdSectionDescriptors(householdSectionRegistry);
    expect(getHouseholdSections().map((section) => section.id)).toEqual(
      householdSectionRegistry.slice().sort((left, right) => left.order - right.order).map((section) => section.id)
    );
    expect(thirdContributorSectionContext).toEqual({
      householdRef: {
        kind: 'household',
        id: 'household-northcrest',
        matterId: 'matter-northcrest',
        label: 'Northcrest household',
      },
      matterId: 'matter-northcrest',
    });
  });

  it('mounts a registered tab through the public registry contract', () => {
    validateHouseholdTabDescriptors(householdTabRegistry);
    expect(thirdContributorTab).toBeDefined();
    if (!thirdContributorTab) throw new Error('Expected the public activity tab.');
    render(createElement(thirdContributorTab.Component, tabProps));
    expect(screen.getByTestId('third-contributor-tab-mount')).toHaveTextContent('activity');
    expect(thirdContributorClientBoundary).toEqual({
      householdRef: 'household-northcrest',
      matterId: 'matter-northcrest',
      displayName: 'Northcrest household',
    });
  });

  it('rejects a crossed-client boundary instead of inferring a matter link', () => {
    expect(() =>
      toMeetingClientBoundary({
        householdRef: {
          kind: 'household',
          id: 'household-northcrest',
          matterId: 'matter-northcrest',
        },
        matterId: 'matter-other',
      })
    ).toThrow('matterId must match householdRef.matterId');
  });
});

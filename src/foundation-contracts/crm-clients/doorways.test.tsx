import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  HouseholdRecordSurface,
  householdSectionRegistry,
  householdTabRegistry,
  resolveHouseholdMatterId,
  toMeetingClientBoundary,
  validateHouseholdSectionDescriptors,
  validateHouseholdTabDescriptors,
} from '@/features/crm-clients';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  registerThirdContributor,
  thirdContributorSection,
  thirdContributorTab,
} from './pavedPath.import';

const household = {
  id: 'household-northcrest',
  name: 'Northcrest household',
  lifecycle: 'Active',
  primaryAdvisor: 'Maya',
  ownership: 'mine' as const,
  serviceTier: 'Standard',
  syncState: 'live' as const,
  facts: [],
  accounts: [],
  members: [],
  externalParties: [],
  notes: [],
};

const matter = {
  id: 'local-matter-northcrest',
  firmMatterId: 'firm-matter-northcrest',
  name: 'Northcrest household',
  client: 'Northcrest household',
  folderPaths: [],
  crmHouseholdKeys: [household.id],
  createdAt: '2026-07-17T00:00:00.000Z',
};

afterEach(() => {
  useMatterStore.setState({ matters: [], activeMatterId: null });
});

describe('crm-clients public doorways', () => {
  it('mounts genuine outside section and tab contributions through the real record surface', () => {
    useMatterStore.setState({ matters: [matter] });
    const cleanup = registerThirdContributor();
    try {
      render(<HouseholdRecordSurface household={household} />);
      expect(screen.getByTestId('third-contributor-section-mount').textContent).toBe(
        'household-northcrest:local-matter-northcrest'
      );

      fireEvent.click(screen.getByTestId('crm-household-tab-third_contributor'));
      expect(screen.getByTestId('third-contributor-tab-mount').textContent).toBe(
        'household-northcrest:local-matter-northcrest'
      );
    } finally {
      cleanup();
    }
  });

  it('uses Matter.crmHouseholdKeys and local Matter.id as the only boundary proof', () => {
    expect(resolveHouseholdMatterId(household, [matter])).toBe('local-matter-northcrest');
    expect(toMeetingClientBoundary(household, [matter])).toMatchObject({
      householdRef: household.id,
      matterId: 'local-matter-northcrest',
    });
    expect(toMeetingClientBoundary(household, [])).toBeUndefined();
    expect(toMeetingClientBoundary(household, [matter, { ...matter, id: 'other-local' }])).toBeUndefined();
  });

  it('rejects outside duplicate ids, duplicate routes, and invalid section order with the live validators', () => {
    expect(() => {
      validateHouseholdSectionDescriptors([
        ...householdSectionRegistry,
        { ...thirdContributorSection, order: Number.NaN },
      ]);
    }
    ).toThrow('order must be finite: third-contributor-section');
    expect(() => {
      validateHouseholdSectionDescriptors([
        ...householdSectionRegistry,
        { ...thirdContributorSection, id: householdSectionRegistry[0]?.id ?? 'client-map' },
      ]);
    }
    ).toThrow('duplicate id: client_map');
    expect(() => {
      validateHouseholdTabDescriptors([
        ...householdTabRegistry,
        { ...thirdContributorTab, id: householdTabRegistry[0]?.id ?? 'client-map' },
      ]);
    }
    ).toThrow('duplicate tab id: client-map');
    expect(() => {
      validateHouseholdTabDescriptors([
        ...householdTabRegistry,
        { ...thirdContributorTab, route: householdTabRegistry[0]?.route ?? 'client_map' },
      ]);
    }
    ).toThrow('duplicate tab route: client_map');
  });
});

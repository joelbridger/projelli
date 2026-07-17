// A third-party CRM contributor's paved path. Every runtime symbol below comes
// from the crm-clients public index; this fixture deliberately has no deep imports.
import { Circle } from 'lucide-react';
import {
  registerHouseholdSection,
  registerHouseholdTab,
  type HouseholdSectionDescriptor,
  type HouseholdTabDescriptor,
} from '@/features/crm-clients';

export const thirdContributorSection: HouseholdSectionDescriptor = {
  id: 'third-contributor-section',
  order: 999,
  tab: 'client_map',
  mount: ({ householdRef, matterId }) => (
    <div data-testid="third-contributor-section-mount">
      {householdRef.id}:{matterId}
    </div>
  ),
};

export const thirdContributorTab: HouseholdTabDescriptor = {
  id: 'third-contributor-tab',
  label: 'Third contributor',
  icon: Circle,
  route: 'third_contributor',
  Component: ({ household, clientBoundary }) => (
    <div data-testid="third-contributor-tab-mount">
      {household.id}:{clientBoundary?.matterId ?? 'no-boundary'}
    </div>
  ),
};

/** Registers both genuine outside contributions on the live registries. */
export function registerThirdContributor(): () => void {
  const cleanupSection = registerHouseholdSection(thirdContributorSection);
  const cleanupTab = registerHouseholdTab(thirdContributorTab);
  return () => {
    cleanupTab();
    cleanupSection();
  };
}

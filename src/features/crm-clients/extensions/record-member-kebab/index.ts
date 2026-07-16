import { UsersRound } from 'lucide-react';
import type { HouseholdTabDescriptor } from '@/features/crm-clients/tabRegistry';
import { MemberRailTab } from './MemberRailTab';

declare module '@/features/crm-clients/tabRegistry' {
  interface HouseholdTabRouteMap {
    members: true;
  }
}

/** Household-member presentation mounted through the single P0-E tab seam. */
export const memberRailTab: HouseholdTabDescriptor = {
  id: 'household-members',
  label: 'Members',
  icon: UsersRound,
  route: 'members',
  Component: MemberRailTab,
};

export { MemberRailTab } from './MemberRailTab';

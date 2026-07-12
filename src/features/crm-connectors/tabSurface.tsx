import { CalendarDays, Mail } from 'lucide-react';
import { HouseholdConnectorSurface } from './HouseholdConnectorSurface';
import type { HouseholdTabDescriptor, HouseholdTabSurfaceProps } from '@/features/crm-clients/tabRegistry';

function ConnectorTab({ tab, household, actions }: { tab: 'email' | 'meetings'; household: HouseholdTabSurfaceProps['household']; actions: HouseholdTabSurfaceProps['actions'] }) {
  return <HouseholdConnectorSurface tab={tab} household={household} {...(actions ? { actions } : {})} />;
}

export const emailTab: HouseholdTabDescriptor = { id: 'email', label: 'Email', icon: Mail, route: 'email', Component: ({ household, actions }) => <ConnectorTab tab="email" household={household} actions={actions} /> };
export const meetingsTab: HouseholdTabDescriptor = { id: 'meetings', label: 'Meetings', icon: CalendarDays, route: 'meetings', Component: ({ household, actions }) => <ConnectorTab tab="meetings" household={household} actions={actions} /> };

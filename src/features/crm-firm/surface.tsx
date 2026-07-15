import { ClipboardList, RefreshCw, Users } from 'lucide-react';
import { FirmSetup } from './FirmSetup';
import { IntakeLinks } from './IntakeLinks';
import { WorkspacesSurface } from './WorkspacesSurface';

import { OrgAdmin } from './OrgAdmin';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registryTypes';

declare module '@/features/crm-home/registryTypes' {
  interface CrmHomeRouteMap {
    'firm-setup': true;
    'firm-organization': true;
    'fields-tags': true;
    'intake-links': true;
    workspaces: true;
  }
}

function FirmSurface({ initialTab }: { initialTab?: 'fields' }) {
  const { navigate } = useCrmHomeSurfaceContext();
  return (
    <FirmSetup
      {...(initialTab ? { initialTab } : {})}
      onNavigate={(next) => {
        navigate(next);
      }}
    />
  );
}

export const firmSurface: CrmHomeSurfaceDescriptor = {
  id: 'firm',
  labelKey: 'crm.home.destinations.firm-setup',
  icon: Users,
  route: 'firm-setup',
  rail: { group: 'home', order: 90 },
  shortcut: 'f',
  Component: () => <FirmSurface />,
};
export const firmOrganizationSurface: CrmHomeSurfaceDescriptor = {
  id: 'firm-organization',
  labelKey: 'crm.home.destinations.firm-organization',
  icon: Users,
  route: 'firm-organization',
  parentRoute: 'firm-setup',
  Component: OrgAdmin,
};
export const firmFieldsSurface: CrmHomeSurfaceDescriptor = {
  id: 'firm-fields',
  labelKey: 'crm.home.destinations.fields-tags',
  icon: Users,
  route: 'fields-tags',
  parentRoute: 'firm-setup',
  Component: () => <FirmSurface initialTab="fields" />,
};
export const intakeLinksSurface: CrmHomeSurfaceDescriptor = {
  id: 'intake-links',
  labelKey: 'crm.home.destinations.intake-links',
  icon: ClipboardList,
  route: 'intake-links',
  parentRoute: 'firm-setup',
  Component: IntakeLinks,
};
export const workspacesSurface: CrmHomeSurfaceDescriptor = {
  id: 'workspaces',
  labelKey: 'crm.home.destinations.workspaces',
  icon: RefreshCw,
  route: 'workspaces',
  parentRoute: 'firm-setup',
  Component: WorkspacesSurface,
};

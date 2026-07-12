import { ClipboardList, Users } from 'lucide-react';
import { FirmSetup } from './FirmSetup';
import { IntakeLinks } from './IntakeLinks';
import { OrgAdmin } from './OrgAdmin';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

function FirmSurface({ initialTab }: { initialTab?: 'fields' }) {
  const { navigate } = useCrmHomeSurfaceContext();
  return <FirmSetup {...(initialTab ? { initialTab } : {})} onNavigate={(next) => { navigate(next); }} />;
}

export const firmSurface: CrmHomeSurfaceDescriptor = { id: 'firm', label: 'Firm', icon: Users, route: 'firm-setup', rail: true, Component: () => <FirmSurface /> };
export const firmOrganizationSurface: CrmHomeSurfaceDescriptor = { id: 'firm-organization', label: 'Firm overview', icon: Users, route: 'firm-organization', Component: OrgAdmin };
export const firmFieldsSurface: CrmHomeSurfaceDescriptor = { id: 'firm-fields', label: 'Fields and tags', icon: Users, route: 'fields-tags', Component: () => <FirmSurface initialTab="fields" /> };
export const intakeLinksSurface: CrmHomeSurfaceDescriptor = { id: 'intake-links', label: 'Intake links', icon: ClipboardList, route: 'intake-links', Component: IntakeLinks };

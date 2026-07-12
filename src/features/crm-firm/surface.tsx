import { ClipboardList, RefreshCw, Users } from 'lucide-react';
import { FirmSetup } from './FirmSetup';
import { IntakeLinks } from './IntakeLinks';
import { WorkspacesSurface } from './WorkspacesSurface';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

function FirmSurface({ initialTab }: { initialTab?: 'fields' }) {
  const { navigate } = useCrmHomeSurfaceContext();
  return <FirmSetup {...(initialTab ? { initialTab } : {})} onNavigate={(next) => { navigate(next); }} />;
}

export const firmSurface: CrmHomeSurfaceDescriptor = { id: 'firm', label: 'Firm', icon: Users, route: 'firm-setup', rail: true, Component: () => <FirmSurface /> };
export const firmFieldsSurface: CrmHomeSurfaceDescriptor = { id: 'firm-fields', label: 'Fields and tags', icon: Users, route: 'fields-tags', Component: () => <FirmSurface initialTab="fields" /> };
export const intakeLinksSurface: CrmHomeSurfaceDescriptor = { id: 'intake-links', label: 'Intake links', icon: ClipboardList, route: 'intake-links', Component: IntakeLinks };
export const workspacesSurface: CrmHomeSurfaceDescriptor = { id: 'workspaces', label: 'Firm spaces', icon: RefreshCw, route: 'workspaces', Component: WorkspacesSurface };

import { Users } from 'lucide-react';
import { FirmSetupSurface } from './FirmSetupSurface';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import type { CrmHomeSurfaceDescriptor } from '@/features/crm-home/registry';

function FirmSurface({ initialTab }: { initialTab?: 'fields' }) {
  const { navigate } = useCrmHomeSurfaceContext();
  return <FirmSetupSurface {...(initialTab ? { initialTab } : {})} onNavigate={(next) => { navigate(next); }} />;
}

export const firmSurface: CrmHomeSurfaceDescriptor = { id: 'firm', label: 'Firm', icon: Users, route: 'firm-setup', rail: true, Component: () => <FirmSurface /> };
export const firmFieldsSurface: CrmHomeSurfaceDescriptor = { id: 'firm-fields', label: 'Fields and tags', icon: Users, route: 'fields-tags', Component: () => <FirmSurface initialTab="fields" /> };

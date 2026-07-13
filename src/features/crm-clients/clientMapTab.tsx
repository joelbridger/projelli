/* eslint-disable react-refresh/only-export-components -- tab descriptor and its small adapter must stay together for the append-only CRM registry. */
import { ContactRound } from 'lucide-react';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { HouseholdTabDescriptor, HouseholdTabSurfaceProps } from './tabRegistry';
import { ClientMapWorkspace } from './ClientMapWorkspace';

function LiveClientMapTab({ household, renderLegacySurface }: HouseholdTabSurfaceProps) {
  const { records } = useLiveCrmRecords();
  const matters = useMatterStore((state) => state.matters);
  const mappedMatterId = records.find((record) => record.id === household.id)?.matterId;
  // CRM household ids and Client Map matter ids normally match. Imports can give
  // them different ids, so follow the live CRM mapping when it points to a real
  // matter; this is the same resolution convention used by the other CRM tabs.
  const matterId = mappedMatterId && matters.some((matter) => matter.id === mappedMatterId)
    ? mappedMatterId
    : household.id;
  return <>
    <ClientMapWorkspace matterId={matterId} />
    {renderLegacySurface('client_map')}
  </>;
}

export const clientMapTab: HouseholdTabDescriptor = {
  id: 'client-map',
  label: 'Client Map',
  icon: ContactRound,
  route: 'client_map',
  Component: LiveClientMapTab,
};

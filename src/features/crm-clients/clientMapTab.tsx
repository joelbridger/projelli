import { ContactRound } from 'lucide-react';
import type { HouseholdTabDescriptor } from './tabRegistry';

export const clientMapTab: HouseholdTabDescriptor = {
  id: 'client-map',
  label: 'Client Map',
  icon: ContactRound,
  route: 'client_map',
  Component: ({ renderLegacySurface }) => <>{renderLegacySurface('client_map')}</>,
};

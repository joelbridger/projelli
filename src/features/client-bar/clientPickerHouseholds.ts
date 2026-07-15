import type { SharedClientIdentity } from '@/platform/client-context';

export interface ClientPickerHousehold extends SharedClientIdentity {
  description: string;
}

/**
 * Prototype parity data until the CRM directory exposes its list through a
 * stable feature seam. The picker still writes only the shared identity.
 */
export const PROTOTYPE_CLIENT_PICKER_HOUSEHOLDS: readonly ClientPickerHousehold[] =
  [
    {
      householdId: 'household-foster',
      displayName: 'Foster household',
      primaryPeople: ['Robert Foster', 'Elena Foster'],
      description: 'Robert & Elena Foster · Active client',
    },
    {
      householdId: 'household-diaz',
      displayName: 'Diaz household',
      primaryPeople: ['Camila Diaz', 'Mateo Diaz'],
      description: 'Camila & Mateo Diaz · Active client',
    },
    {
      householdId: 'household-henderson',
      displayName: 'Henderson Family Trust',
      primaryPeople: ['Tara Henderson', 'Greg Henderson'],
      description: 'Tara & Greg Henderson',
    },
    {
      householdId: 'household-blue-mesa',
      displayName: 'Blue Mesa Holdings',
      description: 'Company · 3 related contacts',
    },
    {
      householdId: 'household-chen',
      displayName: 'Chen household',
      primaryPeople: ['Lena Chen', 'Wei Chen'],
      description: 'Lena & Wei Chen · Active client',
    },
  ];

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { ClientPickerHousehold } from './clientPickerHouseholds';

interface NativeHousehold {
  id: string;
  name: string;
}

/**
 * Reads the CRM household directory through its registered native command.
 * The feature owns only this small presentation adapter; the native contract
 * and the shared client identity remain in their existing platform seams.
 */
export async function fetchClientPickerHouseholds(): Promise<
  readonly ClientPickerHousehold[]
> {
  if (!isTauri()) return [];

  const households = await invoke<NativeHousehold[]>('crm_list_households', {
    runId: crypto.randomUUID(),
  });

  return households.map((household) => ({
    householdId: household.id,
    displayName: household.name,
  }));
}

import { invoke, isTauri } from '@tauri-apps/api/core';
import { crmSetWorkspace } from '@/platform/utils/wealthbox-commands';
import type { CrmSearchHit } from './types';

/**
 * Queries the SQLCipher-backed, device-local CRM search projection. Search
 * terms and results never travel to the sync relay or a model provider.
 */
export async function searchCrmRecords(
  workspaceRoot: string | null | undefined,
  query: string,
  matterId?: string,
  allowedRecordIds: readonly string[] = [],
): Promise<readonly CrmSearchHit[]> {
  if (!isTauri() || !workspaceRoot || !query.trim() || allowedRecordIds.length === 0) return [];
  const allowed = [...new Set(allowedRecordIds.filter(
    (id) => typeof id === 'string' && id.length > 0 && id === id.trim(),
  ))];
  if (allowed.length === 0) return [];
  await crmSetWorkspace(workspaceRoot);
  return invoke<CrmSearchHit[]>('crm_search', {
    query,
    ...(matterId ? { matterId } : {}),
    allowedRecordIds: allowed,
  });
}

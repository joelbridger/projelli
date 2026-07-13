const CRM_SELECTED_HOUSEHOLD_PREFIX = 'lantern:crm:selected-household:';

function storageKey(workspaceRoot: string): string {
  return `${CRM_SELECTED_HOUSEHOLD_PREFIX}${workspaceRoot}`;
}

/**
 * The selected CRM client is navigation state, not client data. Keeping this
 * tiny pointer lets a citation open the same durable Clients view as Directory
 * and lets that view reopen after a desktop restart.
 */
export function readSelectedCrmHousehold(workspaceRoot: string): string | null {
  try {
    return localStorage.getItem(storageKey(workspaceRoot));
  } catch {
    return null;
  }
}

export function writeSelectedCrmHousehold(
  workspaceRoot: string,
  householdId: string | null,
): void {
  try {
    if (householdId) localStorage.setItem(storageKey(workspaceRoot), householdId);
    else localStorage.removeItem(storageKey(workspaceRoot));
  } catch {
    // Navigation persistence is a convenience. The encrypted CRM record stays
    // authoritative even when browser storage is unavailable.
    // eslint-disable-next-line lantern-async/no-silent-failure -- best-effort navigation persistence must never block opening CRM data.
    return;
  }
}

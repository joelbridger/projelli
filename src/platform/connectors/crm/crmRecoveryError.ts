export const CRM_STORE_RECOVERY_CODE = 'CRM_STORE_RECOVERY_REQUIRED';
export const CRM_STORE_RECOVERY_MESSAGE =
  'Saved CRM imports cannot be unlocked on this device. Your file search still works. Rebuild the local copy from your connected CRM accounts.';

export function isCrmStoreRecoveryError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : '';
  return message.includes(CRM_STORE_RECOVERY_CODE);
}

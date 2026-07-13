import { useTranslation } from 'react-i18next';
import {
  retryNativeNetworkLockdown,
  useNativeNetworkLockdownBridgeState,
} from '@/platform/privacy/nativeNetworkLockdownBridge';

interface NetworkLockdownRetryButtonProps {
  testId: string;
}

/** A direct recovery action for a native privacy change that stayed fail-closed. */
export function NetworkLockdownRetryButton({
  testId,
}: NetworkLockdownRetryButtonProps) {
  const { t } = useTranslation();
  const { error, pending } = useNativeNetworkLockdownBridgeState();

  if (!error) return null;

  return (
    <button
      type="button"
      data-testid={testId}
      disabled={pending}
      onClick={retryNativeNetworkLockdown}
      className="mt-2 rounded-md border border-amber-500 bg-white px-2.5 py-1.5 text-xs font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-60"
    >
      {t('crm.network-lockdown.retry')}
    </button>
  );
}

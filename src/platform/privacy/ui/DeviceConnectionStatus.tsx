/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import {
  hydrateOfflineMode,
  useOfflineModeStore,
} from '@/platform/privacy/offlineMode';
import { cn } from '@/lib/utils';

/** A whole-device fact. It must never be inferred from the selected AI route. */
export function DeviceConnectionStatus({ className }: { className?: string }) {
  const { offlineMode, hydrated } = useOfflineModeStore();

  useEffect(() => {
    void hydrateOfflineMode().catch(() => undefined);
  }, []);

  if (!hydrated) {
    return (
      <div
        data-testid="device-connection-status"
        data-status="checking"
        role="status"
        className={cn('inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700', className)}
      >
        <Wifi className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        Checking device connection
      </div>
    );
  }

  const text = offlineMode
    ? 'Offline Mode on. Internet connections from Lantern are blocked.'
    : 'Internet connections are allowed when you choose an online feature.';
  return (
    <div
      data-testid="device-connection-status"
      data-status={offlineMode ? 'offline' : 'online'}
      role="status"
      aria-label={`Device connection: ${text}`}
      title={text}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold',
        offlineMode
          ? 'border-rose-300 bg-rose-50 text-rose-900'
          : 'border-slate-300 bg-slate-50 text-slate-800',
        className,
      )}
    >
      {offlineMode ? <WifiOff className="h-3.5 w-3.5" aria-hidden /> : <Wifi className="h-3.5 w-3.5" aria-hidden />}
      <span>Device: {text}</span>
    </div>
  );
}

export default DeviceConnectionStatus;

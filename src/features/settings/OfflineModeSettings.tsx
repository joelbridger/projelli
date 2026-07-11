/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import {
  hydrateOfflineMode,
  setOfflineMode,
  useOfflineModeStore,
} from '@/platform/privacy/offlineMode';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/alert-dialog';

/** The whole-app connection control. This deliberately sits outside AI routing. */
export function OfflineModeSettings() {
  const { offlineMode, hydrated, isHydrating, hydrationError } =
    useOfflineModeStore();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line lantern-async/no-silent-failure -- hydrateOfflineMode stores its safe error state for this UI.
    void hydrateOfflineMode().catch(() => undefined);
  }, []);

  const setMode = async (enabled: boolean) => {
    setSaving(true);
    setActionError(null);
    try {
      await setOfflineMode(enabled);
      setConfirmOpen(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not change Offline Mode.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="offline-mode-settings"
      data-offline-mode={offlineMode ? 'on' : 'off'}
      className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <WifiOff className="h-4 w-4 text-slate-700" aria-hidden />
            Offline Mode
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Block every internet connection from Lantern. Local files and Local AI only keep working.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={offlineMode}
          aria-label="Offline Mode"
          data-testid="offline-mode-switch"
          disabled={!hydrated || isHydrating || saving}
          onClick={() => {
            // eslint-disable-next-line lantern-async/no-silent-failure -- setMode catches and displays its own error.
            if (offlineMode) void setMode(false).catch(() => undefined);
            else setConfirmOpen(true);
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${offlineMode ? 'bg-rose-600' : 'bg-slate-300'} disabled:cursor-not-allowed disabled:opacity-60`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${offlineMode ? 'translate-x-5' : 'translate-x-0.5'}`}
          />
        </button>
      </div>
      {isHydrating && <p className="mt-2 text-xs text-muted-foreground">Checking device connection.</p>}
      {hydrationError && <p className="mt-2 text-xs text-destructive">{hydrationError}</p>}
      {actionError && <p className="mt-2 text-xs text-destructive">{actionError}</p>}
      {offlineMode && (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-900">
          Offline Mode is on. Internet connections from Lantern are blocked.
        </p>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="offline-mode-confirmation">
          <AlertDialogHeader>
            <AlertDialogTitle>Turn on Offline Mode?</AlertDialogTitle>
            <AlertDialogDescription>
              Sync, mail, updates, downloads, login, and external AI clients will pause. Your local files and Local AI keep working. Turn Offline Mode off when you are ready to use an online feature again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Keep connections on</AlertDialogCancel>
            <AlertDialogAction
              data-testid="offline-mode-confirm-enable"
              disabled={saving}
              onClick={(event) => {
                event.preventDefault();
                // eslint-disable-next-line lantern-async/no-silent-failure -- setMode catches and displays its own error.
                void setMode(true).catch(() => undefined);
              }}
            >
              {saving ? 'Turning on…' : 'Turn on Offline Mode'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

export default OfflineModeSettings;

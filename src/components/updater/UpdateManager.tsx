/**
 * UpdateManager — App-level singleton that schedules updater checks and
 * exposes a manual trigger for the settings page. Renders the
 * UpdateBanner inside the workspace shell.
 *
 * Scheduling:
 *   - Initial check 30 seconds after mount (lets the workspace finish
 *     loading first so we never block startup).
 *   - Every 24 hours thereafter via setInterval.
 *   - Skipped entirely if `autoUpdateCheck` is disabled in settings.
 *
 * Test-mode safety:
 *   - The store's `check()` action already short-circuits when not
 *     running inside Tauri, so mounting this component in browser /
 *     Playwright tests is a no-op.
 *   - We expose `__updaterStore` on window in test mode so specs can
 *     drive the banner directly without going through plugin-updater.
 */

import { useEffect } from 'react';
import { useUpdaterStore } from '@/stores/updaterStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { UpdateBanner } from './UpdateBanner';

const INITIAL_DELAY_MS = 30_000;
const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function UpdateManager() {
  const check = useUpdaterStore((s) => s.check);
  const autoUpdateCheck = useSettingsStore((s) =>
    s.getSetting<boolean>('autoUpdateCheck')
  );

  useEffect(() => {
    // Expose the store on window in test mode so e2e specs can simulate
    // an available update without calling the real plugin-updater APIs.
    if (typeof window !== 'undefined') {
      const w = window as unknown as { __updaterStore?: typeof useUpdaterStore };
      w.__updaterStore = useUpdaterStore;
    }
  }, []);

  useEffect(() => {
    if (!autoUpdateCheck) return;
    const initialTimer = setTimeout(() => {
      void check();
    }, INITIAL_DELAY_MS);
    const intervalTimer = setInterval(() => {
      void check();
    }, RECHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    };
  }, [check, autoUpdateCheck]);

  return <UpdateBanner />;
}

/**
 * Helper for the "Check for updates now" settings action. Forces a check
 * regardless of the autoUpdateCheck preference.
 */
export async function manualUpdateCheck(): Promise<void> {
  await useUpdaterStore.getState().check();
}

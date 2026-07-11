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
import { useUpdaterStore } from '@/platform/updater/updaterStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  getNetworkPolicyStatus,
  subscribeToOfflineModeChanges,
} from '@/platform/privacy/offlineMode';
import { isTauri } from '@tauri-apps/api/core';
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
      const w = window as unknown as {
        __updaterStore?: typeof useUpdaterStore;
      };
      w.__updaterStore = useUpdaterStore;
    }
  }, []);

  useEffect(() => {
    if (!autoUpdateCheck) return;
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    let intervalTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;
    const clearTimers = () => {
      if (initialTimer !== null) clearTimeout(initialTimer);
      if (intervalTimer !== null) clearInterval(intervalTimer);
      initialTimer = null;
      intervalTimer = null;
    };
    const scheduleIfAllowed = async () => {
      // The native policy starts deny-by-default. Do not schedule updater work
      // until it explicitly permits it; browser/test mode remains a no-op.
      if (isTauri()) {
        try {
          if ((await getNetworkPolicyStatus()).offlineMode || disposed) return;
        } catch {
          return;
        }
      }
      if (disposed) return;
      initialTimer = setTimeout(() => void check(), INITIAL_DELAY_MS);
      intervalTimer = setInterval(() => void check(), RECHECK_INTERVAL_MS);
    };
    void scheduleIfAllowed();
    const unsubscribe = subscribeToOfflineModeChanges((status) => {
      if (status.offlineMode) clearTimers();
      // Mode-off only permits an explicit manual retry. It never reschedules.
    });
    return () => {
      disposed = true;
      clearTimers();
      unsubscribe();
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

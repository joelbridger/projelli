/**
 * Updater store
 *
 * Centralizes auto-updater state for Advisor Prep Hero's check-then-prompt UI:
 *
 *   idle → checking → available → downloading → ready-to-restart
 *                  ↘ error                    ↗
 *
 * Update flow:
 *   - `check()` calls @tauri-apps/plugin-updater's `check`. In a non-Tauri
 *     environment it short-circuits to a no-op so browser tests / dev mode
 *     never log spurious updater errors.
 *   - `downloadAndInstall()` uses the Update resource's combined download
 *     + install method, plumbing per-chunk progress into `downloadProgress`
 *     so the banner can render a percent.
 *   - `restart()` calls @tauri-apps/plugin-process's `relaunch` which
 *     gracefully restarts the app to apply the installed update.
 *   - `dismiss()` hides the banner for the rest of this session without
 *     altering the underlying availability — re-mounting UpdateManager
 *     after a relaunch resets `dismissedThisSession`.
 *
 * Anti-noise rules:
 *   - Errors are logged but do NOT throw to keep the UI responsive.
 *   - 404 / network failures keep `available = null` and `status = 'idle'`
 *     so the next 24h scheduled check has a clean slate.
 *   - `check()` is a no-op when status is already 'checking', 'downloading',
 *     or 'ready-to-restart' to prevent duplicate concurrent calls.
 */

import { create } from 'zustand';
import type { Update } from '@tauri-apps/plugin-updater';

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready-to-restart'
  | 'error';

export interface DownloadProgress {
  /** Total bytes (when known from the manifest). */
  total: number;
  /** Bytes received so far. */
  downloaded: number;
}

export interface UpdaterState {
  available: Update | null;
  downloadProgress: DownloadProgress;
  status: UpdaterStatus;
  error: string | null;
  /** Hides the banner for the rest of this session. Resets on app relaunch. */
  dismissedThisSession: boolean;
  /** Last time we ran a check. Lets the manager dedupe scheduled re-checks. */
  lastCheckedAt: number | null;

  check: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  dismiss: () => void;
  restart: () => Promise<void>;
  /** Reset to a clean idle state — primarily for tests. */
  reset: () => void;
}

/**
 * Detect whether we're running inside Tauri. The plugin-updater module
 * imports invoke() which throws when called in a plain browser, so we
 * defensively gate every call site on this helper.
 */
function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  // Tauri 2 injects __TAURI_INTERNALS__; v1 used __TAURI__. Match either.
  // @ts-ignore — these globals are runtime injections.
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

const INITIAL_PROGRESS: DownloadProgress = { total: 0, downloaded: 0 };

export const useUpdaterStore = create<UpdaterState>()((set, get) => ({
  available: null,
  downloadProgress: INITIAL_PROGRESS,
  status: 'idle',
  error: null,
  dismissedThisSession: false,
  lastCheckedAt: null,

  check: async () => {
    const current = get();
    // Skip if a download / install is already underway, or another check
    // is already in flight. Prevents the 24h scheduler from firing twice
    // on top of an in-progress flow.
    if (
      current.status === 'checking' ||
      current.status === 'downloading' ||
      current.status === 'ready-to-restart'
    ) {
      return;
    }
    // Browser / test mode: never check. The updater is a Tauri-only feature.
    if (!isTauriRuntime()) {
      set({ status: 'idle', available: null, error: null, lastCheckedAt: Date.now() });
      return;
    }
    set({ status: 'checking', error: null });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        set({
          available: update,
          status: 'available',
          lastCheckedAt: Date.now(),
        });
      } else {
        set({
          available: null,
          status: 'idle',
          lastCheckedAt: Date.now(),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[updater] check failed:', message);
      // Network errors and 404s are non-fatal — drop back to idle so the
      // next scheduled check can try again.
      set({
        status: 'idle',
        available: null,
        error: message,
        lastCheckedAt: Date.now(),
      });
    }
  },

  downloadAndInstall: async () => {
    const update = get().available;
    if (!update) return;
    if (!isTauriRuntime()) return;
    set({
      status: 'downloading',
      downloadProgress: INITIAL_PROGRESS,
      error: null,
    });
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0;
          set({ downloadProgress: { total, downloaded: 0 } });
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          set({ downloadProgress: { total, downloaded } });
        } else if (event.event === 'Finished') {
          set({
            status: 'ready-to-restart',
            downloadProgress: { total: total || downloaded, downloaded },
          });
        }
      });
      // Some platforms (notably Windows NSIS) auto-restart the app during
      // install — the line below may never execute. Set ready state as a
      // safety net in case install() returns without restarting.
      if (get().status !== 'ready-to-restart') {
        set({ status: 'ready-to-restart' });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[updater] download/install failed:', message);
      set({ status: 'error', error: message });
    }
  },

  dismiss: () => {
    set({ dismissedThisSession: true });
  },

  restart: async () => {
    if (!isTauriRuntime()) return;
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[updater] relaunch failed:', message);
      set({ status: 'error', error: message });
    }
  },

  reset: () => {
    set({
      available: null,
      downloadProgress: INITIAL_PROGRESS,
      status: 'idle',
      error: null,
      dismissedThisSession: false,
      lastCheckedAt: null,
    });
  },
}));

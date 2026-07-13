import { isTauri } from '@tauri-apps/api/core';
import {
  beginOfflineModeChange,
  failOfflineModeChange,
  finishOfflineModeChange,
  setOfflineMode,
  useOfflineModeStore,
} from '@/platform/privacy/offlineMode';

// Serialize renderer → native changes. A quick on/off/on sequence must never
// let an older async command arrive last and reopen the native socket gate.
let desired = true;
let revision = 0;
let handledRevision = 0;
let running: Promise<void> | null = null;

export interface NativeNetworkLockdownBridgeState {
  /** Confirmed native state, or unknown when the desktop guard cannot be read. */
  status: 'on' | 'off' | 'unknown';
  /** UI safety decision. Unknown/pending stays paused, without claiming on. */
  blocked: boolean;
  pending: boolean;
  error: string | null;
}

/**
 * Derive UI state from the sole renderer projection of Rust NetworkPolicy.
 * There is deliberately no bridge-owned boolean or Zustand store here.
 */
export function useNativeNetworkLockdownBridgeState(): NativeNetworkLockdownBridgeState {
  const offlineMode = useOfflineModeStore((state) => state.offlineMode);
  const statusKnown = useOfflineModeStore((state) => state.statusKnown);
  const pending = useOfflineModeStore((state) => state.changePending);
  const error = useOfflineModeStore((state) => state.changeError);
  const status = statusKnown ? (offlineMode ? 'on' : 'off') : 'unknown';
  return {
    status,
    blocked: pending || status !== 'off',
    pending,
    error,
  };
}

export function getNativeNetworkLockdownBridgeState(): NativeNetworkLockdownBridgeState {
  const state = useOfflineModeStore.getState();
  const status = state.statusKnown
    ? state.offlineMode
      ? 'on'
      : 'off'
    : 'unknown';
  return {
    status,
    blocked: state.changePending || status !== 'off',
    pending: state.changePending,
    error: state.changeError,
  };
}

async function drain(): Promise<void> {
  while (handledRevision < revision) {
    const nextRevision = revision;
    const nextValue = desired;
    try {
      await setOfflineMode(nextValue);
      handledRevision = nextRevision;
      if (nextRevision === revision) {
        finishOfflineModeChange();
      }
    } catch (error: unknown) {
      handledRevision = nextRevision;
      if (nextRevision === revision) {
        failOfflineModeChange();
        console.error(
          '[Privacy] Native Network Lockdown could not be updated.',
          error,
        );
      }
    }
  }
}

/**
 * Begin moving the native socket gate to the effective UI privacy state.
 * Callers that turn protection ON invoke this before publishing their local
 * state change. Native also starts closed, so startup and failures stay safe.
 */
export function requestNativeNetworkLockdown(enabled: boolean): void {
  desired = enabled;
  revision += 1;
  // Do not paint the requested value as enforced. The existing confirmed
  // native status stays visible with an explicit updating state; an unknown
  // status keeps controls paused without claiming lockdown is on or off.
  beginOfflineModeChange();
  if (!isTauri()) {
    failOfflineModeChange();
    return;
  }
  startRunner();
}

/** Retry the last failed native change without asking the user to toggle modes. */
export function retryNativeNetworkLockdown(): void {
  const state = getNativeNetworkLockdownBridgeState();
  if (!state.error || state.pending) return;
  requestNativeNetworkLockdown(desired);
}

function startRunner(): void {
  if (!isTauri() || running) return;
  running = drain()
    .finally(() => {
      running = null;
      if (handledRevision < revision) startRunner();
    });
}

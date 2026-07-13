import { isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';

// Serialize renderer → native changes. A quick on/off/on sequence must never
// let an older async command arrive last and reopen the native socket gate.
let desired = true;
let revision = 0;
let handledRevision = 0;
let running: Promise<void> | null = null;

interface NativeNetworkLockdownBridgeState {
  /** True while native is locked, while a change is pending, or after failure. */
  blocked: boolean;
  pending: boolean;
  error: string | null;
}

/**
 * Display and renderer-side safety mirror for the native socket gate.
 *
 * This is not the security boundary (Rust is), but it keeps CRM controls
 * disabled until Rust confirms that reopening the gate really succeeded.
 */
export const useNativeNetworkLockdownBridgeState =
  create<NativeNetworkLockdownBridgeState>()(() => ({
    blocked: false,
    pending: false,
    error: null,
  }));

export function getNativeNetworkLockdownBridgeState(): NativeNetworkLockdownBridgeState {
  return useNativeNetworkLockdownBridgeState.getState();
}

async function drain(): Promise<void> {
  while (handledRevision < revision) {
    const nextRevision = revision;
    const nextValue = desired;
    try {
      const { setOfflineMode } = await import('@/platform/privacy/offlineMode');
      await setOfflineMode(nextValue);
      handledRevision = nextRevision;
      if (nextRevision === revision) {
        useNativeNetworkLockdownBridgeState.setState({
          blocked: nextValue,
          pending: false,
          error: null,
        });
      }
    } catch (error: unknown) {
      handledRevision = nextRevision;
      if (nextRevision === revision) {
        useNativeNetworkLockdownBridgeState.setState({
          // Both native failure paths are fail-closed: enabling flips memory
          // before persistence, and disabling never reopens before persistence.
          blocked: true,
          pending: false,
          error:
            'Network lockdown is still on because the privacy setting could not be updated. Nothing can leave this computer. Select Retry to try again.',
        });
        console.error(
          '[Privacy] Native Network Lockdown could not be updated; CRM remains blocked.',
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
  // Never show CRM as available while Rust is still applying the choice.
  // Enabling also becomes visible immediately, before React publishes the
  // Local-only or privileged-matter state that caused it.
  useNativeNetworkLockdownBridgeState.setState({
    blocked: true,
    pending: true,
    error: null,
  });
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

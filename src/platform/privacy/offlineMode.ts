import { invoke, isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';

export interface NetworkPolicyStatus {
  offlineMode: boolean;
  generation: number;
}

interface OfflineModeState extends NetworkPolicyStatus {
  hydrated: boolean;
  isHydrating: boolean;
  hydrationError: string | null;
}

const INITIAL_STATUS: NetworkPolicyStatus = {
  // This value is display-only. networkClient never grants a request from it.
  offlineMode: false,
  generation: 0,
};

export const useOfflineModeStore = create<OfflineModeState>()(() => ({
  ...INITIAL_STATUS,
  hydrated: false,
  isHydrating: false,
  hydrationError: null,
}));

function errorMessage(error: unknown): string {
  // Tauri command errors are often raw strings from Rust, not Error objects.
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'Could not read Offline Mode status.';
}

function assertValidPolicyStatus(
  value: unknown
): asserts value is NetworkPolicyStatus {
  const status = value as Partial<NetworkPolicyStatus> | null;
  if (
    !status ||
    typeof status.offlineMode !== 'boolean' ||
    typeof status.generation !== 'number' ||
    !Number.isSafeInteger(status.generation) ||
    status.generation < 0
  ) {
    throw new Error(
      'Lantern received an invalid Offline Mode status from the desktop app.'
    );
  }
}

function updateMirror(status: NetworkPolicyStatus): void {
  useOfflineModeStore.setState((previous) => {
    // Native generations are monotonic. Ignore a delayed older response so it
    // cannot make the display mirror move backward after a newer policy flip.
    if (previous.hydrated && status.generation < previous.generation)
      return previous;
    return {
      ...previous,
      ...status,
      hydrated: true,
      isHydrating: false,
      hydrationError: null,
    };
  });
}

/**
 * Reads the native source of truth and updates the display mirror.
 *
 * networkClient calls this fresh for every authorization. The Zustand mirror
 * must never be used to decide whether network activity is permitted; it is
 * only for display, search, and promptly cancelling work after a policy bump.
 */
export async function getNetworkPolicyStatus(): Promise<NetworkPolicyStatus> {
  if (!isTauri()) {
    throw new Error(
      'Offline Mode is only available in the Lantern desktop app.'
    );
  }

  const status = await invoke<unknown>('network_policy_status');
  assertValidPolicyStatus(status);
  updateMirror(status);
  return status;
}

/**
 * Hydrates the UI mirror without making startup fail if the desktop command is
 * temporarily unavailable. A later network action still fails closed because
 * it asks the native policy again instead of trusting this result.
 */
export async function hydrateOfflineMode(): Promise<NetworkPolicyStatus | null> {
  useOfflineModeStore.setState({ isHydrating: true, hydrationError: null });
  try {
    return await getNetworkPolicyStatus();
  } catch (error) {
    useOfflineModeStore.setState({
      isHydrating: false,
      hydrated: false,
      hydrationError: errorMessage(error),
    });
    return null;
  }
}

/**
 * Changes the native policy first, then polls its status so the display mirror
 * receives the authoritative generation. Lane 0's command contract does not
 * include a Tauri event, so we intentionally do not listen for an invented
 * event name here. If that contract later adds one, it can call updateMirror.
 */
export async function setOfflineMode(enabled: boolean): Promise<void> {
  if (!isTauri()) {
    throw new Error(
      'Offline Mode is only available in the Lantern desktop app.'
    );
  }

  await invoke('set_offline_mode', { enabled });
  try {
    await getNetworkPolicyStatus();
  } catch (error) {
    // The native change succeeded but its follow-up display read did not. Keep
    // the visible switch honest about the requested state; its generation is
    // deliberately left untouched until a real native status is available.
    useOfflineModeStore.setState({
      offlineMode: enabled,
      hydrated: false,
      hydrationError: errorMessage(error),
    });
  }
}

/** Subscribe to native-status mirror changes, primarily for cancellation. */
export function subscribeToOfflineModeChanges(
  listener: (status: NetworkPolicyStatus) => void
): () => void {
  return useOfflineModeStore.subscribe((current, previous) => {
    if (
      current.offlineMode !== previous.offlineMode ||
      current.generation !== previous.generation
    ) {
      listener({
        offlineMode: current.offlineMode,
        generation: current.generation,
      });
    }
  });
}

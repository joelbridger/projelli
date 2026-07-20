import { invoke, isTauri } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { BRAND } from '@/config/brand';

export interface NetworkPolicyStatus {
  offlineMode: boolean;
  generation: number;
  /** Native has applied a renderer privacy choice for this process. */
  hydrated: boolean;
  /** Safe startup diagnostic from the native policy, when one exists. */
  loadError: string | null;
}

interface OfflineModeState extends NetworkPolicyStatus {
  /** True only after this renderer has read NetworkPolicy::status(). */
  statusKnown: boolean;
  isHydrating: boolean;
  hydrationError: string | null;
  changePending: boolean;
  changeError: string | null;
}

const INITIAL_STATUS: NetworkPolicyStatus = {
  // No UI may interpret this value until statusKnown is true. Native starts
  // closed, and every renderer-side action treats unknown as blocked.
  offlineMode: false,
  generation: 0,
  hydrated: false,
  loadError: null,
};

/**
 * The one renderer projection of the native NetworkPolicy state.
 *
 * It is never an authority of its own: every value in it comes from
 * `NetworkPolicy::status()`. Rust's NetworkPolicy remains the socket gate and
 * the sole source of truth. Unknown renderer state is treated as blocked.
 */
export const useOfflineModeStore = create<OfflineModeState>()(() => ({
  ...INITIAL_STATUS,
  statusKnown: false,
  isHydrating: false,
  hydrationError: null,
  changePending: false,
  changeError: null,
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
    status.generation < 0 ||
    typeof status.hydrated !== 'boolean' ||
    (status.loadError !== null && typeof status.loadError !== 'string')
  ) {
    throw new Error(
      `${BRAND.name} received an invalid Offline Mode status from the desktop app.`
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
      statusKnown: true,
      isHydrating: false,
      hydrationError: null,
    };
  });
}

function markStatusUnknown(error: unknown): void {
  useOfflineModeStore.setState({
    statusKnown: false,
    isHydrating: false,
    hydrationError: errorMessage(error),
  });
}

/** Marks a requested transition without inventing its enforced result. */
export function beginOfflineModeChange(): void {
  useOfflineModeStore.setState({
    changePending: true,
    changeError: null,
  });
}

/** Clears transition state after native status has been confirmed. */
export function finishOfflineModeChange(): void {
  useOfflineModeStore.setState({
    changePending: false,
    changeError: null,
  });
}

/**
 * Reports a failed request using the enforced native status when available.
 * If native status itself cannot be read, the copy says exactly that and all
 * renderer controls remain paused instead of claiming protection is on/off.
 */
export function failOfflineModeChange(): void {
  const state = useOfflineModeStore.getState();
  const changeError = !state.statusKnown
    ? `${BRAND.name} could not confirm whether Network lockdown is on. Outside connections stay paused until the desktop privacy guard can be checked. Select Retry to try again.`
    : state.offlineMode
      ? 'Network lockdown is still on because the privacy setting could not be updated. Nothing can leave this computer. Select Retry to try again.'
      : 'Network lockdown is off, but the privacy setting could not be saved. Select Retry to try again.';
  useOfflineModeStore.setState({
    changePending: false,
    changeError,
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
      `Offline Mode is only available in the ${BRAND.name} desktop app.`
    );
  }

  try {
    const status = await invoke<unknown>('network_policy_status');
    assertValidPolicyStatus(status);
    updateMirror(status);
    return status;
  } catch (error) {
    markStatusUnknown(error);
    throw error;
  }
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
  } catch {
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
      `Offline Mode is only available in the ${BRAND.name} desktop app.`
    );
  }

  try {
    await invoke('set_offline_mode', { enabled });
  } catch (error) {
    // Enabling moves native memory closed before persistence; disabling writes
    // before reopening. In either failure direction, ask the same native
    // NetworkPolicy that guards sockets what it actually enforced. Never copy
    // the requested value into the UI as though it were confirmed.
    try {
      await getNetworkPolicyStatus();
    } catch (statusError) {
      // getNetworkPolicyStatus already marked the renderer projection unknown.
      console.warn(
        '[Privacy] Native Network Lockdown changed, but its enforced state could not be confirmed.',
        statusError,
      );
    }
    throw error;
  }
  await getNetworkPolicyStatus();
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
        hydrated: current.hydrated,
        loadError: current.loadError,
      });
    }
  });
}

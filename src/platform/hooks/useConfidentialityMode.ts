/**
 * useConfidentialityMode — read/write the active confidentiality mode.
 *
 * The mode lives in the settings store (persisted to localStorage via the
 * settings schema entry `confidentialityMode`), so it survives reloads and
 * shows up in the Settings → AI section like every other setting. This hook is
 * a thin, typed convenience wrapper so the egress indicator, status-bar mirror,
 * and the model picker all agree on the same value.
 */

import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  type ConfidentialityMode,
  CONFIDENTIALITY_MODE_SETTING_KEY,
  DEFAULT_CONFIDENTIALITY_MODE,
  CONFIDENTIALITY_MODES,
} from '@/platform/privacy/egress';
import { CONFIDENTIALITY_CHOICE_MADE_KEY } from '@/platform/privacy/resolvePersonalEgressDefault';
import { preStartLocalAi } from '@/platform/providers/localAiPreStart';
import { requestNativeNetworkLockdown } from '@/platform/privacy/nativeNetworkLockdownBridge';

const SAFE_CONFIDENTIALITY_MODE: ConfidentialityMode = 'local-only';

function coerceMode(value: unknown): ConfidentialityMode {
  if (typeof value === 'string' && (CONFIDENTIALITY_MODES as string[]).includes(value)) {
    return value as ConfidentialityMode;
  }
  return value === undefined ? DEFAULT_CONFIDENTIALITY_MODE : SAFE_CONFIDENTIALITY_MODE;
}

/** Reactive read of the active confidentiality mode. */
export function useConfidentialityMode(): ConfidentialityMode {
  const value = useSettingsStore((s) => s.getSetting(CONFIDENTIALITY_MODE_SETTING_KEY));
  // 'assured' is now a real, selectable mode for firms with a managed key. The
  // egress layer + provider construction fall back to BYOK-direct when no
  // managed key is configured, so it is always safe to return the stored value.
  return coerceMode(value);
}

/** Setter for the confidentiality mode. */
export function useSetConfidentialityMode(): (mode: ConfidentialityMode) => void {
  const setSetting = useSettingsStore((s) => s.setSetting);
  return (mode: ConfidentialityMode) => {
    if (mode === 'local-only') requestNativeNetworkLockdown(true);
    setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
  };
}

/**
 * Records an explicit, informed confidentiality choice made by the user.
 *
 * Writes TWO values atomically via the settings store:
 *   1. The chosen mode under `CONFIDENTIALITY_MODE_SETTING_KEY`.
 *   2. `true` under `CONFIDENTIALITY_CHOICE_MADE_KEY`.
 *
 * The second write is what unlocks cloud generation on personal installs:
 * `resolveEffectiveEgress` checks `choiceMade` (read from the store via the
 * same key) before it allows any cloud provider to run. A mode stored without
 * this marker is treated as an unchoiced default, not an informed decision.
 *
 * Firm installs are not affected — they bypass the choice gate entirely in
 * `resolveEffectiveEgress` — but calling this setter for a firm user is
 * harmless (the marker is simply stored and ignored).
 *
 * Fix 1 (demo readiness): selecting "On this computer only" is the clearest
 * signal a user gives that they intend to use Local AI, so this is one of the
 * two triggers (the other is app boot, see usePreStartLocalAi) that kicks off
 * the llama-server sidecar early instead of waiting for the first question.
 */
export function useRecordConfidentialityChoice(): (mode: ConfidentialityMode) => void {
  const setSetting = useSettingsStore((s) => s.setSetting);
  return (mode: ConfidentialityMode) => {
    if (mode === 'local-only') requestNativeNetworkLockdown(true);
    setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
    setSetting(CONFIDENTIALITY_CHOICE_MADE_KEY, true);
    if (mode === 'local-only') preStartLocalAi();
  };
}

/** Non-reactive read for use outside React render (e.g. provider construction). */
export function getConfidentialityMode(): ConfidentialityMode {
  const value = useSettingsStore.getState().getSetting(CONFIDENTIALITY_MODE_SETTING_KEY);
  return coerceMode(value);
}

/** Snapshot of the raw stored mode + choiceMade flag, for callers that record a
 *  tentative choice (e.g. before validating a pasted key) and need to undo it
 *  if the attempt fails. */
export interface ConfidentialityChoiceSnapshot {
  mode: unknown;
  choiceMade: unknown;
}

/** Non-reactive snapshot of the current mode + choiceMade flag. */
export function snapshotConfidentialityChoice(): ConfidentialityChoiceSnapshot {
  const state = useSettingsStore.getState();
  return {
    mode: state.getSetting(CONFIDENTIALITY_MODE_SETTING_KEY),
    choiceMade: state.getSetting(CONFIDENTIALITY_CHOICE_MADE_KEY),
  };
}

/** Restore a snapshot taken before a tentative `useRecordConfidentialityChoice`
 *  write, so a failed attempt (e.g. a rejected API key) leaves no trace. */
export function restoreConfidentialityChoice(snapshot: ConfidentialityChoiceSnapshot): void {
  const { setSetting } = useSettingsStore.getState();
  setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, snapshot.mode);
  setSetting(CONFIDENTIALITY_CHOICE_MADE_KEY, snapshot.choiceMade);
}

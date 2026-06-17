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

function coerceMode(value: unknown): ConfidentialityMode {
  if (typeof value === 'string' && (CONFIDENTIALITY_MODES as string[]).includes(value)) {
    return value as ConfidentialityMode;
  }
  return DEFAULT_CONFIDENTIALITY_MODE;
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
    setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
  };
}

/** Non-reactive read for use outside React render (e.g. provider construction). */
export function getConfidentialityMode(): ConfidentialityMode {
  const value = useSettingsStore.getState().getSetting(CONFIDENTIALITY_MODE_SETTING_KEY);
  return coerceMode(value);
}

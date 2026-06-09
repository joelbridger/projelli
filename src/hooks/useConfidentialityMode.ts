/**
 * useConfidentialityMode — read/write the active confidentiality mode.
 *
 * The mode lives in the settings store (persisted to localStorage via the
 * settings schema entry `confidentialityMode`), so it survives reloads and
 * shows up in the Settings → AI section like every other setting. This hook is
 * a thin, typed convenience wrapper so the egress indicator, status-bar mirror,
 * and the model picker all agree on the same value.
 */

import { useSettingsStore } from '@/stores/settingsStore';
import {
  type ConfidentialityMode,
  CONFIDENTIALITY_MODE_SETTING_KEY,
  DEFAULT_CONFIDENTIALITY_MODE,
  CONFIDENTIALITY_MODES,
} from '@/modules/privacy/egress';

function coerceMode(value: unknown): ConfidentialityMode {
  if (typeof value === 'string' && (CONFIDENTIALITY_MODES as string[]).includes(value)) {
    return value as ConfidentialityMode;
  }
  return DEFAULT_CONFIDENTIALITY_MODE;
}

/** Reactive read of the active confidentiality mode. */
export function useConfidentialityMode(): ConfidentialityMode {
  const value = useSettingsStore((s) => s.getSetting(CONFIDENTIALITY_MODE_SETTING_KEY));
  // `assured` is shown in the UI but never selectable, so if it somehow lands
  // in storage we fall back to the default rather than silently behaving as a
  // mode that does not exist yet.
  const mode = coerceMode(value);
  return mode === 'assured' ? DEFAULT_CONFIDENTIALITY_MODE : mode;
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
  const mode = coerceMode(value);
  return mode === 'assured' ? DEFAULT_CONFIDENTIALITY_MODE : mode;
}

/**
 * usePrivilegedMatterMode: read/write Privileged Matter Mode.
 *
 * The mode is the OR of:
 *   - a persisted manual toggle (settings key `privilegedMatterMode`), and
 *   - auto-on triggers: the active matter is privilege-tagged, OR the
 *     confidentiality mode is Local-only.
 *
 * See `modules/privacy/privilegedMatterMode.ts` for the pure resolver and the
 * documented auto-on policy. This hook is the single reactive read used by the
 * status-bar badge, the settings toggle, and the MCP UI, plus a non-reactive
 * `getPrivilegedMatterModeActive()` for use outside React (the plugin bridge's
 * network gate, the MCP auto-deny path).
 */

import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  useActiveMatterPrivileged,
  isActiveMatterPrivileged,
} from '@/platform/matter/matterStore';
import { useConfidentialityMode, getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import {
  PRIVILEGED_MATTER_MODE_SETTING_KEY,
  DEFAULT_PRIVILEGED_MATTER_MODE,
  resolvePrivilegedMatterMode,
  type PrivilegedMatterModeTrigger,
} from '@/platform/privacy/privilegedMatterMode';
import { requestNativeNetworkLockdown } from '@/platform/privacy/nativeNetworkLockdownBridge';

function coerceManual(value: unknown): boolean {
  return typeof value === 'boolean' ? value : DEFAULT_PRIVILEGED_MATTER_MODE;
}

export interface PrivilegedMatterModeState {
  /** Effective state: true when network plugins + MCP are disabled. */
  active: boolean;
  /** Why it is on (or `off`). */
  trigger: PrivilegedMatterModeTrigger;
  /** True when a privileged-matter / local-only trigger forces it on: the
   *  manual toggle cannot turn it off while this holds. */
  forced: boolean;
  /** The raw persisted manual toggle value (independent of the triggers). */
  manual: boolean;
}

/** Reactive read of the full Privileged Matter Mode state. */
export function usePrivilegedMatterMode(): PrivilegedMatterModeState {
  const manual = useSettingsStore((s) =>
    coerceManual(s.getSetting(PRIVILEGED_MATTER_MODE_SETTING_KEY)),
  );
  const activeMatterPrivileged = useActiveMatterPrivileged();
  const confidentialityMode = useConfidentialityMode();
  const resolved = resolvePrivilegedMatterMode({
    manual,
    activeMatterPrivileged,
    confidentialityMode,
  });
  return { ...resolved, manual };
}

/** Convenience: just the effective boolean (reactive). */
export function usePrivilegedMatterModeActive(): boolean {
  return usePrivilegedMatterMode().active;
}

/** Setter for the manual toggle. Forcing triggers still override it to ON. */
export function useSetPrivilegedMatterMode(): (on: boolean) => void {
  const setSetting = useSettingsStore((s) => s.setSetting);
  return (on: boolean) => {
    if (on) requestNativeNetworkLockdown(true);
    setSetting(PRIVILEGED_MATTER_MODE_SETTING_KEY, on);
  };
}

/**
 * Non-reactive read of the EFFECTIVE active state, for use outside React
 * render. The plugin bridge's network gate and the MCP auto-deny path call
 * this on every relevant action so the latest state is always honoured.
 */
export function getPrivilegedMatterModeActive(): boolean {
  const manual = coerceManual(
    useSettingsStore.getState().getSetting(PRIVILEGED_MATTER_MODE_SETTING_KEY),
  );
  return resolvePrivilegedMatterMode({
    manual,
    activeMatterPrivileged: isActiveMatterPrivileged(),
    confidentialityMode: getConfidentialityMode(),
  }).active;
}

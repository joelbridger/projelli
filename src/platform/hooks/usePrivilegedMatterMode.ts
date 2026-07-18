/**
 * usePrivilegedMatterMode: read/write Privileged Matter Mode.
 *
 * The mode is the OR of:
 *   - a persisted manual toggle (settings key `privilegedMatterMode`), and
 *   - auto-on triggers: the active matter is privilege-tagged, OR the
 *     confidentiality mode is Local-only.
 *
 * See `platform/privacy/privilegedMatterMode.ts` for the pure resolver and the
 * documented auto-on policy. This hook represents the user's requested
 * privacy choice. It must never be presented as the enforced Network Lockdown
 * state; that truth comes from Rust through `offlineMode.ts`.
 */

import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  isActiveMatterPrivileged,
} from '@/platform/matter/matterStore';
import { useSelectionOperationDecision } from '@/platform/client-context';
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
  /** Requested state after the saved choice and automatic triggers resolve. */
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
  const selection = useSelectionOperationDecision(PRIVILEGED_SELECTION_REQUEST);
  // Any unresolved/stale/disagreeing selection stays protected. A matter-only
  // selection reads the exact live matter's flag and never becomes an
  // unprotected route merely because it has no client identity.
  const activeMatterPrivileged =
    selection.kind === 'refused' ||
    (selection.kind === 'matter' && !!selection.matter.privileged);
  const confidentialityMode = useConfidentialityMode();
  const resolved = resolvePrivilegedMatterMode({
    manual,
    activeMatterPrivileged,
    confidentialityMode,
  });
  return { ...resolved, manual };
}

const PRIVILEGED_SELECTION_REQUEST = {
  operationClass: 'matter-scoped',
  allowAllMatters: true,
  requireFollowerAgreement: true,
} as const;

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
 * Non-reactive read of the requested state for callers that need to ask the
 * native policy to change. Never use this value as proof that it changed.
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

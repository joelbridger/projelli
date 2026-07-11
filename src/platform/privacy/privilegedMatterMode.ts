/**
 * Privileged Matter Mode: the exfiltration guardrail for confidential client
 * work.
 *
 * The architecture review flagged network-capable extensions (a plugin holding
 * the `network` permission, or an MCP server invoked by an external client) as
 * an exfiltration surface: a plugin that can both read your workspace and reach
 * the network can move a privileged document off the machine. Privileged Matter
 * Mode is a single, global guardrail that closes that surface.
 *
 * When ON:
 *   - Every plugin API call that requires the `network` permission is BLOCKED
 *     in `PluginAPIBridge`, regardless of what the plugin's manifest was
 *     granted. This is an additional global gate layered on top of the normal
 *     per-manifest permission check; it reuses the same denial path (so it
 *     audits and replies to the worker identically).
 *   - MCP servers are treated as disabled: any pending MCP write is auto-denied
 *     rather than prompted, and the MCP settings UI says so.
 *   - A persistent badge states that network extensions are disabled.
 *
 * Non-network plugin capabilities (editor, workspace, storage, ai.invoke, etc.)
 * keep working, so the mode is usable, not all-or-nothing. Only the egress
 * surface (`network.fetch` + MCP) is gated.
 *
 * This module is intentionally PURE and dependency-free so the bridge, the
 * stores, the badge, and the test suite all derive the SAME meaning from the
 * SAME inputs. The reactive read/write lives in `usePrivilegedMatterMode`; the
 * non-reactive `getPrivilegedMatterModeActive()` reads the same settings store
 * for use outside React (e.g. the bridge's network gate).
 */

import { isPrivileged, type Privilege } from '@/platform/types/privilege';
import type { ConfidentialityMode } from '@/platform/privacy/egress';

/**
 * Settings key the manual toggle persists under. Stored in the settings store
 * (localStorage `lantern:settings`) like every other setting, so it survives
 * reloads. A boolean: `true` means the user has manually turned the mode on.
 */
export const PRIVILEGED_MATTER_MODE_SETTING_KEY = 'privilegedMatterMode';

/** Default for the manual toggle. Off by default; auto-on (below) handles the
 *  safe cases without the user having to find this switch first. */
export const DEFAULT_PRIVILEGED_MATTER_MODE = false;

/**
 * The reason code attached to a network block, surfaced to the plugin worker
 * and recorded in the audit log. Kept stable so callers/tests can match on it.
 */
export const PRIVILEGED_MATTER_BLOCK_REASON =
  'Privileged Matter Mode is on: network extensions are disabled to keep confidential work on this machine.';

/**
 * Inputs that decide whether the mode is effectively ON. The effective state is
 * the OR of the manual toggle and the auto-on triggers, so a privileged matter
 * can never silently allow network extensions even if the user never flipped
 * the manual switch.
 */
export interface PrivilegedMatterModeInputs {
  /** The persisted manual toggle. */
  manual: boolean;
  /** True when the ACTIVE matter is tagged privileged (a deliberate per-matter
   *  designation the user sets on the matter). */
  activeMatterPrivileged: boolean;
  /** The active confidentiality mode; Local-only is itself a "nothing leaves"
   *  posture, so network extensions must be off there too. */
  confidentialityMode: ConfidentialityMode;
}

/** Why the mode is on, for honest UI copy. `manual` only when nothing forces it. */
export type PrivilegedMatterModeTrigger =
  | 'off'
  | 'manual'
  | 'privileged-matter'
  | 'local-ai-only';

/**
 * Resolve whether Privileged Matter Mode is effectively active, and why.
 *
 * Auto-on policy (safer default, documented): when the active matter is
 * privilege-tagged OR the confidentiality mode is Local-only, the mode is
 * forced ON. This is auto-enable, not merely a suggestion: the whole point is
 * that a privileged matter must not be one forgotten toggle away from leaking
 * through an extension. The manual toggle can turn it on for any matter, but it
 * cannot turn it OFF while a privileged-matter / local-only trigger holds (the
 * UI reflects this by disabling the switch with an explanation).
 */
export function resolvePrivilegedMatterMode(
  inputs: PrivilegedMatterModeInputs,
): { active: boolean; trigger: PrivilegedMatterModeTrigger; forced: boolean } {
  const forcedByMatter = inputs.activeMatterPrivileged;
  const forcedByLocalOnly = inputs.confidentialityMode === 'local-only';
  const forced = forcedByMatter || forcedByLocalOnly;

  if (forcedByMatter) return { active: true, trigger: 'privileged-matter', forced: true };
  if (forcedByLocalOnly) return { active: true, trigger: 'local-ai-only', forced: true };
  if (inputs.manual) return { active: true, trigger: 'manual', forced: false };
  return { active: false, trigger: 'off', forced };
}

/** Convenience: just the boolean. */
export function isPrivilegedMatterModeActive(inputs: PrivilegedMatterModeInputs): boolean {
  return resolvePrivilegedMatterMode(inputs).active;
}

/** True when any of the given source privileges marks a privileged matter. */
export function anyPrivileged(privileges: Iterable<Privilege>): boolean {
  for (const p of privileges) {
    if (isPrivileged(p)) return true;
  }
  return false;
}

/**
 * Pure privilege-resolution helpers (WS-PRIV).
 *
 * Given a source id (an absolute file path, a `mail:<id>` id, or a `.aichat`
 * path) and the per-source privilege map, decide the source's privilege status.
 * Kept free of React and Zustand so the indexer, the chat, the UI, and the
 * tests can all share one source of truth — exactly like `matterResolver`.
 *
 * Unlike matters (which map via folder containment), privilege is tagged
 * DIRECTLY on a source, so resolution is a normalized-key map lookup. A source
 * with no entry resolves to `none` (the safe default), mirroring the Rust
 * indexer's `PRIVILEGE_NONE` default.
 */

import { DEFAULT_PRIVILEGE, type Privilege } from '@/platform/types/privilege';

/**
 * Normalise a source id for use as a privilege-map key. File paths use
 * backslash → slash and trailing-slash stripping (so the same file always maps
 * to the same key regardless of separator). `mail:<id>` ids are left intact
 * apart from trimming, since they are not filesystem paths.
 */
export function normalizeSourceId(sourceId: string): string {
  if (!sourceId) return '';
  const trimmed = sourceId.trim();
  if (trimmed.startsWith('mail:')) return trimmed;
  return trimmed.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * The persisted privilege map shape: normalized source id → privilege. Only
 * non-`none` entries are stored (a `none` source is the default and is removed
 * from the map), so the map stays small and "is anything privileged?" is cheap.
 */
export type PrivilegeMap = Record<string, Privilege>;

/**
 * Resolve a source id to its privilege status using the current map. Returns
 * `none` when the source has no entry (the safe default). Never throws.
 */
export function resolvePrivilege(
  sourceId: string,
  map: PrivilegeMap,
): Privilege {
  if (!sourceId) return DEFAULT_PRIVILEGE;
  const key = normalizeSourceId(sourceId);
  return map[key] ?? DEFAULT_PRIVILEGE;
}

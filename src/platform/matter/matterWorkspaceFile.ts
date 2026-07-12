/**
 * matterWorkspaceFile — read/write the WORKSPACE's own durable copy of the
 * matter/client organization (`.lantern/matters.json`).
 *
 * WHY THIS EXISTS (2026-07 Windows-bench data-loss fix): matter records used to
 * live ONLY in browser-profile-scoped localStorage. A WebView2 profile reset,
 * cache clear, reinstall, or new-machine migration permanently destroyed every
 * client/matter mapping while the workspace's document files survived intact
 * but orphaned. The workspace folder is where the user's data durably lives, so
 * the organization of that data must live there too: this file is the SOURCE OF
 * TRUTH, and the localStorage keys (`lantern:matters…`) are demoted to a fast
 * cache (see `matterStore.ts` → `hydrateMattersFromWorkspaceDisk`).
 *
 * All I/O goes through WorkspaceService (never direct fs access — repo rule),
 * which also means vault workspaces get this file encrypted by the
 * VaultFSBackend exactly like every other workspace write. Writes are atomic
 * (temp file + rename), mirroring `mcpSessionScope.ts`'s established pattern,
 * so a crash mid-write can never leave a half-written organization file.
 *
 * This module is PURE disk I/O — it deliberately does not import the matter
 * store (the store imports this module for its write-through, so an import
 * back would be a cycle).
 */

import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { workspacePath } from '@/platform/fs/appPath';
import { MATTERS_WORKSPACE_REL_PATH } from '@/config/identity';
export { MATTERS_WORKSPACE_REL_PATH } from '@/config/identity';

/** The on-disk envelope. `state` carries the same partialized shape the
 *  localStorage envelopes split across three keys ({ matters, activeMatterId,
 *  snapshots, cache }); `version` is the matter store's persisted schema
 *  version so the store's own `migrate` chain can upgrade older files. */
interface MattersWorkspaceFilePayload {
  version: number;
  savedAt: string;
  state: unknown;
}

/** Sibling that briefly holds the PREVIOUS durable copy while an atomic
 *  replacement is in flight on backends whose rename can't overwrite (see
 *  `writeMattersWorkspaceFile`). Consulted by reads when the main file is
 *  missing, so a crash mid-replacement can never lose the organization. */
const MATTERS_WORKSPACE_BAK_REL_PATH = `${MATTERS_WORKSPACE_REL_PATH}.bak`;

export type MattersWorkspaceFileReadResult =
  /** File present and well-formed; `state` still needs the store's schema
   *  migration. `recoveredFromBackup` = the main file was missing and this
   *  came from the `.bak` sibling (caller should re-commit it to the main
   *  file). */
  | { status: 'ok'; state: unknown; version: number; recoveredFromBackup?: boolean }
  /** No file — a workspace never opened since this fix (or genuinely empty). */
  | { status: 'absent' }
  /** File present but not valid JSON / not the expected envelope shape. Raw
   *  bytes returned so the caller can back them up before rebuilding. */
  | { status: 'corrupt'; raw: string }
  /** The file EXISTS but could not be read (I/O error). Fail-safe: the caller
   *  must neither trust the cache over it nor overwrite it this session. */
  | { status: 'error'; error: unknown };

/** Parse raw file bytes into an ok/corrupt result. A structurally-empty
 *  `state` (no `matters` ARRAY) is classified CORRUPT, not ok — otherwise a
 *  truncated-but-valid-JSON file like `{"version":10,"state":{}}` would
 *  hydrate as "zero clients", silently overwrite the good localStorage cache,
 *  and skip the corrupt-file backup (Codex review P2). */
function parseMattersFileRaw(raw: string): MattersWorkspaceFileReadResult {
  try {
    const parsed = JSON.parse(raw) as Partial<MattersWorkspaceFilePayload> | null;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.version !== 'number' ||
      typeof parsed.state !== 'object' ||
      parsed.state === null ||
      !Array.isArray((parsed.state as { matters?: unknown }).matters)
    ) {
      return { status: 'corrupt', raw };
    }
    return { status: 'ok', state: parsed.state, version: parsed.version };
  } catch {
    return { status: 'corrupt', raw };
  }
}

export async function readMattersWorkspaceFile(
  service: WorkspaceService,
  workspaceRoot: string,
): Promise<MattersWorkspaceFileReadResult> {
  const path = workspacePath(workspaceRoot, MATTERS_WORKSPACE_REL_PATH);
  const bakPath = workspacePath(workspaceRoot, MATTERS_WORKSPACE_BAK_REL_PATH);
  try {
    if (await service.exists(path)) {
      return parseMattersFileRaw(await service.readFile(path));
    }
    // Main file missing — a crash between the replace steps may have left the
    // previous durable copy parked at the .bak sibling. Recover it.
    if (await service.exists(bakPath)) {
      const result = parseMattersFileRaw(await service.readFile(bakPath));
      if (result.status === 'ok') {
        console.warn(
          '[matterWorkspaceFile] main matters file missing; recovered the previous copy from its .bak sibling',
        );
        return { ...result, recoveredFromBackup: true };
      }
      return result; // corrupt bak → caller backs it up + rebuilds from cache
    }
    return { status: 'absent' };
  } catch (error) {
    return { status: 'error', error };
  }
}

/** Atomically write the workspace matters file (temp + rename, the same
 *  pattern as `mcpSessionScope.ts`). WorkspaceService.writeFile creates the
 *  `.lantern` parent folder if it's missing. */
export async function writeMattersWorkspaceFile(
  service: WorkspaceService,
  workspaceRoot: string,
  state: unknown,
  version: number,
): Promise<void> {
  const payload: MattersWorkspaceFilePayload = {
    version,
    savedAt: new Date().toISOString(),
    state,
  };
  const tempRelPath = `${MATTERS_WORKSPACE_REL_PATH}.tmp-${String(Date.now())}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const tempPath = workspacePath(workspaceRoot, tempRelPath);
  const finalPath = workspacePath(workspaceRoot, MATTERS_WORKSPACE_REL_PATH);
  let moved = false;

  await service.writeFile(tempPath, JSON.stringify(payload, null, 2));
  try {
    try {
      await service.move(tempPath, finalPath);
    } catch {
      // This backend's rename can't overwrite an existing file. NEVER
      // delete-then-move here — a crash between those two steps would destroy
      // the ONLY durable copy of the client organization (Codex review P1).
      // Instead PARK the current file at the .bak sibling, move the new one
      // in, then drop the parked copy: at every instant either the main file
      // or its .bak exists with a complete previous state, and reads recover
      // from .bak when the main file is missing.
      const bakPath = workspacePath(workspaceRoot, MATTERS_WORKSPACE_BAK_REL_PATH);
      // eslint-disable-next-line lantern-async/no-silent-failure -- clearing a stale bak is best-effort; the parking move below throws if it truly matters
      await service.delete(bakPath).catch(() => undefined);
      let parked = false;
      try {
        await service.move(finalPath, bakPath);
        parked = true;
      } catch {
        // The main file may simply not exist (first write on such a backend).
        parked = false;
      }
      await service.move(tempPath, finalPath);
      if (parked) {
        // eslint-disable-next-line lantern-async/no-silent-failure -- best-effort cleanup; a leftover bak is harmless (reads prefer the main file)
        await service.delete(bakPath).catch(() => undefined);
      }
    }
    moved = true;
  } finally {
    if (!moved) {
      // eslint-disable-next-line lantern-async/no-silent-failure -- best-effort temp cleanup on the failure path; the original error is already propagating
      await service.delete(tempPath).catch(() => undefined);
    }
  }
}

/** Preserve an unparseable matters file's raw bytes under a timestamped
 *  `.corrupt-…` sibling before the main file is rebuilt — client organization
 *  is never silently destroyed, even when it can't be read. Returns whether
 *  the backup actually landed: on `false` the caller MUST leave the main file
 *  untouched (rebuilding over it would destroy the only recoverable copy). */
export async function backupCorruptMattersWorkspaceFile(
  service: WorkspaceService,
  workspaceRoot: string,
  raw: string,
): Promise<boolean> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rel = `${MATTERS_WORKSPACE_REL_PATH}.corrupt-${stamp}`;
  try {
    await service.writeFile(workspacePath(workspaceRoot, rel), raw);
    return true;
  } catch (err) {
    console.warn('[matterWorkspaceFile] could not back up the corrupt matters file:', err);
    return false;
  }
}

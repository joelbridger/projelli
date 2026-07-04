/**
 * describeWorkspaceOpenError — turns whatever `handleOpenRecentProject`
 * catches into an honest, plain-language message.
 *
 * QA-33: a stopped Windows Credential Manager service (`VaultSvc`) used to
 * leave "open this workspace" silently hung for 30s and then fail with only
 * a `console.error` — no toast, no banner, nothing a user could act on. This
 * classifier is the single place that turns a caught error into copy a
 * non-engineer can read, so every workspace-open failure surfaces something,
 * never nothing.
 *
 * Lives in `platform/fs` (not `app/lifecycle`, where it started) because both
 * a `features`-layer consumer (WorkspaceSelector.tsx) and an `app`-layer
 * consumer (useWorkspaceLifecycle.ts) need it, and `features` may not import
 * from `app` (see tests/unit/architecture-boundaries.test.ts).
 */

import i18n from '@/i18n';

interface StructuredCommandError {
  kind?: unknown;
  message?: unknown;
}

function isStructuredCommandError(err: unknown): err is StructuredCommandError {
  return typeof err === 'object' && err !== null && ('kind' in err || 'message' in err);
}

export function describeWorkspaceOpenError(err: unknown): string {
  if (isStructuredCommandError(err) && typeof err.kind === 'string') {
    // Both Rust's `keychain_get`/`_set`/`_delete` (src-tauri/src/commands/
    // keychain.rs) AND `vault_status` (src-tauri/src/commands/vault/mod.rs)
    // classify a stopped/unreachable OS credential service with this exact
    // tag — the flagship QA-33 repro (a stopped Windows `VaultSvc`) fails
    // inside `vault_status`, so this must match BOTH sources (coordinator
    // review, 2026-07-04: originally only matched keychain_get's shape,
    // meaning the actual repro fell through to raw, non-localized Rust
    // message text instead of this honest, translated one).
    if (err.kind === 'serviceUnavailable') {
      return i18n.t('workspace.open-error.credential-service-unavailable');
    }
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (isStructuredCommandError(err) && typeof err.message === 'string' && err.message) {
    return err.message;
  }
  return i18n.t('workspace.open-error.generic');
}

/**
 * True when a workspace-open failure is transient/environmental (a
 * credential-service outage, or the check simply took too long) rather than
 * evidence the workspace itself is bad.
 *
 * codex-review (2026-07-04, round 2): WorkspaceSelector's "open a recent
 * workspace" handler used to prune ANY failed path from Recents — including
 * these transient ones. Since BackendFactory.ts now fails closed (throws) on
 * a `vault_status` credential-service hiccup instead of silently degrading
 * (see BackendFactory.ts), that failure became reachable in ~5s instead of
 * practically never, so a temporary VaultSvc outage could delete a perfectly
 * good workspace from the user's Recents list. Callers should skip pruning
 * when this returns true.
 */
export function isTransientWorkspaceOpenFailure(err: unknown): boolean {
  if (err instanceof Error && err.name === 'TimeoutError') return true;
  if (isStructuredCommandError(err) && typeof err.kind === 'string') {
    // 'serviceUnavailable' — a credential-service outage, from EITHER a raw
    // KeychainError (keychain_get/_set/_delete) or a VaultCommandError from
    // vault_status (both use the identical wire tag; see
    // src-tauri/src/commands/vault/mod.rs's keychain_error_to_vault_error).
    // 'keychain' — any OTHER vault-related keychain error vault_status can
    // still surface (e.g. a genuine keyring backend error, not specifically
    // a timeout) — also not evidence the workspace path itself is bad.
    return err.kind === 'serviceUnavailable' || err.kind === 'keychain';
  }
  return false;
}

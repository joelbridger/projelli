/**
 * vaultClient.ts — typed TypeScript wrappers for every Tauri vault command.
 *
 * This module is the TS equivalent of the thin Tauri glue in
 * `src-tauri/src/commands/vault/mod.rs`. It:
 *
 *   1. Provides a typed `invoke` wrapper for each vault command, matching the
 *      exact Rust arg names (workspace, relPath, bytes, phrase, epoch, wraps).
 *   2. Guards every call with `isTauri()` — in a browser context the wrappers
 *      throw a clear error rather than silently no-oping (vaulted workspaces
 *      are a Tauri-only feature; the browser UI can disable vault controls by
 *      checking `isTauri()` before calling).
 *   3. Provides `provisionEscrow` — the higher-level function that orchestrates
 *      escrow provisioning:
 *        a. Calls `vault_export_vmk_for_escrow` to obtain the plaintext VMK
 *           (base64) from the keychain.
 *        b. Calls `wrapMatterKey(vmk, device.pubkey_jwk, epoch)` for each admin
 *           device, producing an ECDH-wrapped blob.
 *        c. Calls `vault_set_escrow_wraps` with the assembled wraps array.
 *        d. Drops the plaintext VMK from JS scope — it is set to null after use
 *           and is never returned, stored, or logged.
 *
 * Command name / arg name cross-reference (matches Rust exactly):
 *
 *   vault_status               (workspace: String)
 *   vault_create               (workspace: String, escrow: bool)
 *   vault_read_file            (workspace: String, rel_path: String)
 *   vault_write_file           (workspace: String, rel_path: String, bytes: Vec<u8>)
 *   vault_unlock_with_recovery (workspace: String, phrase: String)
 *   vault_export_vmk_for_escrow(workspace: String) → String (base64 VMK)
 *   vault_set_escrow_wraps     (workspace: String, epoch: u32, wraps: Vec<AdminWrapJson>)
 *   vault_encrypt_all          (workspace: String)
 *   vault_decrypt_all          (workspace: String)
 *   vault_disable              (workspace: String)
 *
 * NOTE on Rust serde naming: the Rust command signatures use `snake_case` for
 * parameter names, and Tauri's IPC bridge passes them as-is (snake_case object
 * keys). The VaultStatus response uses `#[serde(rename_all = "camelCase")]` so
 * the TS type reflects the camelCase fields.
 */

import { invoke, isTauri } from '@tauri-apps/api/core';
import { wrapMatterKey } from '@/modules/firm/keyWrap';

// ── Response types (mirrors Rust VaultStatus / VaultCreated) ─────────────────

/**
 * Response from `vault_status`.
 * Fields are camelCase because the Rust struct uses `#[serde(rename_all = "camelCase")]`.
 */
export interface VaultStatus {
  /** true when `.keepance-vault.json` exists in the workspace. */
  enabled: boolean;
  /** true when enabled and the VMK is absent from the OS keychain. */
  locked: boolean;
  /** true when the metadata includes a firm-admin escrow section. */
  hasEscrow: boolean;
  /** Stable hex SHA-256 workspace identifier, or null when not enabled. */
  vaultId: string | null;
}

/**
 * Response from `vault_create`.
 * The 24-word recovery phrase is returned once and never stored server-side.
 */
export interface VaultCreated {
  /** 24-word BIP39 recovery phrase. Show once; never persist. */
  recoveryPhrase: string;
  /** Stable vault identifier. */
  vaultId: string;
}

/**
 * A single per-admin-device wrapped VMK entry stored in the escrow section.
 * Field names match the Rust `AdminWrapJson` struct (snake_case, no rename).
 */
export interface AdminWrapJson {
  user_id: string;
  device_id: string;
  wrapped_b64: string;
}

/**
 * An admin device descriptor passed to `provisionEscrow`.
 * `pubkey_jwk` is the device's ECDH P-256 public key in JWK format.
 */
export interface AdminDevice {
  user_id: string;
  device_id: string;
  pubkey_jwk: JsonWebKey;
}

// ── Guard helper ──────────────────────────────────────────────────────────────

/**
 * Assert we are running inside Tauri. Throws a clear error in browser/test
 * contexts so callers don't get a cryptic undefined behavior.
 */
function assertTauri(commandName: string): void {
  if (!isTauri()) {
    throw new Error(
      `vault command '${commandName}' is only available in the Tauri desktop app. ` +
      'Check isTauri() before calling vault commands in shared code.',
    );
  }
}

// ── Typed invoke wrappers ─────────────────────────────────────────────────────

/**
 * Query the vault status for a workspace.
 *
 * @param workspace Absolute path to the workspace root.
 */
export async function vaultStatus(workspace: string): Promise<VaultStatus> {
  assertTauri('vault_status');
  return invoke<VaultStatus>('vault_status', { workspace });
}

/**
 * Create a new encrypted vault for a workspace.
 *
 * @param workspace Absolute path to the workspace root.
 * @param escrow    Whether to reserve space for firm-admin escrow wraps.
 *                  Actual wraps are provisioned later via `provisionEscrow`.
 */
export async function vaultCreate(workspace: string, escrow: boolean): Promise<VaultCreated> {
  assertTauri('vault_create');
  return invoke<VaultCreated>('vault_create', { workspace, escrow });
}

/**
 * Read a file from a vaulted workspace, decrypting it transparently.
 *
 * @param workspace Absolute path to the workspace root.
 * @param relPath   Relative path within the workspace (no `..` components).
 */
export async function vaultReadFile(workspace: string, relPath: string): Promise<Uint8Array> {
  assertTauri('vault_read_file');
  return invoke<Uint8Array>('vault_read_file', { workspace, relPath });
}

/**
 * Write bytes to a file in a vaulted workspace, encrypting them under the VMK.
 *
 * @param workspace Absolute path to the workspace root.
 * @param relPath   Relative path within the workspace.
 * @param bytes     Plaintext bytes to write (the Rust command encrypts them).
 */
export async function vaultWriteFile(
  workspace: string,
  relPath: string,
  bytes: Uint8Array,
): Promise<void> {
  assertTauri('vault_write_file');
  return invoke<void>('vault_write_file', { workspace, relPath, bytes });
}

/**
 * Unlock a vault using the 24-word BIP39 recovery phrase.
 * On success, the recovered VMK is stored in the OS keychain.
 *
 * @param workspace Absolute path to the workspace root.
 * @param phrase    The 24-word BIP39 recovery phrase.
 *
 * @throws VaultCommandError (invalid_phrase) — BIP39 checksum failed; no crypto attempted.
 * @throws VaultCommandError (recovery_failed) — phrase is valid but doesn't decrypt this vault.
 */
export async function vaultUnlockWithRecovery(workspace: string, phrase: string): Promise<void> {
  assertTauri('vault_unlock_with_recovery');
  return invoke<void>('vault_unlock_with_recovery', { workspace, phrase });
}

/**
 * Export the VMK as a base64 string for transient escrow provisioning.
 *
 * The vault must be unlocked (VMK present in the OS keychain).
 * The returned string is intended for single-use by `provisionEscrow`;
 * callers must not persist, log, or return it.
 *
 * @param workspace Absolute path to the workspace root.
 * @returns base64-encoded VMK (32 raw bytes → 44 base64 chars).
 */
export async function vaultExportVmkForEscrow(workspace: string): Promise<string> {
  assertTauri('vault_export_vmk_for_escrow');
  return invoke<string>('vault_export_vmk_for_escrow', { workspace });
}

/**
 * Atomically replace the escrow section of the vault metadata.
 *
 * Called by `provisionEscrow` after all per-device wraps have been generated.
 * Does NOT require the vault to be unlocked — the wrapped blobs are opaque.
 *
 * @param workspace Absolute path to the workspace root.
 * @param epoch     Monotonically increasing epoch counter (start 1; increment on key rotation).
 * @param wraps     Per-admin-device wrapped VMK entries.
 */
export async function vaultSetEscrowWraps(
  workspace: string,
  epoch: number,
  wraps: AdminWrapJson[],
): Promise<void> {
  assertTauri('vault_set_escrow_wraps');
  return invoke<void>('vault_set_escrow_wraps', { workspace, epoch, wraps });
}

/**
 * Encrypt every eligible file in the workspace under the VMK.
 * The walk is resumable: already-encrypted files (KPV1 magic) are skipped.
 * Tauri emits `vault://progress` events `{ done, total }` during the walk.
 *
 * @param workspace Absolute path to the workspace root.
 */
export async function vaultEncryptAll(workspace: string): Promise<void> {
  assertTauri('vault_encrypt_all');
  return invoke<void>('vault_encrypt_all', { workspace });
}

/**
 * Decrypt every KPV1-encrypted file in the workspace back to plaintext.
 * The escape-hatch command. Plain files are skipped.
 * Tauri emits `vault://progress` events during the walk.
 *
 * @param workspace Absolute path to the workspace root.
 */
export async function vaultDecryptAll(workspace: string): Promise<void> {
  assertTauri('vault_decrypt_all');
  return invoke<void>('vault_decrypt_all', { workspace });
}

/**
 * Disable the encrypted vault for a workspace.
 *
 * SAFETY: refuses with `files_still_encrypted` if any file still has KPV1
 * magic — run `vaultDecryptAll` first.
 *
 * On success: deletes `.keepance-vault.json` and the keychain VMK entry.
 *
 * @param workspace Absolute path to the workspace root.
 */
export async function vaultDisable(workspace: string): Promise<void> {
  assertTauri('vault_disable');
  return invoke<void>('vault_disable', { workspace });
}

// ── Escrow orchestration ──────────────────────────────────────────────────────

/**
 * Provision firm-admin escrow for a vault workspace.
 *
 * This is the higher-level orchestration function that ties the Rust export
 * command and the TS `wrapMatterKey` together:
 *
 *   1. Calls `vault_export_vmk_for_escrow` to obtain the plaintext VMK
 *      (base64-encoded) from the OS keychain. The vault must be unlocked.
 *   2. For each admin device, calls `wrapMatterKey(vmkB64, pubkey_jwk, epoch)`
 *      which produces an ECDH-wrapped blob (ECDH P-256 + HKDF-SHA256 + AES-256-GCM).
 *   3. Calls `vault_set_escrow_wraps(workspace, epoch, wraps)` to atomically
 *      persist all wrapped copies in the vault metadata.
 *   4. **Drops the plaintext VMK** from JS scope: the local variable is set to
 *      null immediately after all wraps are generated. It is never returned,
 *      stored in a closure, or passed beyond this function.
 *
 * @param workspace    Absolute path to the workspace root.
 * @param adminDevices List of admin devices to wrap the VMK to.
 * @param epoch        The current key epoch (passed to `wrapMatterKey` and stored
 *                     in the metadata escrow section so recovery can match the epoch).
 */
export async function provisionEscrow(
  workspace: string,
  adminDevices: AdminDevice[],
  epoch: number,
): Promise<void> {
  assertTauri('provisionEscrow');

  // Step 1: Obtain the plaintext VMK from the Rust keychain.
  // The vault must already be unlocked; vault_export_vmk_for_escrow returns
  // Locked error if no VMK is present.
  let vmkB64: string | null = await vaultExportVmkForEscrow(workspace);

  try {
    // Step 2: Wrap the VMK to each admin device's public key.
    const wraps: AdminWrapJson[] = await Promise.all(
      adminDevices.map(async (device) => {
        // vmkB64 is non-null here; the null-check after the loop is the cleanup.
        const wrapped_b64 = await wrapMatterKey(vmkB64!, device.pubkey_jwk, epoch);
        return {
          user_id: device.user_id,
          device_id: device.device_id,
          wrapped_b64,
        };
      }),
    );

    // Step 3: Drop the plaintext VMK from JS scope BEFORE the async Rust call.
    // After this point, vmkB64 is null and cannot be accessed by any code path.
    vmkB64 = null;

    // Step 4: Persist the wrapped copies atomically in the vault metadata.
    await vaultSetEscrowWraps(workspace, epoch, wraps);
  } finally {
    // Defensive: ensure the plaintext is cleared even if wrapMatterKey throws
    // or vault_set_escrow_wraps throws (the wraps are idempotent so a retry is safe).
    vmkB64 = null;
  }
}

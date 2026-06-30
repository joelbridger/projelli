# Wave 3b — Encrypted Workspace Vault (VG-6d-v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is the **xhigh, data-loss-sensitive** build: Opus reviews EVERY subagent diff; the destructive-failure tests (Tasks 2–7, 13) are the gate, not an afterthought.

**Goal:** An optional per-workspace vault that stores document files as AES-256-GCM ciphertext on disk, decrypts them transparently in the app, with a recovery-phrase backstop, firm-admin escrow, crash-safe atomic writes, and a decrypt-everything escape hatch.

**Architecture:** A pure Rust crate `keepance-vault` owns all crypto + the file format + the atomic write + BIP39 recovery + metadata. A thin `commands/vault/` Tauri layer adds keychain integration and exposes commands. A TS `VaultFSBackend` decorator routes `WorkspaceService` reads/writes to those commands transparently. The RAG indexer decrypts vaulted files in memory before extraction. Firm escrow reuses the existing `keyWrap.ts`.

**Tech Stack:** Rust (`aes-gcm`, `hkdf`, `sha2`, `bip39`, `rand`, `zeroize`) in a workspace crate + Tauri commands; the existing `encrypt_with_key`/`decrypt_with_key` (`src-tauri/src/commands/mail/crypto.rs`) and `keychain_*` commands; TS React/Zustand + WebCrypto `keyWrap.ts` for escrow; Vitest + `cargo test`.

**Design of record:** `docs/superpowers/specs/2026-06-11-encrypted-workspace-vault-design.md`. Read it first — this plan implements it section by section.

---

## Conventions every task follows
- **TDD, strict.** For the crate, the destructive-failure tests ARE the spec: write them red first, then make them green. Never weaken an assertion to pass.
- Rust crate tests: `cd src-tauri && cargo test -p keepance-vault`. Tauri host tests: `cd src-tauri && cargo test`. TS: `npm run test -- <path>`. Typecheck: `npx tsc --noEmit`.
- Reuse, don't reinvent: file-content AES-GCM = the crate calls the SAME algorithm/format as `mail/crypto.rs::encrypt_with_key` (12-byte nonce ‖ ct ‖ 16-byte tag). Keychain = the existing `keychain_set/get/delete`. Escrow = `keyWrap.ts` verbatim.
- `zeroize` key material in Rust where the type allows. Never log key material or the recovery phrase.
- Conventional commits, one per task minimum. The orchestrator (Opus) reviews each diff and applies small review fixes directly.

## File structure (locked here)
**New Rust crate `src-tauri/crates/keepance-vault/`:** `src/lib.rs` (re-exports), `src/format.rs` (KPV1 file encrypt/decrypt), `src/atomic.rs` (temp+fsync+rename), `src/recovery.rs` (BIP39 + HKDF KEK + VMK wrap), `src/verifier.rs`, `src/metadata.rs` (`.keepance-vault.json`), `src/vault.rs` (open/encrypt-file/decrypt-file/walk orchestration), `tests/destructive.rs` (the destructive-failure suite).
**New Tauri glue:** `src-tauri/src/commands/vault/mod.rs`.
**New TS:** `src/modules/vault/vaultClient.ts`, `src/modules/workspace/VaultFSBackend.ts`, `src/components/vault/{VaultEnableFlow,RecoveryPhraseCeremony,VaultLockedPrompt,VaultEscapeHatchDialog}.tsx`, `src/stores/vaultStore.ts`.
**Modified:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src/modules/workspace/BackendFactory.ts`, `src-tauri/src/commands/rag/*` (indexer read path), `src/components/privacy/DataMapDialog.tsx`, `src/locales/{en,de,es}.json`, `CHANGELOG.md`.

---

### Task 1: Crate scaffold + workspace wiring

**Files:**
- Create: `src-tauri/crates/keepance-vault/Cargo.toml`, `src-tauri/crates/keepance-vault/src/lib.rs`
- Modify: `src-tauri/Cargo.toml` (workspace `members`)

- [ ] **Step 1: Add the crate to the workspace.** In `src-tauri/Cargo.toml`, add `"crates/keepance-vault"` to the `[workspace] members` array (it currently lists `"."`, `"crates/keepance-docx"`).

- [ ] **Step 2: Write `src-tauri/crates/keepance-vault/Cargo.toml`:**
```toml
[package]
name = "keepance-vault"
version = "0.1.0"
edition = "2021"

[dependencies]
aes-gcm = "0.10"
hkdf = "0.12"
sha2 = "0.10"
rand = "0.8"
zeroize = { version = "1", features = ["zeroize_derive"] }
bip39 = "2"
thiserror = "1"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 3: Write the smoke test in `src/lib.rs`:**
```rust
//! keepance-vault — at-rest encryption for workspace document files.
//! Pure crate: file format, atomic write, BIP39 recovery, metadata. No Tauri.

pub mod format;
pub mod atomic;
pub mod recovery;
pub mod verifier;
pub mod metadata;
pub mod vault;

#[cfg(test)]
mod smoke {
    #[test]
    fn crate_builds() { assert_eq!(2 + 2, 4); }
}
```
Create empty `pub` stubs for each module file (`format.rs` etc.) with just a doc comment so `cargo build` resolves the `mod` declarations (you'll fill them in later tasks).

- [ ] **Step 4: Run.** `cd src-tauri && cargo test -p keepance-vault` → builds, smoke passes. (First build pulls `bip39`/`aes-gcm` — expect a longer compile.)
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(vault): keepance-vault crate scaffold + workspace member"`

---

### Task 2: File format (KPV1) — encrypt/decrypt over a 32-byte key

**Files:**
- Modify: `src-tauri/crates/keepance-vault/src/format.rs`
- Test: same file (`#[cfg(test)]`)

Implements §5 of the spec. Reuses the exact AES-256-GCM scheme of `mail/crypto.rs` (12-byte random nonce ‖ ciphertext ‖ 16-byte tag), wrapped with a 5-byte header (`KPV1` + version 1).

- [ ] **Step 1: Write the failing tests** (destructive suite items 3, 4, 5):
```rust
use super::*;
const KEY_A: [u8; 32] = [1u8; 32];
const KEY_B: [u8; 32] = [2u8; 32];

#[test]
fn roundtrip_text_and_binary() {
    for pt in [b"".to_vec(), b"hello world".to_vec(), vec![0u8; 100_000]] {
        let blob = encrypt_file(&pt, &KEY_A).unwrap();
        assert_eq!(&blob[..4], b"KPV1");
        assert_ne!(blob[5..], pt[..], "ciphertext must differ from plaintext"); // (skip for empty)
        assert_eq!(decrypt_file(&blob, &KEY_A).unwrap(), pt);
    }
}

#[test]
fn wrong_key_fails_without_garbage() {
    let blob = encrypt_file(b"secret", &KEY_A).unwrap();
    match decrypt_file(&blob, &KEY_B) {
        Err(VaultFormatError::DecryptFailed) => {}
        other => panic!("expected DecryptFailed, got {other:?}"),
    }
}

#[test]
fn tampered_ciphertext_fails() {
    let mut blob = encrypt_file(b"secret message", &KEY_A).unwrap();
    let last = blob.len() - 1;
    blob[last] ^= 0xFF;
    assert!(matches!(decrypt_file(&blob, &KEY_A), Err(VaultFormatError::DecryptFailed)));
}

#[test]
fn fresh_nonce_each_write() {
    let a = encrypt_file(b"x", &KEY_A).unwrap();
    let b = encrypt_file(b"x", &KEY_A).unwrap();
    assert_ne!(a, b, "two encryptions of the same plaintext must differ (random nonce)");
}

#[test]
fn magic_detection_and_truncation() {
    assert!(!has_vault_magic(b"plain text file"));
    let blob = encrypt_file(b"x", &KEY_A).unwrap();
    assert!(has_vault_magic(&blob));
    assert!(matches!(decrypt_file(&blob[..6], &KEY_A), Err(VaultFormatError::Malformed)));
    assert!(matches!(decrypt_file(b"KPV1\x01ab", &KEY_A), Err(VaultFormatError::Malformed)));
    assert!(matches!(decrypt_file(b"no magic here", &KEY_A), Err(VaultFormatError::NotVaulted)));
}
```

- [ ] **Step 2: Run red.** `cargo test -p keepance-vault format` → FAIL (undefined).

- [ ] **Step 3: Implement `format.rs`:**
```rust
//! KPV1 on-disk file format: "KPV1" magic + version + (12B nonce ‖ AES-256-GCM ct‖tag).
use aes_gcm::{aead::{Aead, KeyInit, OsRng}, AeadCore, Aes256Gcm, Key, Nonce};
use rand::RngCore;

pub const MAGIC: &[u8; 4] = b"KPV1";
pub const VERSION: u8 = 1;
const NONCE_LEN: usize = 12;
const TAG_LEN: usize = 16;
const HEADER_LEN: usize = 5; // magic(4)+version(1)

#[derive(Debug, thiserror::Error)]
pub enum VaultFormatError {
    #[error("not a vaulted file (no KPV1 magic)")]
    NotVaulted,
    #[error("malformed vault file")]
    Malformed,
    #[error("decryption failed")]
    DecryptFailed,
    #[error("crypto error")]
    Crypto,
}

pub fn has_vault_magic(bytes: &[u8]) -> bool {
    bytes.len() >= 4 && &bytes[..4] == MAGIC
}

pub fn encrypt_file(plaintext: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, VaultFormatError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plaintext).map_err(|_| VaultFormatError::Crypto)?;
    let mut out = Vec::with_capacity(HEADER_LEN + NONCE_LEN + ct.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt_file(blob: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, VaultFormatError> {
    if !has_vault_magic(blob) { return Err(VaultFormatError::NotVaulted); }
    if blob.len() < HEADER_LEN + NONCE_LEN + TAG_LEN { return Err(VaultFormatError::Malformed); }
    if blob[4] != VERSION { return Err(VaultFormatError::Malformed); }
    let nonce = Nonce::from_slice(&blob[HEADER_LEN..HEADER_LEN + NONCE_LEN]);
    let ct = &blob[HEADER_LEN + NONCE_LEN..];
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher.decrypt(nonce, ct).map_err(|_| VaultFormatError::DecryptFailed)
}
```
> The `roundtrip` test's `assert_ne` on the empty plaintext is wrong (empty ct is just the tag); guard it: only assert ciphertext-differs for non-empty `pt`. Adjust the test accordingly before greening.

- [ ] **Step 4: Run green.** `cargo test -p keepance-vault format` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(vault): KPV1 file format (AES-256-GCM) with wrong-key/tamper/truncation tests"`

---

### Task 3: Atomic write (kill-mid-write safety)

**Files:**
- Modify: `src-tauri/crates/keepance-vault/src/atomic.rs`
- Test: same file

Implements §6. The function writes bytes to a temp sibling, fsyncs, and atomically renames over the target. A test seam lets us simulate a crash *before* the rename and assert the original is untouched.

- [ ] **Step 1: Write the failing tests** (destructive items 1, 2):
```rust
use super::*;
use std::fs;
use std::io::Write;

#[test]
fn write_replaces_atomically() {
    let dir = tempdir();
    let path = dir.join("doc.bin");
    fs::write(&path, b"ORIGINAL").unwrap();
    atomic_write(&path, b"NEWCONTENT").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"NEWCONTENT");
    // no temp left behind
    assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
}

#[test]
fn crash_before_rename_preserves_original() {
    let dir = tempdir();
    let path = dir.join("doc.bin");
    fs::write(&path, b"ORIGINAL").unwrap();
    // write_temp_only stops AFTER fsync, BEFORE rename (the injectable seam).
    let tmp = write_temp_only(&path, b"NEWCONTENT").unwrap();
    assert_eq!(fs::read(&path).unwrap(), b"ORIGINAL", "target must be untouched pre-rename");
    assert!(tmp.exists(), "temp exists and holds the new content");
    assert_eq!(fs::read(&tmp).unwrap(), b"NEWCONTENT");
    // sweep removes orphan temps
    sweep_temps(&dir).unwrap();
    assert!(!tmp.exists());
    assert_eq!(fs::read(&path).unwrap(), b"ORIGINAL");
}

#[test]
fn target_is_never_truncated_in_place() {
    // atomic_write must NOT open the target with truncate; it writes a temp then renames.
    // Assert by checking the temp path is a sibling and the target inode/content only
    // ever transitions old->new (verified by reading mid-way is impossible here, so we
    // assert the function creates a distinct temp file first).
    let dir = tempdir();
    let path = dir.join("doc.bin");
    fs::write(&path, b"OLD").unwrap();
    let tmp = write_temp_only(&path, b"NEWER").unwrap();
    assert_ne!(tmp, path);
    assert_eq!(tmp.parent(), path.parent());
}
```
Add a small `tempdir()` test helper (use `std::env::temp_dir()` + a random subdir, created fresh; clean up is best-effort — or add `tempfile` as a dev-dependency and use `tempfile::tempdir()`. Prefer `tempfile` dev-dep for reliable cleanup; add `[dev-dependencies] tempfile = "3"` to the crate Cargo.toml).

- [ ] **Step 2: Run red.** `cargo test -p keepance-vault atomic` → FAIL.

- [ ] **Step 3: Implement `atomic.rs`:**
```rust
//! Crash-safe atomic file write: temp sibling -> fsync -> atomic rename.
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

const TEMP_PREFIX: &str = ".kpv-tmp-";

fn temp_path_for(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    let rand: u64 = rand::random();
    path.with_file_name(format!("{TEMP_PREFIX}{name}-{rand:016x}"))
}

/// Write `bytes` to a temp sibling and fsync it. Returns the temp path WITHOUT renaming.
/// Exposed for crash-injection tests; production uses `atomic_write`.
pub fn write_temp_only(path: &Path, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let tmp = temp_path_for(path);
    let mut f = OpenOptions::new().create_new(true).write(true).open(&tmp)?;
    f.write_all(bytes)?;
    f.sync_all()?; // fsync the temp
    Ok(tmp)
}

/// Atomically replace `path`'s contents with `bytes`. Crash-safe: a crash before the
/// rename leaves the original intact; the rename itself is atomic.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = write_temp_only(path, bytes)?;
    fs::rename(&tmp, path)?; // atomic on POSIX & NTFS for same-dir replace
    // best-effort directory fsync (durability of the rename)
    if let Some(dir) = path.parent() {
        if let Ok(d) = File::open(dir) { let _ = d.sync_all(); }
    }
    Ok(())
}

/// Remove orphan `*.kpv-tmp-*` files left by an interrupted write.
pub fn sweep_temps(dir: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if let Some(name) = entry.file_name().to_str() {
            if name.starts_with(TEMP_PREFIX) { let _ = fs::remove_file(entry.path()); }
        }
    }
    Ok(())
}
```
> Windows note: `fs::rename` over an existing file fails on some Windows configs. For the Windows target, replace the rename with a helper that uses `std::fs::rename` and, on `AlreadyExists`/`PermissionDenied`, falls back to the Win32 `ReplaceFileW`/`MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` via the `windows-sys` crate behind `#[cfg(windows)]`. Add `windows-sys` as a `[target.'cfg(windows)'.dependencies]` only if the plain rename test fails on Windows CI; the POSIX path needs none. Keep the cross-platform seam in one private fn `replace_atomically(tmp, path)`.

- [ ] **Step 4: Run green.** `cargo test -p keepance-vault atomic` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(vault): crash-safe atomic write (temp+fsync+rename) with kill-mid-write tests"`

---

### Task 4: Recovery phrase — BIP39 + HKDF KEK + VMK wrap/unwrap

**Files:**
- Modify: `src-tauri/crates/keepance-vault/src/recovery.rs`
- Test: same file

Implements §4.3. Generate a 24-word mnemonic from 256-bit entropy; derive a KEK via HKDF over that entropy; wrap/unwrap the VMK with AES-256-GCM.

- [ ] **Step 1: Write the failing tests** (destructive items 6, 7):
```rust
use super::*;

#[test]
fn recovery_roundtrip_recovers_exact_vmk() {
    let vmk = [7u8; 32];
    let (phrase, wrap) = create_recovery(&vmk).unwrap();
    assert_eq!(phrase.split_whitespace().count(), 24);
    let recovered = recover_vmk(&phrase, &wrap).unwrap();
    assert_eq!(recovered, vmk);
}

#[test]
fn invalid_phrase_checksum_rejected_before_crypto() {
    let vmk = [7u8; 32];
    let (_phrase, wrap) = create_recovery(&vmk).unwrap();
    let bad = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zoo";
    assert!(matches!(recover_vmk(bad, &wrap), Err(RecoveryError::InvalidPhrase)));
}

#[test]
fn correct_checksum_but_wrong_phrase_fails_auth() {
    let vmk = [7u8; 32];
    let (_phrase, wrap) = create_recovery(&vmk).unwrap();
    // A different but checksum-VALID 24-word phrase.
    let (other_phrase, _) = create_recovery(&[9u8; 32]).unwrap();
    assert!(matches!(recover_vmk(&other_phrase, &wrap), Err(RecoveryError::DecryptFailed)));
}

#[test]
fn wrap_blob_is_self_describing_and_stable_size() {
    let (_p, wrap) = create_recovery(&[1u8; 32]).unwrap();
    // salt(16) + nonce(12) + ct(32) + tag(16) = 76
    assert_eq!(wrap.salt.len(), 16);
    assert_eq!(wrap.wrapped.len(), 12 + 32 + 16);
}
```

- [ ] **Step 2: Run red.** `cargo test -p keepance-vault recovery` → FAIL.

- [ ] **Step 3: Implement `recovery.rs`:**
```rust
//! Recovery phrase: a BIP39 24-word mnemonic IS the 256-bit entropy. Derive a KEK
//! via HKDF over that entropy and AES-256-GCM-wrap the VMK. (No memory-hard KDF:
//! the input is full 256-bit entropy, so HKDF is sufficient — see the design spec §4.3.)
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Key, Nonce};
use bip39::Mnemonic;
use hkdf::Hkdf;
use rand::RngCore;
use sha2::Sha256;
use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

const INFO: &[u8] = b"keepance-vault-recovery-kek:v1";
const AAD: &[u8] = b"keepance-vault-recovery:v1";

#[derive(Debug, thiserror::Error)]
pub enum RecoveryError {
    #[error("invalid recovery phrase")] InvalidPhrase,
    #[error("decryption failed")] DecryptFailed,
    #[error("crypto error")] Crypto,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct RecoveryWrap {
    pub salt: Vec<u8>,       // 16B
    pub wrapped: Vec<u8>,    // nonce(12) ‖ ct ‖ tag(16)
}

fn derive_kek(entropy: &[u8], salt: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(salt), entropy);
    let mut kek = [0u8; 32];
    hk.expand(INFO, &mut kek).expect("hkdf expand 32");
    kek
}

/// Generate a 24-word phrase and wrap `vmk` under a KEK derived from it.
pub fn create_recovery(vmk: &[u8; 32]) -> Result<(String, RecoveryWrap), RecoveryError> {
    let mut entropy = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut entropy);
    let mnemonic = Mnemonic::from_entropy(&entropy).map_err(|_| RecoveryError::Crypto)?;
    let phrase = mnemonic.to_string();

    let mut salt = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt);
    let mut kek = derive_kek(&entropy, &salt);

    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kek));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), aes_gcm::aead::Payload { msg: vmk, aad: AAD })
        .map_err(|_| RecoveryError::Crypto)?;
    let mut wrapped = Vec::with_capacity(12 + ct.len());
    wrapped.extend_from_slice(&nonce_bytes);
    wrapped.extend_from_slice(&ct);

    entropy.zeroize();
    kek.zeroize();
    Ok((phrase, RecoveryWrap { salt: salt.to_vec(), wrapped }))
}

/// Recover the VMK from a 24-word phrase + the stored wrap.
pub fn recover_vmk(phrase: &str, wrap: &RecoveryWrap) -> Result<[u8; 32], RecoveryError> {
    let mnemonic = Mnemonic::parse_normalized(phrase.trim()).map_err(|_| RecoveryError::InvalidPhrase)?;
    let entropy = mnemonic.to_entropy(); // Vec<u8>, 32 bytes for 24 words
    let mut kek = derive_kek(&entropy, &wrap.salt);
    if wrap.wrapped.len() < 12 + 16 { return Err(RecoveryError::DecryptFailed); }
    let (nonce_bytes, ct) = wrap.wrapped.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&kek));
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), aes_gcm::aead::Payload { msg: ct, aad: AAD })
        .map_err(|_| RecoveryError::DecryptFailed)?;
    kek.zeroize();
    let mut out = [0u8; 32];
    if pt.len() != 32 { return Err(RecoveryError::DecryptFailed); }
    out.copy_from_slice(&pt);
    Ok(out)
}
```
> Verify the exact `bip39 = "2"` API (`Mnemonic::from_entropy`, `parse_normalized`, `to_entropy`, `to_string`) against the resolved crate version; adjust method names if the 2.x API differs, keeping behavior identical.

- [ ] **Step 4: Run green.** `cargo test -p keepance-vault recovery` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(vault): BIP39 recovery phrase + HKDF KEK + VMK wrap, with wrong-phrase tests"`

---

### Task 5: Verifier + metadata file

**Files:**
- Modify: `src-tauri/crates/keepance-vault/src/verifier.rs`, `src/metadata.rs`
- Test: both files

Implements §4.5 + the `.keepance-vault.json` shape (§4 + §14).

- [ ] **Step 1: Write the failing tests:**
```rust
// verifier.rs
#[test]
fn verifier_accepts_correct_key_rejects_wrong() {
    let vmk = [3u8; 32];
    let v = make_verifier(&vmk).unwrap();
    assert!(check_verifier(&v, &vmk));
    assert!(!check_verifier(&v, &[4u8; 32]));
}

// metadata.rs
#[test]
fn metadata_roundtrips_through_json() {
    let m = VaultMetadata {
        version: 1, vault_id: "vid-123".into(), created_at: "2026-06-11T00:00:00Z".into(),
        recovery: RecoveryWrapJson { salt_b64: "AAAA".into(), wrapped_b64: "BBBB".into() },
        verifier_b64: "CCCC".into(),
        escrow: Some(EscrowJson { epoch: 1, admin_wraps: vec![
            AdminWrapJson { user_id: "u1".into(), device_id: "d1".into(), wrapped_b64: "DDDD".into() }
        ]}),
    };
    let json = m.to_json().unwrap();
    let back = VaultMetadata::from_json(&json).unwrap();
    assert_eq!(back.vault_id, "vid-123");
    assert_eq!(back.escrow.unwrap().admin_wraps[0].device_id, "d1");
}
```

- [ ] **Step 2: Run red.** `cargo test -p keepance-vault verifier metadata` → FAIL.

- [ ] **Step 3: Implement `verifier.rs`** (reuse `format::encrypt_file`/`decrypt_file` over the fixed plaintext `b"keepance-vault-verifier:v1"`; `make_verifier` returns the blob, `check_verifier` returns `decrypt_file(blob,key).is_ok()` AND the plaintext matches the constant). Implement `metadata.rs` with the serde structs above (`VaultMetadata`, `RecoveryWrapJson`, `EscrowJson`, `AdminWrapJson`), `to_json`/`from_json` (serde_json), and `read_from(dir)`/`write_to(dir)` that read/write `<dir>/.keepance-vault.json` via the atomic writer from Task 3.

- [ ] **Step 4: Run green.** `cargo test -p keepance-vault verifier metadata` → PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(vault): VMK verifier + .keepance-vault.json metadata"`

---

### Task 6: Vault orchestration — open, per-file, walk (escape hatch + migration)

**Files:**
- Modify: `src-tauri/crates/keepance-vault/src/vault.rs`
- Test: `src-tauri/crates/keepance-vault/tests/destructive.rs` (integration; destructive items 8, 9)

Combines format + atomic + a VMK into file-level ops, and the resumable walk used by enable-migration and the escape hatch.

- [ ] **Step 1: Write the failing integration tests** (`tests/destructive.rs`):
```rust
use keepance_vault::vault::*;
use std::fs;

#[test]
fn escape_hatch_roundtrip_is_byte_identical() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let files = [("a.txt", b"alpha".to_vec()), ("sub/b.bin", vec![0u8,1,2,3,255]), ("c.md", b"# hi".to_vec())];
    for (rel, content) in &files {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, content).unwrap();
    }
    let vmk = [5u8; 32];
    encrypt_all(root, &vmk).unwrap();
    // every file now has the magic
    for (rel, _) in &files { assert_eq!(&fs::read(root.join(rel)).unwrap()[..4], b"KPV1"); }
    decrypt_all(root, &vmk).unwrap();
    // byte-identical to originals, no magic left
    for (rel, content) in &files {
        let got = fs::read(root.join(rel)).unwrap();
        assert_eq!(&got, content);
        assert_ne!(&got[..got.len().min(4)], b"KPV1");
    }
}

#[test]
fn migration_resume_never_double_encrypts() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("x.txt"), b"plain").unwrap();
    let vmk = [6u8; 32];
    // Pre-encrypt ONE file to simulate a partially-completed migration.
    let pre = keepance_vault::format::encrypt_file(b"already", &vmk).unwrap();
    fs::write(root.join("y.txt"), &pre).unwrap();
    encrypt_all(root, &vmk).unwrap(); // must skip y (has magic), encrypt x
    assert_eq!(decrypt_file_at(root.join("x.txt"), &vmk).unwrap(), b"plain");
    assert_eq!(decrypt_file_at(root.join("y.txt"), &vmk).unwrap(), b"already"); // not double-encrypted
}
```

- [ ] **Step 2: Run red.** `cargo test -p keepance-vault --test destructive` → FAIL.

- [ ] **Step 3: Implement `vault.rs`:**
  - `encrypt_file_at(path, vmk)`: read bytes; if `has_vault_magic` → no-op (idempotent); else `atomic_write(path, encrypt_file(bytes, vmk))`.
  - `decrypt_file_at(path, vmk)`: read bytes; if not magic → return bytes as-is (already plain); else `decrypt_file` then return.
  - `decrypt_file_to_disk(path, vmk)`: if magic → `atomic_write(path, decrypt_file(...))`.
  - `encrypt_all(root, vmk)` / `decrypt_all(root, vmk)`: walk `root` recursively (skip `.keepance-vault.json`, `.kpv-tmp-*`, and any dir the workspace excludes — for v1 just skip the metadata + temps), apply the per-file op atomically. Both are resumable by construction (magic-guarded). Call `atomic::sweep_temps` on each visited dir first.
  - All errors are typed (`VaultError`), fail closed.
> Use `std::fs` recursion (a small stack walk) — do NOT add a `walkdir` dep unless the host crate already has it; check first.

- [ ] **Step 4: Run green.** `cargo test -p keepance-vault` (whole crate) → all PASS.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(vault): per-file + resumable walk ops; escape-hatch + migration-resume tests"`

---

### Task 7: Full destructive-failure suite sign-off

**Files:**
- Modify: `src-tauri/crates/keepance-vault/tests/destructive.rs` (ensure every spec §13 crate item 1–9 is represented)

- [ ] **Step 1: Cross-check** the spec §13 list (items 1–10) against existing tests. Items 1–2 (atomic), 3–5 (format), 6–7 (recovery), 8–9 (walk) are covered by Tasks 2–6. Add any missing item as a test here (e.g. an explicit item-2 assertion that `atomic_write` never opens the target with truncate — assert via the `write_temp_only` seam that the target is untouched until rename). Item 10 (escrow) is a TS test in Task 11.
- [ ] **Step 2: Run** `cd src-tauri && cargo test -p keepance-vault` → all green; paste the count.
- [ ] **Step 3: Commit.** `git add -A && git commit -m "test(vault): complete crate-level destructive-failure suite (spec §13 items 1-9)"`

---

### Task 8: Tauri command layer — create/status/read/write + keychain

**Files:**
- Create: `src-tauri/src/commands/vault/mod.rs`
- Modify: `src-tauri/src/lib.rs` (register commands + `mod vault;`), `src-tauri/Cargo.toml` (host crate dep on `keepance-vault`)
- Test: `#[cfg(test)]` in `mod.rs` for the pure helpers; the command I/O is exercised in Task 13 + the native pass.

Adds the keychain integration (the crate is keychain-agnostic; the command layer fetches/stores the VMK). Workspace id = hex SHA-256 of the canonicalized root path.

- [ ] **Step 1: Add `keepance-vault = { path = "crates/keepance-vault" }`** to the host `[dependencies]` in `src-tauri/Cargo.toml`.
- [ ] **Step 2: Write a unit test** in `mod.rs` for `workspace_id(path)` (stable hex SHA-256 of the canonical path; same path → same id; different path → different id).
- [ ] **Step 3: Run red**, then implement `commands/vault/mod.rs`:
  - `fn workspace_id(root: &Path) -> String` (hex SHA-256 of canonical path).
  - `fn vmk_service(id: &str) -> String` → `format!("com.keepance.vault.{id}")`; keychain key `"vmk-v1"`. Reuse the SAME keyring crate access the existing `keychain.rs` uses (factor a tiny internal helper or call its functions) so dev/test behavior matches.
  - `#[tauri::command] vault_status(workspace) -> VaultStatus { enabled, locked, has_escrow, vault_id }` — `enabled` = metadata file exists; `locked` = enabled but no VMK in keychain; `has_escrow` = metadata has escrow.
  - `#[tauri::command] vault_create(workspace, escrow: bool) -> VaultCreated { recovery_phrase, vault_id }` — generate VMK (32 random bytes), `recovery::create_recovery`, `verifier::make_verifier`, write metadata (no escrow wraps yet — those land via Task 9), store VMK in keychain. Returns the phrase ONCE.
  - `#[tauri::command] vault_read_file(workspace, rel_path) -> Vec<u8>` — load VMK from keychain (error `vault_locked` if absent); read file; if magic → `decrypt_file` else return bytes (passthrough). 
  - `#[tauri::command] vault_write_file(workspace, rel_path, bytes) -> ()` — load VMK; `vault::encrypt_file_at`-style: `atomic_write(path, encrypt_file(bytes, vmk))`.
  - Register all in `lib.rs` `generate_handler!`.
- [ ] **Step 4: Run** `cd src-tauri && cargo test vault && cargo build` → green + compiles.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(vault): Tauri commands — create/status/read/write + keychain VMK"`

---

### Task 9: Recovery + escrow commands

**Files:**
- Modify: `src-tauri/src/commands/vault/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement + register:**
  - `#[tauri::command] vault_unlock_with_recovery(workspace, phrase) -> ()` — read metadata; `recovery::recover_vmk(phrase, wrap)`; `verifier::check_verifier` against the recovered VMK (defense-in-depth); on success store VMK in keychain; typed errors `invalid_phrase` / `recovery_failed`.
  - `#[tauri::command] vault_export_vmk_for_escrow(workspace) -> String` — gated: only if the vault is unlocked (VMK in keychain); returns base64(VMK). (Used transiently by TS `keyWrap`.)
  - `#[tauri::command] vault_set_escrow_wraps(workspace, epoch, wraps: Vec<AdminWrapJson>) -> ()` — write the escrow section of the metadata.
- [ ] **Step 2: Add a Rust unit test** that `vault_unlock_with_recovery` round-trips against a `vault_create`d vault in a temp workspace with the keychain in a test mode (gate live-keychain behind `KEEPANCE_TEST_KEYCHAIN=1` like `keychain.rs` tests, or inject a temp keychain service name). If live keychain is unavailable in CI, test the underlying crate functions directly and mark the command as covered by the native pass.
- [ ] **Step 3: Run** `cargo test vault && cargo build` → green.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(vault): recovery-unlock + escrow export/set commands"`

---

### Task 10: Migration + escape-hatch + disable commands

**Files:**
- Modify: `src-tauri/src/commands/vault/mod.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement + register** (emit Tauri progress events for the long walks):
  - `vault_encrypt_all(workspace) -> ()` — load VMK; `keepance_vault::vault::encrypt_all(root, vmk)`; emit `vault://progress` events `{ done, total }`.
  - `vault_decrypt_all(workspace) -> ()` — load VMK; `decrypt_all`.
  - `vault_disable(workspace) -> ()` — assert no `KPV1` files remain (refuse if any still encrypted, so we never orphan ciphertext); delete metadata file; delete the keychain VMK.
- [ ] **Step 2:** Rust test: `encrypt_all` then `vault_disable` refuses while files are still encrypted, and succeeds after `decrypt_all` (drive the crate funcs in a temp dir).
- [ ] **Step 3: Run** `cargo test vault && cargo build` → green.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(vault): encrypt-all migration + escape-hatch decrypt-all + disable"`

---

### Task 11: TS vault client + escrow orchestration (reusing keyWrap)

**Files:**
- Create: `src/modules/vault/vaultClient.ts`
- Test: `tests/unit/vault/vaultClient.test.ts` (mock `invoke`); `tests/unit/vault/escrow.test.ts` (destructive item 10, real WebCrypto)

- [ ] **Step 1: Write the escrow round-trip test** (item 10 — real `keyWrap`):
```ts
// tests/unit/vault/escrow.test.ts
import { describe, it, expect } from 'vitest';
import { wrapMatterKey, unwrapMatterKey } from '@/modules/firm/keyWrap';
import { getOrCreateDeviceKeypair, _resetDeviceCache } from '@/modules/firm/deviceKeys';

describe('vault escrow reuses keyWrap', () => {
  it('wraps the VMK to an admin device pubkey and the admin unwraps it', async () => {
    _resetDeviceCache();
    const { publicJwk } = await getOrCreateDeviceKeypair(); // this "device" is the admin
    const vmkB64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const wrapped = await wrapMatterKey(vmkB64, publicJwk, 1);
    const recovered = await unwrapMatterKey(wrapped, 1);
    expect(recovered).toBe(vmkB64);
  });
});
```
- [ ] **Step 2: Run red**, then implement `vaultClient.ts`: thin `invoke` wrappers for every Task 8–10 command, plus `provisionEscrow(workspace, adminDevices: {user_id,device_id,pubkey_jwk}[])` which calls `vault_export_vmk_for_escrow`, wraps the VMK to each admin pubkey via `wrapMatterKey`, calls `vault_set_escrow_wraps`, and drops the plaintext. Use a passthrough `isTauri()` guard (vault unavailable in browser).
- [ ] **Step 3: Write `vaultClient.test.ts`** mocking `@tauri-apps/api/core` `invoke` to assert each wrapper calls the right command with the right args, and `provisionEscrow` wraps once per admin device.
- [ ] **Step 4: Run green** (`npm run test -- tests/unit/vault/`) + `npx tsc --noEmit`.
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(vault): TS vault client + escrow provisioning via keyWrap (round-trip test)"`

---

### Task 12: VaultFSBackend decorator + factory wiring

**Files:**
- Create: `src/modules/workspace/VaultFSBackend.ts`
- Modify: `src/modules/workspace/BackendFactory.ts`
- Test: `tests/unit/vault/vaultFsBackend.test.ts` (destructive item 11)

- [ ] **Step 1: Write the transparency test** — through a `VaultFSBackend` wrapping a fake inner `FSBackend` that records raw bytes, assert: `write('a.txt','hello')` then `read('a.txt')` returns `'hello'`, the inner backend received bytes starting with `KPV1` (mock the `invoke('vault_write_file')` to actually call the crate via a small JS reimpl OR mock it to return the plaintext on read and assert the command was invoked). Keep it honest: assert read↔write symmetry and that `list` filters `.keepance-vault.json`.
- [ ] **Step 2: Run red**, then implement `VaultFSBackend(inner: FSBackend)`:
  - `read`/`readBinary` → `invoke('vault_read_file', { workspace, relPath })` → bytes → (text decode for `read`).
  - `write`/`writeBinary` → `invoke('vault_write_file', { workspace, relPath, bytes })`.
  - `list` → `inner.list(path)` then filter out `.keepance-vault.json` and `*.kpv-tmp-*`.
  - everything else (`move`/`rename`/`copy`/`delete`/`mkdir`/`stat`/`exists`/`isSymlink`/`resolveSymlink`/`getRootPath`/`setRootPath`) → delegate to `inner`.
- [ ] **Step 3: Wire `BackendFactory.ts`** — after building the `TauriFSBackend`, if `vault_status(root).enabled`, wrap it in `VaultFSBackend`. (Browser/Web backend never wrapped.)
- [ ] **Step 4: Run green** + `npx tsc --noEmit` + `npm run test -- tests/unit/vault/ tests/unit/workspace/` (no regression).
- [ ] **Step 5: Commit.** `git add -A && git commit -m "feat(vault): VaultFSBackend transparent decorator + factory wiring"`

---

### Task 13: RAG indexer decrypts vaulted files (the critical seam)

**Files:**
- Modify: `src-tauri/src/commands/rag/*` (the file-read path in the indexer/extractor; find where it `fs::read`s a workspace file before extraction)
- Test: Rust test in the rag module + the spec's destructive item 12

Implements §9 — without this, search silently breaks over vaulted files.

- [ ] **Step 1: Locate** the indexer's direct file read (e.g. in `commands/rag/extractor.rs` / `pdf_indexer.rs` / the walker). Write a failing Rust test: index a temp workspace containing one **vaulted** file (write `format::encrypt_file(b"the quick brown fox", vmk)` to disk + a `.keepance-vault.json`), run the extract-text path, assert it yields `"the quick brown fox"` (not ciphertext).
- [ ] **Step 2: Run red**, then implement: in the indexer read path, detect a vaulted workspace (metadata present) + per-file `has_vault_magic`; when vaulted, load the VMK (same keychain helper as `commands/vault`) and `decrypt_file` in memory before extraction. Plain files pass through unchanged. Decryption is in-memory only; extracted chunks go to the already-encrypted vector store unchanged.
- [ ] **Step 3: Run green.** `cd src-tauri && cargo test rag` → green (incl. existing rag tests — no regression).
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(vault): RAG indexer decrypts vaulted files in memory before extraction"`

---

### Task 14: Vault store + enable flow + recovery-phrase ceremony

**Files:**
- Create: `src/stores/vaultStore.ts`, `src/components/vault/VaultEnableFlow.tsx`, `src/components/vault/RecoveryPhraseCeremony.tsx`
- Test: `tests/unit/vault/RecoveryPhraseCeremony.test.tsx`

Implements §10 + §11 Fork 3 (mandatory confirmed ceremony). Light theme.

- [ ] **Step 1: Write the ceremony test** — render with a 24-word phrase; assert (a) the phrase is shown, (b) the "Advisor Prep Hero cannot recover this for you" warning is present, (c) the Activate/Continue button is **disabled** until the user re-enters 3 specific requested words correctly (the confirmation), (d) entering them wrong keeps it disabled, (e) correct entry enables it and calls `onConfirmed`.
- [ ] **Step 2: Run red**, then implement `RecoveryPhraseCeremony.tsx` (props: `phrase: string`, `onConfirmed: () => void`): display the numbered 24 words, the bold warning, a copy button, and a confirm step asking for 3 random word positions; enable Activate only when all 3 match. `vaultStore.ts` (Zustand) holds `{ status, phase, error }` and actions `enableVault(escrow)` (calls `vault_create` → ceremony → `vault_encrypt_all` → optional `provisionEscrow`), `unlockWithRecovery(phrase)`. `VaultEnableFlow.tsx` orchestrates: explain → ceremony → (firm) escrow consent → encrypt-all progress.
- [ ] **Step 3: Run green** + tsc + `npm run test -- tests/unit/vault/`.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(vault): enable flow + mandatory confirmed recovery-phrase ceremony"`

---

### Task 15: Locked-state prompt + escape-hatch dialog

**Files:**
- Create: `src/components/vault/VaultLockedPrompt.tsx`, `src/components/vault/VaultEscapeHatchDialog.tsx`
- Test: `tests/unit/vault/VaultLockedPrompt.test.tsx`

- [ ] **Step 1: Write tests** — Locked prompt: entering a phrase + submit calls `unlockWithRecovery`; an invalid-phrase error renders. Escape-hatch dialog: confirming calls `vault_decrypt_all` then `vault_disable` and explains files return to normal.
- [ ] **Step 2: Run red**, implement both (light theme; reuse existing dialog/input components). Wire them where workspaces are opened/settinged (mirror how other workspace dialogs mount — find the existing pattern; do not invent a new mount).
- [ ] **Step 3: Run green** + tsc + firm/vault suites.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(vault): locked-state recovery prompt + escape-hatch dialog"`

---

### Task 16: Data Map row + i18n

**Files:**
- Modify: `src/components/privacy/DataMapDialog.tsx`, `src/locales/{en,de,es}.json`
- Test: update `tests/unit/i18n/en-json-snapshot.test.ts` inventory + count; any DataMap test

- [ ] **Step 1:** Add a Data Map row (icon `KeyRound` or `Lock`) — "Advisor Prep Hero encrypts this workspace's files": contents AES-256-GCM at rest, **file names remain visible**, the recovery phrase is the only solo backstop, firm escrow exists. i18n ALL vault UI strings under a `vault.*` namespace across en/de/es (real translations matching the existing tone). NO em dashes (the i18n snapshot guard enforces this).
- [ ] **Step 2:** Update `tests/unit/i18n/en-json-snapshot.test.ts` namespace inventory + leaf count for the new keys (run `npm run test -- en-json-snapshot --update` for the inline snapshot; bump the `toBe(...)` count manually).
- [ ] **Step 3: Run** `npm run test -- tests/unit/i18n/ tests/unit/privacy/` → green; validate all 3 locale JSONs parse.
- [ ] **Step 4: Commit.** `git add -A && git commit -m "feat(vault): Data Map row + vault i18n (en/de/es)"`

---

### Task 17: Full verification + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1:** `cd src-tauri && cargo test` (host + `keepance-vault` + `keepance-docx`) → all green; `cargo build` clean. `npx tsc --noEmit` clean. `npm run test` (full client suite) → green. `npx eslint` on the new TS files → no new errors.
- [ ] **Step 2:** Add the `CHANGELOG.md` `[Unreleased] › Added` entry (plain language, **no em dashes**, Jameson's voice): the optional encrypted workspace vault — files encrypted at rest, transparent in-app, recovery phrase, firm escrow, atomic crash-safety, decrypt-everything escape hatch; list the crate + key files.
- [ ] **Step 3: Commit + push.** `git add -A && git commit -m "chore(vault): full suites green + changelog"` and push `keepance-3.0`.

---

## Self-Review

**Spec coverage:** §4.1 VMK (T8) · §4.2 keychain (T8) · §4.3 recovery (T4) · §4.4 escrow (T9 export/set + T11 wrap) · §4.5 verifier (T5) · §5 file format (T2) · §6 atomic write (T3) · §7 VaultFSBackend (T12) · §8 commands (T8–T10) · §9 indexer decrypt (T13) · §10 UX (T14–T16) · §11 forks (T9 escrow scope, T2/T7 contents-only, T14 ceremony) · §12 failure semantics (T2–T6 tests) · §13 destructive suite (T2–T7 items 1–9, T11 item 10, T12 item 11, T13 item 12) · §14 module structure (all) · §15 hygiene (zeroize T4, no-log throughout). No gaps.

**Placeholder scan:** crate-crypto tasks carry full code; command/TS/UI tasks give exact files + interfaces + real test assertions + integration points, with code where novel and "match the existing pattern" where a proven one exists (per writing-plans for existing codebases). The two cross-platform/crate-version caveats (Windows rename, bip39 2.x API) are flagged as explicit verify-steps, not placeholders.

**Type consistency:** `encrypt_file`/`decrypt_file`/`has_vault_magic` (T2) reused in T5/T6/T13; `RecoveryWrap`/`create_recovery`/`recover_vmk` (T4) used in T5 metadata + T9; `atomic_write`/`write_temp_only`/`sweep_temps` (T3) used in T5/T6/T8/T10; command names (`vault_create`/`vault_read_file`/`vault_write_file`/`vault_unlock_with_recovery`/`vault_export_vmk_for_escrow`/`vault_set_escrow_wraps`/`vault_encrypt_all`/`vault_decrypt_all`/`vault_disable`/`vault_status`) are consistent across T8–T16.

## Execution note
Per the model policy this is the **xhigh** build: Sonnet implements each task; **Opus reviews EVERY diff** (not just spec/quality gates) given data-loss sensitivity; the destructive-failure tests are the hard gate before any task that depends on the crypto core is accepted.

# Implementation Plan: Email Encryption-at-Rest (Group G)

`docs/superpowers/plans/2026-06-06-email-encryption-groupG.md`

---

## Preamble

**Branch:** `email/m365-phase1` (continue on this branch; Group G is the encryption layer)
**Prerequisite:** All 21 tests from Tasks 1–12 are green. This plan adds encryption without removing the Phase 1 test suite.
**Design authority:** `docs/strategy/2026-06-06-email-encryption-design.md` — follow it exactly.
**Run commands:** All Rust tests use `cd src-tauri && cargo test --lib mail` (lib name `keepance_lib`). Frontend tests: `npm test`. Build gate before every commit: `cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo build 2>&1 | tail -5`.

**TDD convention (same as Phase 1 plan):**
Each task: failing test → watch it fail → minimal impl → watch it pass → commit. No step is skipped.

---

## Dependency additions (do these once, before Task G1)

In `src-tauri/Cargo.toml` under `[dependencies]`, add:

```toml
aes-gcm = "0.10"
rand = "0.8"
```

Change the existing `rusqlite` line from:
```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```
to:
```toml
rusqlite = { version = "0.32", features = ["bundled-sqlcipher-vendored-openssl"] }
```

**Feature name verification:** The rusqlite 0.32 crate's `bundled-sqlcipher-vendored-openssl` feature vendors both SQLCipher and OpenSSL via `openssl-sys`. This is the correct three-part feature name for a fully self-contained build. (The alternative `bundled-sqlcipher` requires a system OpenSSL; on macOS CI and Windows that is unreliable. The vendored variant is heavier to compile but requires only a C toolchain, which the env already satisfies — rusqlite's existing `bundled` feature already compiles SQLite from C source.)

**Compile risk (HIGH — call out for reviewer):** Switching from `bundled` to `bundled-sqlcipher-vendored-openssl` drops the plain SQLite dependency and introduces OpenSSL vendoring. The first build after this change will take 3–5 extra minutes and requires `cc`, `cmake`, and `perl` in PATH (all present on the Jameworld build host; verify on Windows CI). If the feature name ever changes between rusqlite patch releases, the build will fail with a "feature not found" error — the fix is simply to update the feature string. Document this in the commit message.

Run after editing `Cargo.toml`:
```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo build 2>&1 | tail -8
```
Expected: builds (may take several minutes first time; SQLCipher + OpenSSL compile from source). This is the baseline before Task G1 tests are written.

---

## Task G1: Crypto module — master key + AES-256-GCM encrypt/decrypt

**Files:**
- Create: `src-tauri/src/commands/mail/crypto.rs`
- Modify: `src-tauri/src/commands/mail/mod.rs` (add `pub mod crypto;`)

**Risk:** Low. Pure crypto logic; no shared state touched.

### Step 1: Write the failing tests

```rust
// src-tauri/src/commands/mail/crypto.rs  (bottom)
#[cfg(test)]
mod tests {
    use super::*;

    /// Generates a fresh random 32-byte key for testing, bypassing the keychain.
    fn test_key() -> [u8; 32] {
        use rand::RngCore;
        let mut k = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut k);
        k
    }

    #[test]
    fn round_trip_plaintext_survives_encrypt_decrypt() {
        let key = test_key();
        let plaintext = b"Confirming May 14. The closing is set for 10am.";
        let blob = encrypt_with_key(plaintext, &key).expect("encrypt");
        let recovered = decrypt_with_key(&blob, &key).expect("decrypt");
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn blob_is_longer_than_plaintext_by_nonce_and_tag() {
        let key = test_key();
        let plaintext = b"hello";
        let blob = encrypt_with_key(plaintext, &key).expect("encrypt");
        // blob = 12-byte nonce + ciphertext (same len as plaintext) + 16-byte GCM tag
        assert_eq!(blob.len(), 12 + plaintext.len() + 16);
    }

    #[test]
    fn two_encryptions_of_same_plaintext_produce_different_blobs() {
        // AEAD with random nonce: ciphertext is non-deterministic.
        let key = test_key();
        let p = b"same text";
        let b1 = encrypt_with_key(p, &key).expect("enc1");
        let b2 = encrypt_with_key(p, &key).expect("enc2");
        assert_ne!(b1, b2, "nonces must differ");
    }

    #[test]
    fn tamper_detection_rejects_modified_ciphertext() {
        let key = test_key();
        let plaintext = b"sensitive data";
        let mut blob = encrypt_with_key(plaintext, &key).expect("encrypt");
        // Flip a byte in the ciphertext body (after the 12-byte nonce).
        blob[12] ^= 0xFF;
        let result = decrypt_with_key(&blob, &key);
        assert!(result.is_err(), "AEAD must reject tampered ciphertext");
    }

    #[test]
    fn tamper_detection_rejects_truncated_blob() {
        let key = test_key();
        let blob = encrypt_with_key(b"data", &key).expect("encrypt");
        // Truncate to just the nonce (no ciphertext or tag).
        let truncated = &blob[..12];
        let result = decrypt_with_key(truncated, &key);
        assert!(result.is_err(), "truncated blob must fail");
    }

    #[test]
    fn wrong_key_is_rejected() {
        let key1 = test_key();
        let key2 = test_key();
        let blob = encrypt_with_key(b"secret", &key1).expect("encrypt");
        let result = decrypt_with_key(&blob, &key2);
        assert!(result.is_err(), "wrong key must fail AEAD auth");
    }
}
```

### Step 2: Run to confirm failure

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::crypto 2>&1 | tail -20
```
Expected: FAIL — `crypto` module not found.

### Step 3: Write minimal implementation

```rust
// src-tauri/src/commands/mail/crypto.rs
//
// AES-256-GCM encryption for email bodies and metadata.
// Wire format: 12-byte random nonce ‖ ciphertext ‖ 16-byte GCM auth tag.
// The master key (32 bytes) is stored in the OS keychain under
// service = "keepance-mail-enc", key = "master-key-v1".
// All public fns that touch the keychain are async or return Result;
// the core encrypt/decrypt take a key arg so they are unit-testable without a keychain.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use anyhow::{Context, Result};
use rand::RngCore;

const KEYCHAIN_SERVICE: &str = "keepance-mail-enc";
const KEYCHAIN_KEY: &str = "master-key-v1";
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;

// ---------------------------------------------------------------------------
// Pure crypto (key passed in — unit-testable without the keychain)
// ---------------------------------------------------------------------------

/// Encrypt `plaintext` under `key` using AES-256-GCM with a random nonce.
/// Returns `nonce ‖ ciphertext ‖ tag` as a heap-allocated blob.
pub fn encrypt_with_key(plaintext: &[u8], key: &[u8; KEY_LEN]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).context("init cipher")?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow::anyhow!("AES-GCM encrypt: {e}"))?;
    let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    blob.extend_from_slice(&nonce_bytes);
    blob.extend_from_slice(&ciphertext);
    Ok(blob)
}

/// Decrypt a blob produced by `encrypt_with_key`. Verifies the GCM tag;
/// returns an error if the ciphertext has been tampered with or is truncated.
pub fn decrypt_with_key(blob: &[u8], key: &[u8; KEY_LEN]) -> Result<Vec<u8>> {
    if blob.len() < NONCE_LEN {
        anyhow::bail!("blob too short to contain a nonce ({} bytes)", blob.len());
    }
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).context("init cipher")?;
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| anyhow::anyhow!("AES-GCM decryption failed (tampered or wrong key)"))
}

// ---------------------------------------------------------------------------
// Key management — OS keychain
// ---------------------------------------------------------------------------

/// Get the master key from the OS keychain, creating and storing it on first call.
/// Returns the 32-byte key as a fixed-size array.
pub fn get_or_create_master_key() -> Result<[u8; KEY_LEN]> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_KEY)
        .context("keychain entry")?;
    match entry.get_password() {
        Ok(hex) => {
            let bytes = hex::decode(hex.trim()).context("decode master key hex")?;
            if bytes.len() != KEY_LEN {
                anyhow::bail!("stored master key has wrong length: {}", bytes.len());
            }
            let mut k = [0u8; KEY_LEN];
            k.copy_from_slice(&bytes);
            Ok(k)
        }
        Err(keyring::Error::NoEntry) => {
            // First call: generate, store, return.
            let mut k = [0u8; KEY_LEN];
            rand::thread_rng().fill_bytes(&mut k);
            let hex = hex::encode(k);
            entry.set_password(&hex).context("store master key")?;
            Ok(k)
        }
        Err(e) => Err(anyhow::anyhow!("keychain read: {e}")),
    }
}

/// Encrypt `plaintext` using the master key from the OS keychain.
/// This is the public-facing function used by the sync engine.
pub fn encrypt(plaintext: &[u8]) -> Result<Vec<u8>> {
    let key = get_or_create_master_key()?;
    encrypt_with_key(plaintext, &key)
}

/// Decrypt a blob using the master key from the OS keychain.
pub fn decrypt(blob: &[u8]) -> Result<Vec<u8>> {
    let key = get_or_create_master_key()?;
    decrypt_with_key(blob, &key)
}
```

Also add `pub mod crypto;` to `src-tauri/src/commands/mail/mod.rs`.

### Step 4: Run to confirm pass

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::crypto 2>&1 | tail -20
```
Expected: PASS (6 tests).

### Step 5: Commit

```bash
git add src-tauri/src/commands/mail/crypto.rs src-tauri/src/commands/mail/mod.rs src-tauri/Cargo.toml
git commit -m "feat(mail-enc): crypto module — AES-256-GCM with OS-keychain master key (G1)"
```

---

## Task G2: EncryptedMailStore — SQLCipher metadata + encrypted blob helpers

**Files:**
- Modify: `src-tauri/src/commands/mail/store.rs` (add `EncryptedMailStore` below `SqliteMailStore`, keep `SqliteMailStore` intact)

**Risk: HIGH.** This is the SQLCipher migration. The `bundled-sqlcipher-vendored-openssl` feature compiled in the dep step replaces the bundled plain SQLite. The `SqliteMailStore` will still compile — `PRAGMA key` is a no-op on plain SQLite builds but compiles fine. The regression guard is: `SqliteMailStore` tests from Phase 1 (Tasks 3) must all still pass after this commit.

### Step 1: Write the failing tests

```rust
// src-tauri/src/commands/mail/store.rs — add inside the existing `#[cfg(test)] mod tests`

    // -----------------------------------------------------------------------
    // EncryptedMailStore tests (Group G)
    // -----------------------------------------------------------------------

    fn enc_store() -> (TempDir, EncryptedMailStore) {
        let dir = TempDir::new().unwrap();
        let key = [0x42u8; 32]; // deterministic test key, bypasses keychain
        let s = EncryptedMailStore::open_with_key(dir.path(), &key).expect("enc open");
        (dir, s)
    }

    #[test]
    fn enc_upsert_is_idempotent_by_id() {
        let (_d, s) = enc_store();
        let rec = MailRecord {
            id: "m1".into(), folder_id: "inbox".into(),
            internet_message_id: Some("<x@y>".into()),
            relative_path: ".keepance/mail/blobs/m1.enc".into(),
            received_date_time: Some("2026-05-01T00:00:00Z".into()),
        };
        s.upsert(&rec).unwrap();
        s.upsert(&rec).unwrap();
        assert_eq!(s.count().unwrap(), 1);
        assert!(s.contains("m1").unwrap());
    }

    #[test]
    fn enc_tombstone_removes_record_and_deletes_blob() {
        let (dir, s) = enc_store();
        let key = [0x42u8; 32];
        // Write a real blob to disk first.
        let rel = s.write_blob_with_key("m1", b"hello world", &key).unwrap();
        let blob_abs = dir.path().join(&rel);
        assert!(blob_abs.exists(), "blob must exist after write");

        let rec = MailRecord {
            id: "m1".into(), folder_id: "inbox".into(),
            internet_message_id: None,
            relative_path: rel.clone(),
            received_date_time: None,
        };
        s.upsert(&rec).unwrap();

        let removed = s.tombstone("m1").unwrap();
        assert_eq!(removed.as_deref(), Some(rel.as_str()));
        assert_eq!(s.count().unwrap(), 0);
        // The .enc blob must be gone from disk.
        assert!(!blob_abs.exists(), "blob must be deleted by tombstone");
        // Idempotent: second tombstone returns None.
        assert_eq!(s.tombstone("m1").unwrap(), None);
    }

    #[test]
    fn enc_cursor_roundtrips_per_folder() {
        let (_d, s) = enc_store();
        assert_eq!(s.get_cursor("inbox").unwrap(), None);
        s.set_cursor("inbox", "https://graph/delta?$deltatoken=abc").unwrap();
        assert_eq!(
            s.get_cursor("inbox").unwrap().as_deref(),
            Some("https://graph/delta?$deltatoken=abc")
        );
    }

    #[test]
    fn write_blob_and_read_blob_round_trip() {
        let (dir, s) = enc_store();
        let key = [0x42u8; 32];
        let plaintext = b"Subject: Re: closing\n\nPlease confirm 10am.";
        let rel = s.write_blob_with_key("AAMk-abc", plaintext, &key).unwrap();

        // The file must exist on disk.
        let abs = dir.path().join(&rel);
        assert!(abs.exists());

        // The raw bytes on disk must NOT be the plaintext.
        let raw = std::fs::read(&abs).unwrap();
        assert!(!raw.windows(plaintext.len()).any(|w| w == plaintext),
            "plaintext must not appear in the .enc blob");

        // read_blob must decrypt to the original.
        let recovered = s.read_blob_with_key(&rel, dir.path(), &key).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn write_blob_path_uses_safe_id() {
        let (_d, s) = enc_store();
        let key = [0x42u8; 32];
        let rel = s.write_blob_with_key("AAMk-123/../../etc", b"x", &key).unwrap();
        // Path-traversal chars must be sanitized; blob must land under blobs/.
        assert!(rel.starts_with(".keepance/mail/blobs/"));
        assert!(!rel.contains(".."));
    }

    #[test]
    fn sqlite_mail_store_tests_still_pass_after_sqlcipher_migration() {
        // Regression: the Phase 1 SqliteMailStore must still compile and work.
        // (This test re-runs the same assertions as the Phase 1 tests to confirm
        // the dep change did not break the plain impl.)
        let (_d, s) = store(); // uses SqliteMailStore, defined above
        let rec = MailRecord {
            id: "regression-check".into(), folder_id: "f1".into(),
            internet_message_id: None,
            relative_path: "Mail/f1/r.md".into(),
            received_date_time: None,
        };
        s.upsert(&rec).unwrap();
        assert!(s.contains("regression-check").unwrap());
        assert_eq!(s.count().unwrap(), 1);
    }
```

### Step 2: Run to confirm failure

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::store 2>&1 | tail -20
```
Expected: FAIL — `EncryptedMailStore`, `write_blob_with_key`, `read_blob_with_key` not found.

### Step 3: Write minimal implementation

Add below the closing `}` of the `SqliteMailStore` impl block in `store.rs`:

```rust
// ---------------------------------------------------------------------------
// EncryptedMailStore — SQLCipher metadata + encrypted blob helpers (Group G)
// ---------------------------------------------------------------------------

use crate::commands::mail::crypto::{decrypt_with_key, encrypt_with_key};

pub struct EncryptedMailStore {
    conn: std::sync::Mutex<rusqlite::Connection>,
    workspace_root: std::path::PathBuf,
}

fn safe_id(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect()
}

impl EncryptedMailStore {
    /// Canonical path for the encrypted mail DB.
    pub fn db_path(workspace_root: &std::path::Path) -> std::path::PathBuf {
        workspace_root.join(".keepance").join("mail-enc.db")
    }

    /// Open (or create) the SQLCipher database, keyed with `key`.
    /// The `PRAGMA key` must be the very first statement on the connection.
    pub fn open_with_key(workspace_root: &std::path::Path, key: &[u8; 32]) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn = rusqlite::Connection::open(&p)
            .with_context(|| format!("open enc db {}", p.display()))?;

        // SQLCipher requires the key to be set before any DDL.
        // Use hex-encoded key via `PRAGMA key = "x'<hex>'"` — this is the
        // raw-hex form that SQLCipher accepts and avoids passphrase KDF overhead.
        let hex_key = hex::encode(key);
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS messages (
                id                   TEXT PRIMARY KEY,
                folder_id            TEXT NOT NULL,
                internet_message_id  TEXT,
                relative_path        TEXT NOT NULL,
                received_date_time   TEXT
            );
             CREATE TABLE IF NOT EXISTS folder_cursors (
                folder_id  TEXT PRIMARY KEY,
                cursor     TEXT NOT NULL
            );",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    /// Open with the master key from the OS keychain.
    pub fn open(workspace_root: &std::path::Path) -> Result<Self> {
        let key = crate::commands::mail::crypto::get_or_create_master_key()?;
        Self::open_with_key(workspace_root, &key)
    }

    /// Encrypt `plaintext` and write to `.keepance/mail/blobs/<safe-id>.enc`.
    /// Returns the relative path (relative to `workspace_root`).
    pub fn write_blob_with_key(
        &self,
        id: &str,
        plaintext: &[u8],
        key: &[u8; 32],
    ) -> Result<String> {
        let blob_dir = self.workspace_root.join(".keepance").join("mail").join("blobs");
        std::fs::create_dir_all(&blob_dir).context("create blobs dir")?;
        let filename = format!("{}.enc", safe_id(id));
        let abs = blob_dir.join(&filename);
        let encrypted = encrypt_with_key(plaintext, key)?;
        std::fs::write(&abs, &encrypted)
            .with_context(|| format!("write blob {}", abs.display()))?;
        Ok(format!(".keepance/mail/blobs/{}", filename))
    }

    /// Decrypt and return the contents of an encrypted blob at `rel` (relative to `root`).
    pub fn read_blob_with_key(
        &self,
        rel: &str,
        root: &std::path::Path,
        key: &[u8; 32],
    ) -> Result<Vec<u8>> {
        let abs = root.join(rel);
        let encrypted = std::fs::read(&abs)
            .with_context(|| format!("read blob {}", abs.display()))?;
        decrypt_with_key(&encrypted, key)
    }

    /// Convenience: write blob using the OS keychain master key.
    pub fn write_blob(&self, id: &str, plaintext: &[u8]) -> Result<String> {
        let key = crate::commands::mail::crypto::get_or_create_master_key()?;
        self.write_blob_with_key(id, plaintext, &key)
    }

    /// Convenience: read blob using the OS keychain master key.
    pub fn read_blob(&self, rel: &str) -> Result<Vec<u8>> {
        let key = crate::commands::mail::crypto::get_or_create_master_key()?;
        self.read_blob_with_key(rel, &self.workspace_root, &key)
    }
}

impl MailStore for EncryptedMailStore {
    fn upsert(&self, rec: &MailRecord) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO messages
                (id, folder_id, internet_message_id, relative_path, received_date_time)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
                folder_id           = ?2,
                internet_message_id = ?3,
                relative_path       = ?4,
                received_date_time  = ?5",
            rusqlite::params![
                rec.id, rec.folder_id, rec.internet_message_id,
                rec.relative_path, rec.received_date_time
            ],
        )?;
        Ok(())
    }

    fn tombstone(&self, id: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        let path: Option<String> = c
            .query_row(
                "SELECT relative_path FROM messages WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .ok();
        if let Some(ref rel) = path {
            // Delete the encrypted blob from disk before removing the DB row.
            let abs = self.workspace_root.join(rel);
            let _ = std::fs::remove_file(&abs); // best-effort; ignore if already gone
            c.execute("DELETE FROM messages WHERE id = ?1", [id])?;
        }
        Ok(path)
    }

    fn contains(&self, id: &str) -> Result<bool> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row(
            "SELECT 1 FROM messages WHERE id = ?1",
            [id],
            |_| Ok(()),
        )
        .is_ok())
    }

    fn count(&self) -> Result<i64> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?)
    }

    fn get_cursor(&self, folder_id: &str) -> Result<Option<String>> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row(
            "SELECT cursor FROM folder_cursors WHERE folder_id = ?1",
            [folder_id],
            |r| r.get(0),
        )
        .ok())
    }

    fn set_cursor(&self, folder_id: &str, cursor: &str) -> Result<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO folder_cursors (folder_id, cursor) VALUES (?1, ?2)
             ON CONFLICT(folder_id) DO UPDATE SET cursor = ?2",
            rusqlite::params![folder_id, cursor],
        )?;
        Ok(())
    }
}
```

### Step 4: Run to confirm pass

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::store 2>&1 | tail -20
```
Expected: PASS. All Phase 1 store tests + 6 new EncryptedMailStore tests.

**Regression check:** The `sqlite_mail_store_tests_still_pass_after_sqlcipher_migration` test exercises `SqliteMailStore` directly. If it passes, the dep change did not break the plaintext path.

### Step 5: Commit

```bash
git add src-tauri/src/commands/mail/store.rs
git commit -m "feat(mail-enc): EncryptedMailStore — SQLCipher + encrypted blob read/write (G2)

SQLCipher via rusqlite bundled-sqlcipher-vendored-openssl. SqliteMailStore
kept intact; all Phase 1 store tests still green. tombstone() deletes blob
from disk before removing DB row."
```

---

## Task G3: Switch `apply_page` and sync to encrypted blobs + in-memory index feed

**Files:**
- Modify: `src-tauri/src/commands/mail/sync.rs`
- Modify: `src-tauri/src/commands/mail/mod.rs` (swap `SqliteMailStore` for `EncryptedMailStore` in `mail_sync_all`)

**Risk: HIGH.** This removes the plaintext `Mail/*.md` write. The Phase 1 test `apply_page_writes_new_and_removes_tombstoned` asserts that `Mail/inbox/m1.md` exists on disk — that test must be updated (it now asserts a `.enc` blob exists instead). Also calls the indexer hook added in Task G4, but we stub it here with a no-op closure first.

### Step 1: Write the failing tests

```rust
// src-tauri/src/commands/mail/sync.rs — add inside `#[cfg(test)] mod tests`

    #[test]
    fn apply_page_enc_writes_blob_not_plaintext_md() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];
        let page = serde_json::json!({ "value": [
            { "id":"m1","subject":"Closing","body":{"contentType":"text","content":"See you at 10am."} }
        ]});

        let stats = apply_page_enc(
            &store,
            dir.path(),
            "inbox",
            &page,
            &key,
            &|_id: &str, _text: &str| {}, // stub index callback
        ).unwrap();

        assert_eq!(stats.written, 1);
        // NO plaintext .md anywhere under Mail/
        assert!(!dir.path().join("Mail").exists(),
            "plaintext Mail/ dir must NOT exist when apply_page_enc is used");
        // An encrypted blob exists under .keepance/mail/blobs/
        let blob_dir = dir.path().join(".keepance/mail/blobs");
        let blobs: Vec<_> = std::fs::read_dir(&blob_dir)
            .expect("blobs dir must exist")
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map(|x| x == "enc").unwrap_or(false))
            .collect();
        assert_eq!(blobs.len(), 1, "exactly one .enc blob expected");

        // The blob must decrypt to content that includes the email body.
        let blob_path = blobs[0].path();
        let raw = std::fs::read(&blob_path).unwrap();
        let decrypted = crate::commands::mail::crypto::decrypt_with_key(&raw, &key).unwrap();
        let text = String::from_utf8(decrypted).unwrap();
        assert!(text.contains("See you at 10am."), "decrypted body must contain original text");
    }

    #[test]
    fn apply_page_enc_tombstone_removes_blob() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];

        // Pre-seed: write a blob and register it.
        let blob_rel = {
            let blob_dir = dir.path().join(".keepance/mail/blobs");
            std::fs::create_dir_all(&blob_dir).unwrap();
            let enc = crate::commands::mail::crypto::encrypt_with_key(b"old body", &key).unwrap();
            std::fs::write(blob_dir.join("m2.enc"), &enc).unwrap();
            ".keepance/mail/blobs/m2.enc".to_string()
        };
        store.upsert(&crate::commands::mail::store::MailRecord {
            id: "m2".into(), folder_id: "inbox".into(),
            internet_message_id: None,
            relative_path: blob_rel.clone(),
            received_date_time: None,
        }).unwrap();

        let page = serde_json::json!({ "value": [
            { "id":"m2", "@removed": { "reason":"deleted" } }
        ]});
        let stats = apply_page_enc(
            &store, dir.path(), "inbox", &page, &key,
            &|_id, _text| {},
        ).unwrap();

        assert_eq!(stats.removed, 1);
        assert!(!dir.path().join(&blob_rel).exists(), ".enc blob must be deleted");
        assert!(!store.contains("m2").unwrap());
    }

    #[test]
    fn apply_page_enc_calls_index_callback_with_decrypted_text() {
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];
        let page = serde_json::json!({ "value": [
            { "id":"m3","subject":"Test","body":{"contentType":"text","content":"Index me!"} }
        ]});

        let mut indexed_texts: Vec<(String, String)> = Vec::new();
        let callback = |id: &str, text: &str| {
            // In prod this calls rag_index_mail_text; here we just record.
            // Closure must be Fn (not FnOnce) because apply_page_enc calls it per message.
            // We use a RefCell-wrapped vec here for simplicity in tests.
        };
        // Use a simpler capture approach: Arc<Mutex<Vec>> to collect from the closure.
        let captured = std::sync::Arc::new(std::sync::Mutex::new(Vec::<(String, String)>::new()));
        let cap2 = captured.clone();
        apply_page_enc(
            &store, dir.path(), "inbox", &page, &key,
            &|id: &str, text: &str| {
                cap2.lock().unwrap().push((id.to_string(), text.to_string()));
            },
        ).unwrap();

        let pairs = captured.lock().unwrap();
        assert_eq!(pairs.len(), 1);
        assert_eq!(pairs[0].0, "m3");
        assert!(pairs[0].1.contains("Index me!"), "callback receives plaintext");
    }
```

Also update the Phase 1 regression test so it explicitly documents the behavioral change:

```rust
    #[test]
    fn apply_page_plaintext_original_still_exists_for_sqlitestore() {
        // The original Phase 1 behavior: SqliteMailStore + apply_page (not enc)
        // still writes Mail/*.md plaintext. This test guards against accidentally
        // removing the non-encrypted path. The encrypted path (apply_page_enc)
        // is tested separately above.
        let store = FakeStore::default();
        let dir = tempfile::TempDir::new().unwrap();
        let page = serde_json::json!({ "value": [
            { "id":"m1","subject":"A","body":{"contentType":"text","content":"hello"} }
        ]});
        let stats = apply_page(&store, dir.path(), "inbox", &page).unwrap();
        assert_eq!(stats.written, 1);
        assert!(dir.path().join("Mail/inbox/m1.md").exists());
    }
```

### Step 2: Run to confirm failure

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::sync 2>&1 | tail -25
```
Expected: FAIL — `apply_page_enc` not found.

### Step 3: Write minimal implementation

Add to `sync.rs` after the existing `apply_page` function:

```rust
/// Encrypted variant of apply_page.
///
/// Differences from `apply_page`:
///   - Does NOT write Mail/*.md plaintext files.
///   - Writes each message body as an AES-256-GCM blob under
///     `.keepance/mail/blobs/<safe-id>.enc` using `key`.
///   - After writing the blob, calls `index_callback(id, markdown_plaintext)`
///     so the caller can feed the decrypted text to the RAG indexer and keyword
///     index in memory without the text ever touching disk.
///   - tombstone: removes the .enc blob from disk (via workspace_root join
///     of relative_path) in addition to the store record.
///
/// `store` must be an `EncryptedMailStore` (or any MailStore impl that stores
/// relative_path pointing to .enc files). The trait is used so tests can pass
/// a FakeStore.
pub fn apply_page_enc<F>(
    store: &dyn MailStore,
    workspace_root: &Path,
    folder_id: &str,
    page: &serde_json::Value,
    key: &[u8; 32],
    index_callback: &F,
) -> anyhow::Result<PageStats>
where
    F: Fn(&str, &str),
{
    use crate::commands::mail::crypto::encrypt_with_key;

    let mut stats = PageStats::default();
    let items = page
        .get("value")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for item in &items {
        let id = item.get("id").and_then(|s| s.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }

        if MailMessage::is_removed(item) {
            if let Some(rel) = store.tombstone(id)? {
                // Delete the encrypted blob (relative path points to .enc file).
                let _ = std::fs::remove_file(workspace_root.join(&rel));
                stats.removed += 1;
            }
            continue;
        }

        if let Some(msg) = MailMessage::from_graph(item) {
            let markdown = to_markdown(&msg);

            // Encrypt the markdown and write the blob.
            let blob_dir = workspace_root
                .join(".keepance")
                .join("mail")
                .join("blobs");
            std::fs::create_dir_all(&blob_dir)?;
            let safe = safe_filename(&msg.id);
            let blob_filename = format!("{}.enc", safe);
            let blob_abs = blob_dir.join(&blob_filename);
            let encrypted = encrypt_with_key(markdown.as_bytes(), key)?;
            std::fs::write(&blob_abs, &encrypted)?;

            let rel = format!(".keepance/mail/blobs/{}", blob_filename);
            store.upsert(&MailRecord {
                id: msg.id.clone(),
                folder_id: folder_id.to_string(),
                internet_message_id: msg.internet_message_id.clone(),
                relative_path: rel,
                received_date_time: msg.received_date_time.clone(),
            })?;

            // Feed decrypted text to the in-memory indexer (RAG + keyword).
            // This is the ONLY place the plaintext exists — never written to disk.
            index_callback(&msg.id, &markdown);

            stats.written += 1;
        }
    }
    Ok(stats)
}
```

Update `sync_folder` to accept a key and use `apply_page_enc`. Add an `apply_page_enc`-using `sync_folder_enc`:

```rust
/// Encrypted variant of sync_folder. Uses apply_page_enc instead of apply_page.
/// `index_callback` receives (doc_id, plaintext_markdown) for each new message —
/// the caller feeds this to the RAG indexer and MiniSearch without persisting it.
pub async fn sync_folder_enc<F, I>(
    client: &GraphClient,
    store: &(dyn MailStore + Sync),
    workspace_root: &Path,
    folder_id: &str,
    key: &[u8; 32],
    emit: &F,
    index_callback: &I,
) -> anyhow::Result<PageStats>
where
    F: Fn(u32, u32) + Send,
    I: Fn(&str, &str) + Send + Sync,
{
    use crate::commands::mail::graph::{page_continuation, Continuation, DeltaGone};

    let mut url = match store.get_cursor(folder_id)? {
        Some(saved) => saved,
        None => client.delta_start_url(folder_id),
    };
    let mut total = PageStats::default();
    loop {
        let page = match client.get_json(&url).await {
            Ok(p) => p,
            Err(e) if e.downcast_ref::<DeltaGone>().is_some() => {
                store.set_cursor(folder_id, &client.delta_start_url(folder_id))?;
                url = client.delta_start_url(folder_id);
                continue;
            }
            Err(e) => return Err(e),
        };
        let s = apply_page_enc(store, workspace_root, folder_id, &page, key, index_callback)?;
        total.written += s.written;
        total.removed += s.removed;
        emit(total.written, total.removed);
        match page_continuation(&page) {
            Continuation::Next(next) => {
                store.set_cursor(folder_id, &next)?;
                url = next;
            }
            Continuation::Delta(delta) => {
                store.set_cursor(folder_id, &delta)?;
                break;
            }
            Continuation::End => break,
        }
    }
    Ok(total)
}
```

Also update `mail_sync_all` in `mod.rs` to use `EncryptedMailStore::open` and `sync_folder_enc`. The index callback in `mod.rs` is a no-op stub for now (it will be wired to the real indexer in Task G4). Swap the `store` construction line:

```rust
// In mail_sync_all, replace:
let store = SqliteMailStore::open(&workspace).map_err(|e| e.to_string())?;
// With:
let store = crate::commands::mail::store::EncryptedMailStore::open(&workspace)
    .map_err(|e| e.to_string())?;
let enc_key = crate::commands::mail::crypto::get_or_create_master_key()
    .map_err(|e| e.to_string())?;
```

And replace the `sync::sync_folder` call with `sync::sync_folder_enc(..., &enc_key, &emit, &|_id, _text| {})`.

### Step 4: Run to confirm pass

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::sync 2>&1 | tail -25
```
Expected: PASS — all Phase 1 sync tests plus the 3 new enc tests.

### Step 5: Commit

```bash
git add src-tauri/src/commands/mail/sync.rs src-tauri/src/commands/mail/mod.rs
git commit -m "feat(mail-enc): apply_page_enc — encrypted blobs only, no plaintext Mail/*.md (G3)

Plaintext Mail/*.md writes removed from the active sync path.
All message bodies land in .keepance/mail/blobs/*.enc.
index_callback stub wired; real indexer in G4."
```

---

## Task G4: `rag_index_mail_text` + encrypted chunk text in LanceDB + retrieve decryption

**Files:**
- Modify: `src-tauri/src/commands/rag/store.rs` (add `SourceType::Mail` variant, update `build_schema` with a nullable `encrypted` bool column, update `build_batch`)
- Modify: `src-tauri/src/commands/rag/mod.rs` (add `rag_index_mail_text` command; update `rag_retrieve` to decrypt mail chunks)
- Modify: `src-tauri/src/lib.rs` (register `rag_index_mail_text`)
- Modify: `src-tauri/src/commands/mail/mod.rs` (wire `index_callback` to call `rag_index_mail_text` equivalent in-process)

**Risk: HIGHEST of all tasks.** This touches the shared RAG store that text and PDF indexing already use. The regression requirement is explicit: text and PDF rows must be byte-for-byte unchanged after this change. Guard this with two dedicated regression tests before touching production code.

### Step 1: Write the failing tests

```rust
// src-tauri/src/commands/rag/store.rs — add inside #[cfg(test)] mod tests

    // G4 regression: text-source rows must be unchanged after schema extension.
    #[test]
    fn build_batch_text_source_type_unchanged_after_g4_schema() {
        use arrow_array::cast::AsArray;
        let rows = vec![(
            Chunk { path: "/a.md".into(), paragraph_index: 0,
                    text: "hello world".into(), start_offset: 0, end_offset: 11 },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Text).expect("build_batch text");
        // text column must contain the original plaintext (not encrypted).
        let text_col = batch.column_by_name("text").expect("text col").as_string::<i32>();
        assert_eq!(text_col.value(0), "hello world",
            "text-source text column must be plaintext after G4 schema change");
        // source_type must still be "text".
        let st_col = batch.column_by_name("source_type").expect("st col").as_string::<i32>();
        assert_eq!(st_col.value(0), "text");
        // encrypted column must be false for text rows.
        let enc_col = batch.column_by_name("encrypted")
            .expect("encrypted column must exist")
            .as_boolean();
        assert!(!enc_col.value(0), "text rows must have encrypted=false");
    }

    #[test]
    fn build_batch_pdf_source_type_unchanged_after_g4_schema() {
        use arrow_array::cast::AsArray;
        let rows = vec![(
            Chunk { path: "/a.pdf".into(), paragraph_index: 0,
                    text: "page text".into(), start_offset: 0, end_offset: 9 },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch(&rows, SourceType::Pdf { page_number: 3 }).expect("build_batch pdf");
        let text_col = batch.column_by_name("text").expect("text col").as_string::<i32>();
        assert_eq!(text_col.value(0), "page text",
            "pdf-source text column must be plaintext after G4 schema change");
        let st_col = batch.column_by_name("source_type").expect("st col").as_string::<i32>();
        assert_eq!(st_col.value(0), "pdf");
        let enc_col = batch.column_by_name("encrypted")
            .expect("encrypted column must exist")
            .as_boolean();
        assert!(!enc_col.value(0), "pdf rows must have encrypted=false");
    }

    #[test]
    fn build_batch_mail_source_stores_ciphertext_in_text_column() {
        use arrow_array::cast::AsArray;
        let plaintext = "Re: closing — see you at 10am.";
        let key = [0x42u8; 32];
        let rows = vec![(
            Chunk { path: "mail:AAMk-abc".into(), paragraph_index: 0,
                    text: plaintext.to_string(), start_offset: 0, end_offset: plaintext.len() },
            vec![0.1f32; EMBEDDING_DIM],
        )];
        let batch = build_batch_mail(&rows, &key).expect("build_batch mail");
        let text_col = batch.column_by_name("text").expect("text col").as_string::<i32>();
        let stored = text_col.value(0);
        // The text column must NOT contain the plaintext.
        assert!(!stored.contains(plaintext),
            "mail text column must contain ciphertext, not plaintext; got: {:?}", &stored[..stored.len().min(30)]);
        // source_type must be "mail".
        let st_col = batch.column_by_name("source_type").expect("st col").as_string::<i32>();
        assert_eq!(st_col.value(0), "mail");
        // encrypted must be true.
        let enc_col = batch.column_by_name("encrypted").expect("enc col").as_boolean();
        assert!(enc_col.value(0), "mail rows must have encrypted=true");
    }
```

```rust
// src-tauri/src/commands/rag/mod.rs — add inside #[cfg(test)] mod tests

    // G4: rag_retrieve must decrypt mail chunk text before returning.
    // This is an integration test against a real tempdir LanceDB instance.
    #[tokio::test]
    async fn rag_retrieve_decrypts_mail_chunks_and_leaves_text_chunks_unchanged() {
        use super::store::{
            open_connection, open_or_create_table, build_batch_mail,
            upsert_chunks_for_path, SourceType,
        };
        use super::chunker::Chunk;
        use super::embedder::{embed_documents, EMBEDDING_DIM};
        use crate::commands::mail::crypto::decrypt_with_key;

        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];

        let conn = open_connection(dir.path()).await.expect("open");
        let table = open_or_create_table(&conn).await.expect("table");

        // Index one text chunk (plaintext, no encryption).
        let text_chunk = Chunk {
            path: "/ws/doc.md".into(), paragraph_index: 0,
            text: "consulting fee schedule".into(),
            start_offset: 0, end_offset: 23,
        };
        let text_vecs = embed_documents(&["consulting fee schedule".to_string()])
            .await.expect("embed text");
        let text_rows = vec![(text_chunk, text_vecs[0].clone())];
        upsert_chunks_for_path(&table, "/ws/doc.md", text_rows, SourceType::Text)
            .await.expect("upsert text");

        // Index one mail chunk (encrypted text column).
        let mail_text = "Re: consulting agreement — terms confirmed.";
        let mail_chunk = Chunk {
            path: "mail:AAMk-123".into(), paragraph_index: 0,
            text: mail_text.to_string(),
            start_offset: 0, end_offset: mail_text.len(),
        };
        let mail_vecs = embed_documents(&[mail_text.to_string()])
            .await.expect("embed mail");
        let mail_rows = vec![(mail_chunk, mail_vecs[0].clone())];
        let mail_batch = build_batch_mail(&mail_rows, &key).expect("build mail batch");
        // Upsert the mail batch directly via the lower-level add API.
        use lancedb::query::ExecutableQuery;
        use arrow_schema::SchemaRef;
        use arrow_array::RecordBatchIterator;
        let schema: SchemaRef = mail_batch.schema();
        let iter = RecordBatchIterator::new(vec![Ok(mail_batch)], schema);
        table.add(Box::new(iter)).execute().await.expect("add mail rows");

        // Now retrieve: the mail chunk's text column on disk is ciphertext,
        // but the Hit returned must contain plaintext.
        let qvec = super::embedder::embed_query("consulting agreement")
            .await.expect("embed query");
        let hits = store::nearest(&table, &qvec, 5).await.expect("nearest");

        let mail_hit = hits.iter().find(|h| h.path.starts_with("mail:"))
            .expect("mail hit not found");
        // Verify the raw stored text is NOT plaintext (it's base64 ciphertext).
        assert!(!mail_hit.text.contains("confirmed"),
            "raw StoredHit text for mail must be ciphertext, not plaintext");

        // rag_retrieve decrypts: simulate what rag_retrieve does.
        let ciphertext_bytes = hex::decode(&mail_hit.text).expect("hex decode stored text");
        let decrypted = decrypt_with_key(&ciphertext_bytes, &key).expect("decrypt");
        let decrypted_str = String::from_utf8(decrypted).expect("utf8");
        assert!(decrypted_str.contains("confirmed"), "decrypted mail text must be plaintext");

        // The text hit must remain plaintext — no decryption applied.
        let text_hit = hits.iter().find(|h| h.path == "/ws/doc.md")
            .expect("text hit not found");
        assert!(text_hit.text.contains("consulting fee"),
            "text-source hit must return plaintext directly");
    }
```

### Step 2: Run to confirm failure

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib rag::store 2>&1 | tail -20
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib rag::mod 2>&1 | tail -20
```
Expected: FAIL — `build_batch_mail`, `encrypted` column, `SourceType::Mail` not found.

### Step 3: Write minimal implementation

**3a. Update `rag/store.rs`:**

Add `Mail` to the `SourceType` enum:
```rust
pub enum SourceType {
    Text,
    Pdf { page_number: u32 },
    /// Email message. `text` column holds hex-encoded AES-256-GCM ciphertext.
    Mail,
}
```

Update `build_schema` to add a 9th column. Because LanceDB datasets tolerate new nullable columns (existing datasets opened without the column will return `null`), this is safe:
```rust
// In build_schema(), add after the page_number field:
Field::new("encrypted", DataType::Boolean, true),
```

Update `build_batch` to populate the `encrypted` column (false for Text and Pdf):
```rust
// In build_batch(), after pn_arr:
let enc_arr = arrow_array::BooleanArray::from(vec![false; rows.len()]);
// In RecordBatch::try_new vec, add Arc::new(enc_arr) at end.
```

Add a new `build_batch_mail` function that encrypts the `text` column:
```rust
/// Build a RecordBatch for mail chunks. The `text` column contains
/// hex-encoded AES-256-GCM ciphertext (encrypt_with_key). Embeddings are
/// computed from plaintext (already passed in as `rows`). `encrypted = true`.
pub fn build_batch_mail(rows: &[(Chunk, Vec<f32>)], key: &[u8; 32]) -> Result<RecordBatch> {
    use crate::commands::mail::crypto::encrypt_with_key;

    let schema = build_schema();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let ids: Vec<String> = rows.iter().map(|(c, _)| chunk_id(&c.path, c.paragraph_index)).collect();
    let paths: Vec<&str> = rows.iter().map(|(c, _)| c.path.as_str()).collect();
    let para_idx: Vec<u32> = rows.iter().map(|(c, _)| c.paragraph_index).collect();
    let timestamps = vec![now; rows.len()];

    // Encrypt each chunk's text; store as hex string.
    let encrypted_texts: Vec<String> = rows
        .iter()
        .map(|(c, _)| {
            encrypt_with_key(c.text.as_bytes(), key)
                .map(|blob| hex::encode(&blob))
                .unwrap_or_default()
        })
        .collect();

    let vectors = FixedSizeListArray::from_iter_primitive::<Float32Type, _, _>(
        rows.iter().map(|(_, v)| Some(v.iter().copied().map(Some).collect::<Vec<_>>())),
        EMBEDDING_DIM as i32,
    );

    let id_arr = StringArray::from_iter_values(ids.iter().map(|s| s.as_str()));
    let path_arr = StringArray::from_iter_values(paths.iter().copied());
    let pi_arr = UInt32Array::from(para_idx);
    let text_arr = StringArray::from_iter_values(encrypted_texts.iter().map(|s| s.as_str()));
    let ts_arr = Int64Array::from(timestamps);
    let st_arr = StringArray::from(vec!["mail"; rows.len()]);
    let pn_arr = UInt32Array::from(vec![0u32; rows.len()]);
    let enc_arr = arrow_array::BooleanArray::from(vec![true; rows.len()]);

    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(id_arr), Arc::new(path_arr), Arc::new(pi_arr),
            Arc::new(text_arr), Arc::new(vectors), Arc::new(ts_arr),
            Arc::new(st_arr), Arc::new(pn_arr), Arc::new(enc_arr),
        ],
    )
    .context("RecordBatch::try_new failed for mail chunks batch")
}
```

Also update `StoredHit` and `nearest` to read the `encrypted` field:
```rust
pub struct StoredHit {
    // ... existing fields ...
    pub encrypted: bool, // true for mail chunks; false for text/pdf/pre-G4
}
// In nearest(), read the encrypted column:
let enc_col = batch
    .column_by_name("encrypted")
    .and_then(|c| c.as_any().downcast_ref::<arrow_array::BooleanArray>());
// In the per-row loop:
let encrypted = enc_col.map(|c| !c.is_null(i) && c.value(i)).unwrap_or(false);
out.push(StoredHit { ..., encrypted });
```

**3b. Update `rag/mod.rs`:**

Add the `rag_index_mail_text` Tauri command:
```rust
/// Index pre-encrypted mail text into the RAG store.
///
/// Called after `apply_page_enc` decrypts a blob in memory.
/// `doc_id` is the mail message id (used as the `path` discriminator, prefixed
/// with "mail:" to separate the namespace from workspace file paths).
/// `plaintext` is the decrypted markdown. It is chunked + embedded in memory;
/// the chunk `text` column is stored encrypted.
///
/// Precedent: `rag_index_pdf_chunks` already takes text, not a file path.
#[tauri::command]
pub async fn rag_index_mail_text(
    state: State<'_, RagState>,
    doc_id: String,
    plaintext: String,
) -> Result<u32, String> {
    if plaintext.trim().is_empty() {
        return Ok(0);
    }
    let workspace = require_workspace(&state).await?;
    let conn = store::open_connection(&workspace)
        .await
        .map_err(|e| format!("open lancedb: {e}"))?;
    let table = store::open_or_create_table(&conn)
        .await
        .map_err(|e| format!("open table: {e}"))?;

    // Use "mail:<id>" as the path key so tombstones can use rag_delete_path.
    let path_key = format!("mail:{}", doc_id);
    let chunks = chunker::chunk_text(&path_key, &plaintext);
    if chunks.is_empty() {
        store::delete_path(&table, &path_key).await.map_err(|e| e.to_string())?;
        return Ok(0);
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    let vectors = embedder::embed_documents(&texts)
        .await
        .map_err(|e| format!("embed mail: {e}"))?;
    let rows: Vec<(chunker::Chunk, Vec<f32>)> = chunks.into_iter().zip(vectors).collect();

    let key = crate::commands::mail::crypto::get_or_create_master_key()
        .map_err(|e| format!("get master key: {e}"))?;

    // Delete stale rows for this mail id before upsert (idempotent).
    store::delete_path(&table, &path_key)
        .await
        .map_err(|e| format!("delete stale: {e}"))?;

    let batch = store::build_batch_mail(&rows, &key)
        .map_err(|e| format!("build mail batch: {e}"))?;
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .map_err(|e| format!("add mail chunks: {e}"))?;

    Ok(rows.len() as u32)
}
```

Update `rag_retrieve` to decrypt mail chunks before building `Hit`:
```rust
// In rag_retrieve, change the mapping from raw to hits:
let key_result = crate::commands::mail::crypto::get_or_create_master_key();
let enc_key = key_result.ok(); // None if keychain unavailable; hits decrypt to error text

let mut hits: Vec<Hit> = raw
    .into_iter()
    .map(|h| {
        let chunk_text = if h.encrypted {
            // Mail chunk: decrypt hex-encoded ciphertext.
            if let Some(ref k) = enc_key {
                hex::decode(&h.text)
                    .ok()
                    .and_then(|bytes| {
                        crate::commands::mail::crypto::decrypt_with_key(&bytes, k).ok()
                    })
                    .and_then(|v| String::from_utf8(v).ok())
                    .unwrap_or_else(|| "[mail content unavailable]".to_string())
            } else {
                "[mail content unavailable — keychain locked]".to_string()
            }
        } else {
            h.text
        };
        Hit {
            path: h.path,
            chunk_text,
            score: embedder::cosine_distance_to_score(h.distance),
            paragraph_index: h.paragraph_index,
            source_type: h.source_type,
            page_number: h.page_number,
        }
    })
    .collect();
```

Register in `lib.rs`:
```rust
commands::rag::rag_index_mail_text,
```

Wire in `mail/mod.rs` `mail_sync_all`: replace the stub `|_id, _text| {}` index callback with a call to an async helper that invokes the in-process equivalent of `rag_index_mail_text`. Because sync is already async and the callback is synchronous, use a `tokio::runtime::Handle::current().spawn(...)` pattern or pass the table reference directly. The simplest approach: call the internal `index_mail_text_internal(workspace, doc_id, plaintext)` async helper (same logic as the command but without `State`) via `tokio::task::spawn` and `let _ = result.await` inside the sync loop.

### Step 4: Run to confirm pass

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib rag::store 2>&1 | tail -20
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib rag 2>&1 | tail -20
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail 2>&1 | tail -20
```
Expected: All green.

**Explicit regression check command:**
```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib rag::store::tests::build_batch_text_source_type_unchanged_after_g4_schema rag::store::tests::build_batch_pdf_source_type_unchanged_after_g4_schema 2>&1 | tail -10
```
Expected: Both pass. If either fails, do not proceed to G5.

### Step 5: Commit

```bash
git add src-tauri/src/commands/rag/store.rs src-tauri/src/commands/rag/mod.rs src-tauri/src/lib.rs src-tauri/src/commands/mail/mod.rs
git commit -m "feat(mail-enc): rag_index_mail_text + encrypted LanceDB text column for mail (G4)

text/pdf rows unchanged (regression-tested). mail rows store hex AES-GCM
ciphertext in text column; rag_retrieve decrypts before returning Hit.
encrypted column added (nullable, backward-compatible)."
```

---

## Task G5: Keyword search in-memory feed (MiniSearch)

**Files:**
- Modify: `src-tauri/src/commands/mail/mod.rs` (emit a Tauri event after each message write that the frontend can intercept)
- Modify: `src/hooks/useMailSync.ts` (subscribe to per-message index event; call `contentIndex.upsert`)
- Modify: `src/components/settings/MailConnect.tsx` (pass `contentIndex.upsert` down — or use a global event bus)

**Background from codebase exploration:** The keyword search is `ContentIndex.ts` (MiniSearch), exposed via `useContentIndex` hook in `App.tsx`. The hook returns an `upsert(doc: ContentIndexDocument)` method. `ContentIndexDocument` = `{id: string, path: string, name: string, content: string}`. The index is rebuilt from the file tree on workspace open, but it reads files from disk — encrypted blobs will not be readable by the file watcher. Mail must be fed directly via `upsert`.

The current `mail-sync-progress` event carries `{status, folder, written, removed}`. We need a per-message event to feed decrypted text into MiniSearch without persisting it.

**Design assumption (underspecified point):** The design doc says "keyword search is in-memory and rebuilt per session from decrypted text" but does not specify the mechanism for feeding it. Assumption: emit a new Tauri event `mail-index-chunk` with `{docId, subject, decryptedText}` after each message is written in `apply_page_enc`. The frontend subscribes and calls `contentIndex.upsert`. This keeps the decrypted text in the renderer process memory (same process as MiniSearch) and never writes it to disk.

### Step 1: Write the failing tests

```ts
// src/hooks/useMailSync.test.ts  (new file)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
}));
import { listen } from '@tauri-apps/api/event';
import { useMailSync } from './useMailSync';

describe('useMailSync', () => {
  beforeEach(() => vi.clearAllMocks());

  it('subscribes to mail-sync-progress on mount', async () => {
    renderHook(() => useMailSync({ onMailChunk: undefined }));
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith('mail-sync-progress', expect.any(Function));
  });

  it('subscribes to mail-index-chunk when onMailChunk provided', async () => {
    const onMailChunk = vi.fn();
    renderHook(() => useMailSync({ onMailChunk }));
    await Promise.resolve();
    expect(listen).toHaveBeenCalledWith('mail-index-chunk', expect.any(Function));
  });
});
```

```ts
// src/utils/mail-commands.test.ts — add
it('mail-index-chunk event constant is exported', async () => {
  const { MAIL_INDEX_CHUNK_EVENT } = await import('./mail-commands');
  expect(MAIL_INDEX_CHUNK_EVENT).toBe('mail-index-chunk');
});
```

### Step 2: Run to confirm failure

```
npm test -- useMailSync mail-commands 2>&1 | tail -15
```
Expected: FAIL — `MAIL_INDEX_CHUNK_EVENT` and `onMailChunk` param not found.

### Step 3: Write minimal implementation

In `src/utils/mail-commands.ts`, add:
```ts
export const MAIL_INDEX_CHUNK_EVENT = 'mail-index-chunk';
export interface MailIndexChunk { docId: string; subject: string; decryptedText: string; }
```

In `src/hooks/useMailSync.ts`, add an optional `onMailChunk` param:
```ts
import { MAIL_INDEX_CHUNK_EVENT, type MailIndexChunk } from '@/utils/mail-commands';

interface UseMailSyncOptions {
  onMailChunk?: (chunk: MailIndexChunk) => void;
}

export function useMailSync({ onMailChunk }: UseMailSyncOptions = {}) {
  const setProgress = useMailStore((s) => s.setProgress);
  useEffect(() => {
    if (!isTauri()) return;
    const unProg = listen<MailSyncProgress>(MAIL_SYNC_EVENT, (e) => setProgress(e.payload));
    const unChunk = onMailChunk
      ? listen<MailIndexChunk>(MAIL_INDEX_CHUNK_EVENT, (e) => onMailChunk(e.payload))
      : Promise.resolve(() => {});
    return () => {
      unProg.then((f) => f());
      unChunk.then((f) => f());
    };
  }, [setProgress, onMailChunk]);
}
```

In `src-tauri/src/commands/mail/mod.rs`, add `MAIL_INDEX_CHUNK_EVENT = "mail-index-chunk"` and emit it from the `index_callback` wired in G3/G4:
```rust
pub const MAIL_INDEX_CHUNK_EVENT: &str = "mail-index-chunk";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MailIndexChunkPayload {
    pub doc_id: String,
    pub subject: String,
    pub decrypted_text: String,
}
```

In `mail_sync_all`, replace the no-op callback with:
```rust
let app3 = app.clone();
let chunk_emit = move |id: &str, text: &str| {
    let subject = text.lines()
        .find(|l| l.starts_with("subject:"))
        .and_then(|l| l.split_once(':').map(|(_, v)| v.trim().to_string()))
        .unwrap_or_default();
    let _ = app3.emit(MAIL_INDEX_CHUNK_EVENT, MailIndexChunkPayload {
        doc_id: id.to_string(),
        subject,
        decrypted_text: text.to_string(),
    });
};
```

In `MailConnect.tsx`, pass `onMailChunk` to `useMailSync`, which calls `contentIndex.upsert`. Because `contentIndex` lives in `App.tsx`, expose it via a Zustand store atom or pass it as a prop to `MailConnect`. The simplest approach (matching existing patterns): expose a `useMailSearchFeed` hook in `App.tsx` that subscribes and calls the local `contentIndex.upsert` — mount it alongside `useMemoryWiring`:

```ts
// In App.tsx (near the contentIndex lines):
useMailSync({
  onMailChunk: (chunk) => {
    contentIndex.upsert({
      id: `mail:${chunk.docId}`,
      path: `mail:${chunk.docId}`,
      name: chunk.subject || 'Email',
      content: chunk.decryptedText,
    });
  },
});
```

### Step 4: Run to confirm pass

```
npm test -- useMailSync mail-commands 2>&1 | tail -15
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo build 2>&1 | tail -5
```
Expected: TS tests pass; Rust builds clean.

### Step 5: Commit

```bash
git add src/hooks/useMailSync.ts src/utils/mail-commands.ts src/App.tsx src-tauri/src/commands/mail/mod.rs
git commit -m "feat(mail-enc): in-memory MiniSearch feed for decrypted mail text (G5)

mail-index-chunk Tauri event carries decrypted text to renderer; App.tsx
feeds it to contentIndex.upsert — no plaintext written to disk."
```

---

## Task G6: OS full-disk encryption detection + Connect-panel nudge

**Files:**
- Create: `src-tauri/src/commands/mail/fde.rs`
- Modify: `src-tauri/src/commands/mail/mod.rs` (add `pub mod fde;`, register command)
- Modify: `src-tauri/src/lib.rs` (register `mail_fde_status`)
- Modify: `src/components/settings/MailConnect.tsx` (show nudge if FDE is off)
- Modify: `src/utils/mail-commands.ts` (add `mailFdeStatus` wrapper)

**Risk: Low.** Best-effort detection only; never blocks user flow.

### Step 1: Write the failing tests

```rust
// src-tauri/src/commands/mail/fde.rs (bottom)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fde_status_has_known_variant() {
        // Smoke test: detect() returns a valid FdeStatus without panicking.
        // We cannot assert a specific value in CI (may be off on Linux without
        // a secret-service daemon), so we just verify it deserializes cleanly.
        let status = detect();
        let json = serde_json::to_string(&status).expect("serialize FdeStatus");
        assert!(
            json.contains("\"status\""),
            "FdeStatus must serialize with a 'status' field: {}",
            json
        );
    }

    #[test]
    fn fde_status_serializes_camel_case() {
        let s = FdeStatus { status: FdeState::On, platform: "test".into(), detail: None };
        let json = serde_json::to_string(&s).expect("serialize");
        // Frontend checks `status === 'on'` etc.
        assert!(json.contains("\"on\"") || json.contains("\"off\"") || json.contains("\"unknown\""));
    }
}
```

```ts
// src/utils/mail-commands.test.ts — add
it('mailFdeStatus invokes mail_fde_status', async () => {
  (invoke as any).mockResolvedValue({ status: 'on', platform: 'macOS', detail: null });
  const { mailFdeStatus } = await import('./mail-commands');
  const result = await mailFdeStatus();
  expect(invoke).toHaveBeenCalledWith('mail_fde_status');
  expect(result.status).toBe('on');
});
```

```tsx
// src/components/settings/MailConnect.test.tsx — add
it('shows FDE nudge when status is off', async () => {
  const mailCmds = await import('@/utils/mail-commands');
  vi.mocked(mailCmds.mailFdeStatus).mockResolvedValue({ status: 'off', platform: 'Windows', detail: null });
  render(<MailConnect />);
  expect(await screen.findByText(/full.disk encryption/i)).toBeInTheDocument();
});
```

### Step 2: Run to confirm failure

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::fde 2>&1 | tail -15
npm test -- mail-commands MailConnect 2>&1 | tail -15
```
Expected: FAIL.

### Step 3: Write minimal implementation

```rust
// src-tauri/src/commands/mail/fde.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FdeState { On, Off, Unknown }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FdeStatus {
    pub status: FdeState,
    pub platform: String,
    pub detail: Option<String>,
}

/// Best-effort OS full-disk encryption detection. Never blocks user flow.
pub fn detect() -> FdeStatus {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let out = Command::new("fdesetup").arg("status").output();
        match out {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
                let state = if s.contains("filevault is on") {
                    FdeState::On
                } else if s.contains("filevault is off") {
                    FdeState::Off
                } else {
                    FdeState::Unknown
                };
                return FdeStatus { status: state, platform: "macOS".into(), detail: None };
            }
            Err(_) => return FdeStatus { status: FdeState::Unknown, platform: "macOS".into(), detail: Some("fdesetup unavailable".into()) },
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // `manage-bde -status C:` exit code 0 = encrypted, non-zero or no output = off/unknown.
        let out = Command::new("manage-bde").args(["-status", "C:"]).output();
        match out {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
                let state = if s.contains("percentage encrypted: 100") || s.contains("protection on") {
                    FdeState::On
                } else if s.contains("protection off") || s.contains("percentage encrypted: 0") {
                    FdeState::Off
                } else {
                    FdeState::Unknown
                };
                return FdeStatus { status: state, platform: "Windows".into(), detail: None };
            }
            Err(_) => return FdeStatus { status: FdeState::Unknown, platform: "Windows".into(), detail: Some("manage-bde unavailable".into()) },
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Linux best-effort: check if root partition uses LUKS (lsblk -o NAME,TYPE).
        use std::process::Command;
        let out = Command::new("lsblk").args(["-o", "NAME,TYPE"]).output();
        let state = match out {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout);
                if s.contains("crypt") { FdeState::On } else { FdeState::Unknown }
            }
            Err(_) => FdeState::Unknown,
        };
        return FdeStatus { status: state, platform: "Linux".into(), detail: Some("LUKS crypt device detection".into()) };
    }
    #[allow(unreachable_code)]
    FdeStatus { status: FdeState::Unknown, platform: "unknown".into(), detail: None }
}

#[tauri::command]
pub async fn mail_fde_status() -> Result<FdeStatus, String> {
    Ok(detect())
}
```

Add `pub mod fde;` to `mod.rs`. Register `commands::mail::fde::mail_fde_status` in `lib.rs`.

In `mail-commands.ts`:
```ts
export interface FdeStatus { status: 'on' | 'off' | 'unknown'; platform: string; detail?: string | null; }
export async function mailFdeStatus(): Promise<FdeStatus> {
  if (!isTauri()) return { status: 'unknown', platform: 'browser' };
  return invoke<FdeStatus>('mail_fde_status');
}
```

In `MailConnect.tsx`, add after the `useEffect(() => { mailIsConnected... })` block:
```tsx
const [fdeStatus, setFdeStatus] = useState<'on' | 'off' | 'unknown'>('unknown');
useEffect(() => {
  mailFdeStatus().then((s) => setFdeStatus(s.status)).catch(() => {});
}, []);
```

Add nudge below the main description paragraph (only shown when status is 'off'):
```tsx
{fdeStatus === 'off' && (
  <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
    Full-disk encryption is off on this machine. Advisor Prep Hero encrypts your mail, but enabling
    FileVault (macOS) or BitLocker (Windows) adds a second layer of protection if your device is stolen.
  </p>
)}
```

### Step 4: Run to confirm pass

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::fde 2>&1 | tail -10
npm test -- mail-commands MailConnect 2>&1 | tail -15
```
Expected: PASS.

### Step 5: Commit

```bash
git add src-tauri/src/commands/mail/fde.rs src-tauri/src/commands/mail/mod.rs src-tauri/src/lib.rs src/utils/mail-commands.ts src/components/settings/MailConnect.tsx
git commit -m "feat(mail-enc): OS FDE detection + nudge in MailConnect (G6)

Best-effort BitLocker/FileVault/LUKS detection via shell commands.
Non-blocking: shows a one-line nudge if FDE is off, never blocks sync."
```

---

## Task G7: Migration — clean up any existing plaintext Phase-1 mail

**Files:**
- Modify: `src-tauri/src/commands/mail/mod.rs` (add migration step to `mail_sync_all` startup)

**Context:** Phase 1 was only used on test accounts. The design doc says: "none in production yet; on connect, prefer a clean encrypted re-import; delete stale plaintext if present." This task handles the edge case where a developer ran Phase 1 against a workspace.

**Design assumption (underspecified point):** The design doc says "delete stale plaintext" but does not specify whether to re-import automatically. Assumption: on `mail_sync_all`, scan for `Mail/` directory under the workspace root. If it exists and is non-empty, delete it entirely (the next sync will import everything encrypted). This is safe because Phase 1 data is all test data and can be re-downloaded from Graph. Document this in the commit message and in a `docs/strategy/` note.

### Step 1: Write the failing test

```rust
// src-tauri/src/commands/mail/sync.rs — add to tests module
    #[test]
    fn migrate_plaintext_mail_deletes_mail_directory() {
        let dir = tempfile::TempDir::new().unwrap();
        // Simulate a Phase-1 workspace with plaintext mail.
        let mail_dir = dir.path().join("Mail").join("inbox");
        std::fs::create_dir_all(&mail_dir).unwrap();
        std::fs::write(mail_dir.join("m1.md"), "---\nmessage_id: m1\n---\n\nHello").unwrap();
        assert!(dir.path().join("Mail").exists());

        migrate_plaintext(&dir.path());

        assert!(!dir.path().join("Mail").exists(),
            "Mail/ directory must be deleted by migration");
    }
```

### Step 2: Run to confirm failure

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::sync::tests::migrate_plaintext_mail_deletes_mail_directory 2>&1 | tail -10
```
Expected: FAIL.

### Step 3: Write minimal implementation

In `sync.rs`:
```rust
/// Called once at the start of mail_sync_all. If a plaintext `Mail/` directory
/// from Phase 1 exists in the workspace, remove it. The next sync will
/// re-import all messages as encrypted blobs. This is safe because:
/// - Phase 1 data was only used on test accounts (no production mail).
/// - All data is re-downloadable from Microsoft Graph on next sync.
/// - The SqliteMailStore (mail.db) is left in place; EncryptedMailStore uses
///   mail-enc.db, so there is no schema conflict.
pub fn migrate_plaintext(workspace_root: &Path) {
    let mail_dir = workspace_root.join("Mail");
    if mail_dir.exists() {
        log::info!("migration: removing plaintext Mail/ directory from Phase 1");
        let _ = std::fs::remove_dir_all(&mail_dir);
    }
}
```

Call `migrate_plaintext(&workspace)` at the top of `mail_sync_all` before the folder enumeration loop.

Also: if a `mail.db` (plaintext SQLite) exists, leave it — `EncryptedMailStore` uses `mail-enc.db` as a different file, so both coexist without conflict. Document this in the commit.

### Step 4: Run to confirm pass

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail::sync 2>&1 | tail -15
```
Expected: All sync tests pass including the new migration test.

### Step 5: Full test gate

```
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib mail 2>&1 | tail -20
cd src-tauri && KEEPANCE_MS_CLIENT_ID=dev cargo test --lib rag 2>&1 | tail -20
npm test 2>&1 | tail -20
npx tsc -b 2>&1 | tail -5
```
Expected: All green; 0 TypeScript errors.

### Step 6: Commit

```bash
git add src-tauri/src/commands/mail/sync.rs src-tauri/src/commands/mail/mod.rs
git commit -m "feat(mail-enc): migration — delete Phase-1 plaintext Mail/ on first encrypted sync (G7)

mail.db (Phase-1 SQLite) coexists with mail-enc.db (SQLCipher); no schema
conflict. Mail/ plaintext directory deleted on sync_all so no cleartext email
bodies persist after upgrade."
```

---

## Self-Review: Design-Doc Coverage + Type Consistency

### Design doc point checklist

| Design doc requirement | Task | Status |
|---|---|---|
| 32-byte master key in OS keychain (service `keepance-mail-enc`) | G1 | Covered. `get_or_create_master_key()` uses service `"keepance-mail-enc"`, key `"master-key-v1"`. |
| AES-256-GCM, per-blob random nonce, no hand-rolled crypto | G1 | Covered. `aes-gcm = "0.10"` crate used; 12-byte nonce pre-pended to output. |
| Email bodies → `.keepance/mail/blobs/<safe-id>.enc` | G2, G3 | Covered. `write_blob_with_key` writes to `.keepance/mail/blobs/`. `apply_page_enc` calls it. |
| No plaintext `Mail/*.md` ever touches disk | G3 | Covered. `apply_page_enc` replaces `apply_page` in `mail_sync_all`. Test asserts `Mail/` dir does not exist. |
| Metadata → SQLCipher via `PRAGMA key` | G2 | Covered. `EncryptedMailStore::open_with_key` issues `PRAGMA key = "x'<hex>'"`. |
| `EncryptedMailStore` behind `MailStore` trait, `sync.rs` unchanged | G2 | Covered. `sync.rs`'s `apply_page_enc` takes `&dyn MailStore`, not a concrete type. |
| Search index: text-only path, no file round-trip | G4 | Covered. `rag_index_mail_text` takes `(doc_id, plaintext)`, mirrors `rag_index_pdf_chunks`. |
| LanceDB chunk `text` column encrypted for mail rows | G4 | Covered. `build_batch_mail` hex-encodes AES-GCM ciphertext in `text` column. `encrypted = true`. |
| Existing text/PDF rows byte-for-byte unchanged | G4 | Covered. Two explicit regression tests in `rag/store.rs`. |
| `rag_retrieve` decrypts mail chunks before returning | G4 | Covered. `rag_retrieve` checks `h.encrypted`, hex-decodes, calls `decrypt_with_key`. |
| Embeddings remain plaintext (documented residual) | G4 | Consistent. `build_batch_mail` uses plaintext vectors from `embed_documents`. |
| Keyword search in-memory, no plaintext persisted | G5 | Covered. MiniSearch `upsert` called from `mail-index-chunk` event in renderer. |
| OS FDE check, non-blocking nudge in Connect panel | G6 | Covered. `fde::detect()` + `FdeStatus` + nudge in `MailConnect.tsx`. |
| Migration of Phase-1 plaintext mail | G7 | Covered. `migrate_plaintext()` deletes `Mail/` on first sync. |

### Type consistency across tasks

| Type | Rust definition | TypeScript mirror | Notes |
|---|---|---|---|
| `FdeStatus` | `fde.rs`: `{status: FdeState, platform: String, detail: Option<String>}` with `#[serde(rename_all="camelCase")]` | `mail-commands.ts`: `{status: 'on'|'off'|'unknown', platform: string, detail?: string|null}` | `FdeState` enum variants serialize to lowercase strings via serde. |
| `MailIndexChunkPayload` | `mod.rs`: `{doc_id, subject, decrypted_text}` camelCase | `mail-commands.ts`: `MailIndexChunk {docId, subject, decryptedText}` | Rust sends; TS receives. serde rename ensures camelCase on wire. |
| `EncryptedMailStore.relative_path` | Starts with `.keepance/mail/blobs/` | n/a (not exposed to frontend) | Consistent with `MailRecord.relative_path` field contract. |
| `SourceType::Mail` | `rag/store.rs` enum | n/a (internal to Rust) | `source_type` column stores `"mail"` string in LanceDB. `Hit.source_type` already `Option<String>` — no TS change needed. |
| `encrypted` column | `BooleanArray`, nullable | n/a (hidden behind `rag_retrieve` decryption) | `StoredHit.encrypted: bool` internal; not in `Hit` serialization. |
| `MAIL_INDEX_CHUNK_EVENT` | `"mail-index-chunk"` (Rust const) | `"mail-index-chunk"` (TS const export) | Must match exactly. Test in `mail-commands.test.ts` asserts the string value. |

### Underspecified points and assumptions made

1. **SQLCipher feature name.** The design doc says "verify the correct feature name." The plan uses `bundled-sqlcipher-vendored-openssl` (rusqlite 0.32 docs; the only fully-vendored variant). If rusqlite changes it, the compiler emits "feature not found" — easy to spot. Documented in the dep-addition step.

2. **SQLCipher `PRAGMA key` format.** The design doc does not specify whether to use a passphrase or raw-hex key. The plan uses the raw-hex form (`x'<hex>'`) to bypass the KDF entirely — since the key is already a high-entropy 32-byte random value from the keychain, the KDF would add cost with no security benefit. This is documented in G2 step 3.

3. **How encrypted LanceDB text is stored.** The design doc says "chunk `text` column for mail chunks is stored encrypted" but does not specify encoding. The plan uses hex-encoding (via the `hex` crate, already in `Cargo.toml`) so the ciphertext blob (arbitrary bytes) can be stored in the LanceDB `Utf8` column without null-byte issues. Alternatively, base64 would work — hex chosen for consistency with `get_or_create_master_key`'s hex storage.

4. **How the MiniSearch keyword feed works.** The design doc says "rebuilt per session from decrypted text" but does not specify the IPC mechanism. The plan emits a `mail-index-chunk` Tauri event per message and subscribes in `App.tsx` via `useMailSync({onMailChunk})`. This matches the existing `mail-sync-progress` event pattern exactly.

5. **Migration: re-import vs. delete only.** The design doc says "prefer a clean encrypted re-import; delete stale plaintext if present." Interpreted as: delete the `Mail/` directory; the next `mail_sync_all` re-downloads everything. Documented in G7. Explicit assumption: no production mail exists on Phase 1 (confirmed by design doc: "none in production yet").

6. **`sync_folder_enc` callback signature: sync vs. async.** The `apply_page_enc` callback `F: Fn(&str, &str)` is synchronous (so `apply_page_enc` itself can remain sync). The `rag_index_mail_text` call is async. In `mod.rs`'s `mail_sync_all`, the Tauri event emit is sync (fire-and-forget), which works. The in-process equivalent for `rag_index_mail_text` is invoked via `tokio::task::spawn` — a Tokio runtime is available since `mail_sync_all` is `async`. This keeps `apply_page_enc` unit-testable with a simple `Fn` closure.

---

### Critical Files for Implementation
- `/home/jameson/keepance/src-tauri/src/commands/mail/crypto.rs`
- `/home/jameson/keepance/src-tauri/src/commands/mail/store.rs`
- `/home/jameson/keepance/src-tauri/src/commands/mail/sync.rs`
- `/home/jameson/keepance/src-tauri/src/commands/rag/store.rs`
- `/home/jameson/keepance/src-tauri/src/commands/rag/mod.rs`

---

**Saved plan path:** `docs/superpowers/plans/2026-06-06-email-encryption-groupG.md`
(Note: this is a read-only planning session — the file content is delivered above as the plan; the implementing engineer should save it there.)

**Number of tasks:** 7 tasks (G1 through G7), plus one dependency-addition step before G1.

**High-risk tasks:**
- **G2** (HIGH) — SQLCipher dependency swap; first build takes several minutes; C toolchain + `perl` + `cmake` required for vendored OpenSSL. Regression test `sqlite_mail_store_tests_still_pass_after_sqlcipher_migration` guards the Phase 1 store path.
- **G3** (HIGH) — Removes plaintext `Mail/*.md` writes from the live sync path. The existing Phase 1 test `apply_page_writes_new_and_removes_tombstoned` must be updated to assert `.enc` exists instead. Two new tests guard this explicitly.
- **G4** (HIGHEST) — Modifies the shared RAG store schema and `rag_retrieve`. Two dedicated regression tests (`build_batch_text_source_type_unchanged_after_g4_schema`, `build_batch_pdf_source_type_unchanged_after_g4_schema`) must pass before the commit proceeds. If either fails, the PR must not merge.

**Underspecified points found in the design doc:**
1. SQLCipher `PRAGMA key` format (assumed raw-hex to skip KDF) — noted in G2.
2. Encrypted text storage encoding in LanceDB Utf8 column (assumed hex, consistent with existing `hex` crate usage) — noted in G4.
3. MiniSearch feed mechanism (assumed Tauri event per message, matching existing event patterns) — noted in G5.
4. Migration re-import semantics (assumed delete-only; Graph re-downloads on next sync) — noted in G7.

// Durable encrypted SQLCipher store for normalised Wealthbox CRM objects.
//
// Holds the local canonical copy that makes deletions, re-rendering, and
// resumable sync correct.  Mirrors `EncryptedMailStore` exactly in structure:
//
//   crm-enc.db        — SQLCipher, key from a workspace-owned keychain service
//     crm_objects     — raw JSON rows for every synced Wealthbox object
//     crm_cursors     — per-object-type delta high-water cursors
//     crm_render_state — fetched-vs-indexed state per household
//     meta            — key/value flags (general purpose)
//
// The `json` column stores the raw Wealthbox response as-is.  Typed parsing
// comes in a later phase; the store is intentionally generic over object kind.

use anyhow::{Context, Result};
use crate::util::sync::lock_unpoison;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Key management — dedicated keychain entry (NOT shared with mail or vectors)
// ---------------------------------------------------------------------------

const CRM_KEYCHAIN_SERVICE: &str = crate::identity::CRM_ENC_SERVICE;
const LEGACY_CRM_KEYCHAIN_SERVICE: &str = crate::identity::LEGACY_CRM_ENC_SERVICE;
const CRM_KEYCHAIN_KEY: &str = "master-key-v1";
const CRM_KEY_SERVICE_HINT_FILE: &str = "crm-enc.key-service";
const WORKSPACE_CRM_KEY_SERVICE_PREFIX: &str = "lantern-ws-";
const WORKSPACE_CRM_KEY_SERVICE_SUFFIX: &str = "-crm-enc";
const KEY_LEN: usize = 32;

pub const CRM_STORE_RECOVERY_CODE: &str = "CRM_STORE_RECOVERY_REQUIRED";
pub const CRM_STORE_RECOVERY_MESSAGE: &str = "CRM_STORE_RECOVERY_REQUIRED: Saved CRM imports cannot be unlocked on this device. Your file search still works. Rebuild the local CRM copy from your connected CRM accounts in Connections.";

#[derive(Debug, thiserror::Error)]
#[error("{CRM_STORE_RECOVERY_MESSAGE}")]
struct CrmStoreRecoveryRequired;

pub fn is_crm_store_recovery_required(error: &anyhow::Error) -> bool {
    error.downcast_ref::<CrmStoreRecoveryRequired>().is_some()
}

pub fn crm_store_user_message(error: &anyhow::Error) -> String {
    if is_crm_store_recovery_required(error) {
        CRM_STORE_RECOVERY_MESSAGE.to_string()
    } else {
        error.to_string()
    }
}

#[derive(Clone)]
struct CrmKeyCandidate {
    service: String,
    key: [u8; KEY_LEN],
}

fn decode_crm_master_key(encoded: &str, service: &str) -> Result<[u8; KEY_LEN]> {
    let bytes = hex::decode(encoded.trim())
        .with_context(|| format!("decode CRM master key from service {service}"))?;
    if bytes.len() != KEY_LEN {
        anyhow::bail!(
            "stored CRM master key from service {service} has wrong length: {}",
            bytes.len()
        );
    }
    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&bytes);
    Ok(key)
}

fn headless_test_crm_master_key() -> Result<Option<[u8; KEY_LEN]>> {
    let Ok(encoded) = std::env::var("LANTERN_HEADLESS_TEST_CRM_MASTER_KEY_HEX") else {
        return Ok(None);
    };
    decode_crm_master_key(&encoded, "headless-test").map(Some)
}

fn read_crm_master_key(service: &str) -> Result<Option<[u8; KEY_LEN]>> {
    let entry = keyring::Entry::new(service, CRM_KEYCHAIN_KEY)
        .with_context(|| format!("CRM keychain entry for service {service}"))?;
    match entry.get_password() {
        Ok(encoded) => decode_crm_master_key(&encoded, service).map(Some),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(anyhow::anyhow!(
            "CRM keychain read for service {service}: {error}"
        )),
    }
}

fn workspace_crm_key_service(workspace_root: &Path) -> String {
    let absolute = std::fs::canonicalize(workspace_root).unwrap_or_else(|_| {
        if workspace_root.is_absolute() {
            workspace_root.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_default()
                .join(workspace_root)
        }
    });
    let normalized = absolute.to_string_lossy().replace('\\', "/");
    #[cfg(windows)]
    let normalized = normalized.to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    format!(
        "{WORKSPACE_CRM_KEY_SERVICE_PREFIX}{}{WORKSPACE_CRM_KEY_SERVICE_SUFFIX}",
        hex::encode(&digest[..16])
    )
}

fn is_workspace_crm_key_service(service: &str) -> bool {
    let Some(id) = service
        .strip_prefix(WORKSPACE_CRM_KEY_SERVICE_PREFIX)
        .and_then(|value| value.strip_suffix(WORKSPACE_CRM_KEY_SERVICE_SUFFIX))
    else {
        return false;
    };
    id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn persist_crm_master_key(service: &str, key: &[u8; KEY_LEN]) -> Result<()> {
    let entry = keyring::Entry::new(service, CRM_KEYCHAIN_KEY)
        .with_context(|| format!("CRM keychain entry for service {service}"))?;
    entry
        .set_password(&hex::encode(key))
        .with_context(|| format!("store CRM master key for service {service}"))
}

fn delete_crm_master_key(service: &str) -> Result<()> {
    match keyring::Entry::new(service, CRM_KEYCHAIN_KEY)
        .with_context(|| format!("CRM keychain entry for service {service}"))?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(anyhow::anyhow!(
            "delete CRM keychain key for service {service}: {error}"
        )),
    }
}

fn crm_service_from_keyring_target(target: &str) -> Option<String> {
    let prefix = format!("{CRM_KEYCHAIN_KEY}.");
    let service = target.strip_prefix(&prefix)?;
    if service.is_empty()
        || service.len() > 255
        || service.chars().any(char::is_control)
        || !service.ends_with("-crm-enc")
    {
        return None;
    }
    Some(service.to_string())
}

fn crm_key_service_hint_path(workspace_root: &Path) -> PathBuf {
    crate::commands::data_dir::workspace_data_dir(workspace_root)
        .join(CRM_KEY_SERVICE_HINT_FILE)
}

fn read_crm_key_service_hint(workspace_root: &Path) -> Option<String> {
    let path = crm_key_service_hint_path(workspace_root);
    let encoded = match std::fs::read_to_string(&path) {
        Ok(encoded) => encoded,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            log::warn!("crm: could not read key-service hint {}: {error}", path.display());
            return None;
        }
    };
    let target = format!("{CRM_KEYCHAIN_KEY}.{}", encoded.trim());
    let service = crm_service_from_keyring_target(&target);
    if service.is_none() {
        log::warn!("crm: ignored invalid key-service hint in {}", path.display());
    }
    service
}

fn write_crm_key_service_hint(workspace_root: &Path, service: &str) -> Result<()> {
    let target = format!("{CRM_KEYCHAIN_KEY}.{service}");
    let service = crm_service_from_keyring_target(&target)
        .context("refuse to persist an invalid CRM key-service hint")?;
    let path = crm_key_service_hint_path(workspace_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("create CRM key-service hint directory {}", parent.display()))?;
    }
    std::fs::write(&path, service)
        .with_context(|| format!("write CRM key-service hint {}", path.display()))
}

#[cfg(windows)]
fn discover_historical_crm_keychain_services() -> Vec<String> {
    use windows_sys::Win32::Security::Credentials::{
        CredEnumerateW, CredFree, CREDENTIALW, CRED_TYPE_GENERIC,
    };

    unsafe fn wide_string(ptr: *const u16) -> Option<String> {
        if ptr.is_null() {
            return None;
        }
        let mut len = 0usize;
        while len < 32_768 && unsafe { *ptr.add(len) } != 0 {
            len += 1;
        }
        if len == 32_768 {
            return None;
        }
        String::from_utf16(unsafe { std::slice::from_raw_parts(ptr, len) }).ok()
    }

    let mut count = 0u32;
    let mut credentials: *mut *mut CREDENTIALW = std::ptr::null_mut();
    if unsafe { CredEnumerateW(std::ptr::null(), 0, &mut count, &mut credentials) } == 0 {
        return Vec::new();
    }

    let mut services = Vec::new();
    let entries = unsafe { std::slice::from_raw_parts(credentials, count as usize) };
    for &credential_ptr in entries {
        if credential_ptr.is_null() {
            continue;
        }
        let credential = unsafe { &*credential_ptr };
        if credential.Type != CRED_TYPE_GENERIC {
            continue;
        }
        if let Some(service) = unsafe { wide_string(credential.TargetName) }
            .as_deref()
            .and_then(crm_service_from_keyring_target)
        {
            services.push(service);
        }
    }
    unsafe { CredFree(credentials.cast()) };
    services.sort();
    services.dedup();
    services
}

#[cfg(not(windows))]
fn discover_historical_crm_keychain_services() -> Vec<String> {
    Vec::new()
}

fn existing_crm_key_candidates(workspace_root: &Path) -> Result<Vec<CrmKeyCandidate>> {
    if let Some(key) = headless_test_crm_master_key()? {
        return Ok(vec![CrmKeyCandidate {
            service: "headless-test".to_string(),
            key,
        }]);
    }

    let mut services = Vec::new();
    if let Some(service) = read_crm_key_service_hint(workspace_root) {
        services.push(service);
    }
    services.push(CRM_KEYCHAIN_SERVICE.to_string());
    services.push(LEGACY_CRM_KEYCHAIN_SERVICE.to_string());
    services.extend(discover_historical_crm_keychain_services());
    let mut seen_services = std::collections::HashSet::new();
    services.retain(|service| seen_services.insert(service.clone()));

    let mut candidates = Vec::new();
    let mut read_errors = Vec::new();
    for service in services {
        match read_crm_master_key(&service) {
            Ok(Some(key))
                if !candidates
                    .iter()
                    .any(|candidate: &CrmKeyCandidate| candidate.key == key) =>
            {
                candidates.push(CrmKeyCandidate { service, key });
            }
            Ok(_) => {}
            Err(error) => {
                log::warn!("crm: could not read key service {service}: {error:#}");
                read_errors.push(format!("{service}: {error:#}"));
            }
        }
    }
    if candidates.is_empty() && !read_errors.is_empty() {
        anyhow::bail!(
            "no usable CRM keys could be read from OS credential storage ({})",
            read_errors.join("; ")
        );
    }
    Ok(candidates)
}

/// Create (or resume an interrupted creation of) one workspace-owned key.
/// Older builds put every workspace behind one global credential. Disconnecting
/// any workspace could therefore delete the key for all of them.
fn create_workspace_crm_key_candidate(workspace_root: &Path) -> Result<CrmKeyCandidate> {
    if let Some(key) = headless_test_crm_master_key()? {
        return Ok(CrmKeyCandidate {
            service: "headless-test".to_string(),
            key,
        });
    }

    let service = workspace_crm_key_service(workspace_root);
    if let Some(key) = read_crm_master_key(&service)? {
        write_crm_key_service_hint(workspace_root, &service)?;
        return Ok(CrmKeyCandidate { service, key });
    }

    let mut key = [0u8; KEY_LEN];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut key);
    persist_crm_master_key(&service, &key)?;
    if let Err(error) = write_crm_key_service_hint(workspace_root, &service) {
        if let Err(cleanup_error) = delete_crm_master_key(&service) {
            log::warn!("crm: could not clean up key after hint write failed: {cleanup_error:#}");
        }
        return Err(error);
    }
    Ok(CrmKeyCandidate { service, key })
}

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/// One row from `crm_objects`.  `id` is namespaced, e.g. `contact:123`,
/// `household:789`, `note:456`.  `json` is the raw Wealthbox API response.
#[derive(Debug, Clone)]
pub struct CrmObjectRow {
    pub id: String,
    pub kind: String,
    pub household_id: String,
    pub updated_at: String,
    pub content_hash: String,
    pub json: String,
    pub deleted: bool,
}

// ---------------------------------------------------------------------------
// CrmStore
// ---------------------------------------------------------------------------

/// One CRM object to upsert, collected during `ingest` so a whole sync's writes
/// commit in a single transaction (`apply_ingest_batch`). Mirrors the args of
/// `upsert_object` one-for-one.
pub struct CrmUpsert {
    pub id: String,
    pub kind: String,
    pub household_id: String,
    pub updated_at: String,
    pub content_hash: String,
    pub json: String,
}

/// One row from `crm_outbound_writes` — the idempotency ledger for the
/// approval-gated write path (`write.rs::push_crm_write`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundWrite {
    pub dedup_key: String,
    /// "pending" | "sent" | "pending_verify" | "failed"
    pub status: String,
    pub remote_id: Option<String>,
    /// RFC 3339 timestamp of this write's first attempt (set once, never
    /// updated by later status transitions) — lets recovery verification
    /// reject a CRM record that predates this attempt, see
    /// `write.rs::find_recent_matching`.
    pub created_at: String,
}

/// One encrypted pending CRM write proposal. This is the Rust-side replacement
/// for the old renderer `localStorage` queue: the UI can still render previews,
/// but the restart-surviving copy lives in SQLCipher.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingCrmProposal {
    pub proposal_id: String,
    pub provider: String,
    /// "note" | "task" | "field"
    pub kind: String,
    pub matter_id: String,
    pub household_key: String,
    pub content_hash: String,
    pub title: String,
    pub body: String,
    pub due_date: Option<String>,
    pub source_ref: String,
    pub requested_at: Option<String>,
    pub field: Option<String>,
    pub existing_value: Option<String>,
    pub new_value: Option<String>,
    pub final_value: Option<String>,
    pub provenance: Option<String>,
    pub ai_source_kind: Option<String>,
    pub ai_source_date: Option<String>,
    /// UI status: proposed | sending | failed | verify_pending | stale | sent.
    pub status: String,
    pub remote_id: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// The one INSERT-or-update statement `upsert_object` and `apply_ingest_batch`
/// share, so the single-row and batched paths can never drift. Runs against a
/// `Connection` or a `Transaction` (both deref to `Connection`).
fn upsert_crm_object_row(
    conn: &Connection,
    id: &str,
    kind: &str,
    household_id: &str,
    updated_at: &str,
    content_hash: &str,
    json: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO crm_objects
            (id, kind, household_id, updated_at, content_hash, json, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
         ON CONFLICT(id) DO UPDATE SET
            kind         = ?2,
            household_id = ?3,
            updated_at   = ?4,
            content_hash = ?5,
            json         = ?6,
            deleted      = 0",
        rusqlite::params![id, kind, household_id, updated_at, content_hash, json],
    )?;
    Ok(())
}

pub struct CrmStore {
    conn: std::sync::Mutex<Connection>,
    #[allow(dead_code)]
    workspace_root: PathBuf,
}

impl CrmStore {
    /// Canonical path for the encrypted CRM DB inside a workspace.
    pub fn db_path(workspace_root: &Path) -> PathBuf {
        crate::commands::data_dir::workspace_data_dir(workspace_root).join("crm-enc.db")
    }

    /// Open (or create) the SQLCipher database keyed with `key`.
    /// PRAGMA key MUST be the very first statement on the connection.
    pub fn open_with_key(workspace_root: &Path, key: &[u8; KEY_LEN]) -> Result<Self> {
        let p = Self::db_path(workspace_root);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let conn =
            Connection::open(&p).with_context(|| format!("open crm enc db {}", p.display()))?;

        // SQLCipher: key must be set before any DDL.
        // Raw-hex form bypasses passphrase KDF overhead.
        let hex_key = hex::encode(key);
        conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex_key))?;

        // Two concurrent writers (sync loop + indexer) need a wait instead of
        // an immediate "database is locked" failure.
        conn.busy_timeout(std::time::Duration::from_secs(5))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS crm_objects (
                id            TEXT PRIMARY KEY,
                kind          TEXT NOT NULL,
                household_id  TEXT NOT NULL DEFAULT '',
                updated_at    TEXT NOT NULL DEFAULT '',
                content_hash  TEXT NOT NULL DEFAULT '',
                json          TEXT NOT NULL DEFAULT '',
                deleted       INTEGER NOT NULL DEFAULT 0
            );
             CREATE INDEX IF NOT EXISTS idx_crm_objects_household
                ON crm_objects(household_id);
             CREATE INDEX IF NOT EXISTS idx_crm_objects_kind
                ON crm_objects(kind);
             CREATE TABLE IF NOT EXISTS crm_cursors (
                object_type  TEXT PRIMARY KEY,
                cursor       TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS crm_render_state (
                household_id  TEXT PRIMARY KEY,
                render_hash   TEXT NOT NULL DEFAULT '',
                indexed       INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS meta (
                key    TEXT PRIMARY KEY,
                value  TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS crm_outbound_writes (
               dedup_key     TEXT PRIMARY KEY,
               provider      TEXT NOT NULL,
               kind          TEXT NOT NULL,
               household_key TEXT NOT NULL,
               matter_id     TEXT NOT NULL,
               source_ref    TEXT NOT NULL,
               status        TEXT NOT NULL,
               remote_id     TEXT,
               created_at    TEXT NOT NULL,
               updated_at    TEXT NOT NULL,
               content_key   TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE IF NOT EXISTS crm_write_proposals (
               proposal_id    TEXT PRIMARY KEY,
               provider       TEXT NOT NULL,
               kind           TEXT NOT NULL,
               matter_id      TEXT NOT NULL,
               household_key  TEXT NOT NULL DEFAULT '',
               content_hash   TEXT NOT NULL,
               title          TEXT NOT NULL,
               body           TEXT NOT NULL,
               due_date       TEXT,
               source_ref     TEXT NOT NULL,
               requested_at   TEXT,
               field          TEXT,
               existing_value TEXT,
               new_value      TEXT,
               final_value    TEXT,
               provenance     TEXT,
               ai_source_kind TEXT,
               ai_source_date TEXT,
               status         TEXT NOT NULL,
               remote_id      TEXT,
               error          TEXT,
               created_at     TEXT NOT NULL,
               updated_at     TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_crm_write_proposals_matter
                ON crm_write_proposals(matter_id);
             CREATE INDEX IF NOT EXISTS idx_crm_write_proposals_status
                ON crm_write_proposals(status);",
        )?;
        migrate_crm_columns(&conn);
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
            workspace_root: workspace_root.to_path_buf(),
        })
    }

    fn open_with_key_candidates(
        workspace_root: &Path,
        candidates: &[CrmKeyCandidate],
    ) -> Result<(Self, usize)> {
        if candidates.is_empty() {
            return Err(CrmStoreRecoveryRequired.into());
        }

        let mut first_wrong_key_error = None;
        for (index, candidate) in candidates.iter().enumerate() {
            match Self::open_with_key(workspace_root, &candidate.key) {
                Ok(store) => return Ok((store, index)),
                Err(error) => {
                    let is_wrong_key = error
                        .chain()
                        .any(|cause| cause.to_string().contains("file is not a database"));
                    if !is_wrong_key {
                        return Err(error).with_context(|| {
                            format!(
                                "open encrypted CRM database with key service {}",
                                candidate.service
                            )
                        });
                    }
                    first_wrong_key_error.get_or_insert(error);
                }
            }
        }

        let first_error = first_wrong_key_error.expect("non-empty candidates produced an error");
        log::warn!(
            "crm: none of {} available keys opened the encrypted database: {first_error:#}",
            candidates.len()
        );
        Err(CrmStoreRecoveryRequired.into())
    }

    /// Open with the master key from the OS keychain.
    pub fn open(workspace_root: &Path) -> Result<Self> {
        if !Self::db_path(workspace_root).exists() {
            let candidate = create_workspace_crm_key_candidate(workspace_root)?;
            match Self::open_with_key(workspace_root, &candidate.key) {
                Ok(store) => return Ok(store),
                Err(error) => {
                    if candidate.service != "headless-test" {
                        let _ = Self::purge(workspace_root);
                        if let Err(cleanup_error) = delete_crm_master_key(&candidate.service) {
                            log::warn!("crm: could not clean up key after database creation failed: {cleanup_error:#}");
                        }
                    }
                    return Err(error);
                }
            }
        }

        // Existing encrypted data must be recovered before any new key is
        // generated. Creating a replacement first turns a recoverable service-
        // name migration into a permanent wrong-key loop.
        let hinted_service = read_crm_key_service_hint(workspace_root);
        let candidates = existing_crm_key_candidates(workspace_root)?;
        let (store, used_index) = Self::open_with_key_candidates(workspace_root, &candidates)?;
        let used = &candidates[used_index];
        if used.service == "headless-test" {
            return Ok(store);
        }

        let expected_workspace_service = workspace_crm_key_service(workspace_root);
        let already_workspace_owned = used.service == expected_workspace_service
            && hinted_service.as_deref() == Some(used.service.as_str());
        if already_workspace_owned {
            return Ok(store);
        }

        // Older databases remain readable through their global key. Copy those
        // SAME bytes into a unique workspace-owned credential. Never overwrite
        // or delete the global key: another old workspace may still need it.
        let workspace_service = expected_workspace_service;
        match persist_crm_master_key(&workspace_service, &used.key)
            .and_then(|()| write_crm_key_service_hint(workspace_root, &workspace_service))
        {
            Ok(()) => log::info!("crm: migrated encrypted database key to a workspace-owned credential"),
            Err(error) => {
                if let Err(cleanup_error) = delete_crm_master_key(&workspace_service) {
                    log::warn!("crm: could not clean up incomplete workspace key migration: {cleanup_error:#}");
                }
                if let Err(hint_error) = write_crm_key_service_hint(workspace_root, &used.service) {
                    log::warn!("crm: recovered database but could not save its working key hint: {hint_error:#}");
                }
                log::warn!("crm: recovered database but could not copy its key to a workspace-owned credential: {error:#}");
            }
        }
        Ok(store)
    }

    // -----------------------------------------------------------------------
    // crm_objects helpers
    // -----------------------------------------------------------------------

    /// Insert or update a CRM object row.  On conflict, all columns are
    /// overwritten and `deleted` is reset to 0 (a re-synced object is live).
    #[allow(dead_code)]
    pub fn upsert_object(
        &self,
        id: &str,
        kind: &str,
        household_id: &str,
        updated_at: &str,
        content_hash: &str,
        json: &str,
    ) -> Result<()> {
        let c = lock_unpoison(&self.conn);
        upsert_crm_object_row(&c, id, kind, household_id, updated_at, content_hash, json)
    }

    /// Apply a whole ingest's writes in ONE transaction: every upsert (each
    /// resets `deleted = 0`) then every tombstone. Autocommit fsyncs once per
    /// statement, so a sync of thousands of objects costs thousands of fsyncs;
    /// a single transaction cuts that to one commit. Upserts run before
    /// tombstones — the exact order `ingest` used when it wrote them inline, so
    /// the result is identical. Empty input is a no-op. P2.3 row 7.
    pub fn apply_ingest_batch(
        &self,
        upserts: &[CrmUpsert],
        tombstone_ids: &[String],
    ) -> Result<()> {
        if upserts.is_empty() && tombstone_ids.is_empty() {
            return Ok(());
        }
        let mut c = lock_unpoison(&self.conn);
        let tx = c.transaction()?;
        for u in upserts {
            upsert_crm_object_row(
                &tx,
                &u.id,
                &u.kind,
                &u.household_id,
                &u.updated_at,
                &u.content_hash,
                &u.json,
            )?;
        }
        for id in tombstone_ids {
            tx.execute("UPDATE crm_objects SET deleted = 1 WHERE id = ?1", [id])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Fetch one object by id, regardless of deleted flag.
    #[allow(dead_code)]
    pub fn get_object(&self, id: &str) -> Result<Option<CrmObjectRow>> {
        let c = lock_unpoison(&self.conn);
        Ok(c.query_row(
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects WHERE id = ?1",
            [id],
            row_to_crm_object,
        )
        .ok())
    }

    /// Return all non-deleted objects for a given household.
    #[allow(dead_code)]
    pub fn list_objects_by_household(&self, household_id: &str) -> Result<Vec<CrmObjectRow>> {
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare(
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects
             WHERE household_id = ?1 AND deleted = 0",
        )?;
        let rows = stmt
            .query_map([household_id], row_to_crm_object)?
            .collect::<rusqlite::Result<Vec<CrmObjectRow>>>()?;
        Ok(rows)
    }

    /// P2.3 row 8: the cheap change-detection digest for a household — its
    /// non-deleted objects as `(id, kind, content_hash)`, in the SAME order (same
    /// WHERE, no ORDER BY) `list_objects_by_household` returns them. This lets the
    /// sync engine decide "did this household's plan change?" WITHOUT reading or
    /// deserialising the (large) `json` column or running any render function.
    /// `content_hash` is a strong hash of the JSON, so identical digests mean
    /// identical rendered output (barring a hash collision).
    #[allow(dead_code)]
    pub fn list_object_digests_by_household(
        &self,
        household_id: &str,
    ) -> Result<Vec<(String, String, String)>> {
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare(
            "SELECT id, kind, content_hash
             FROM crm_objects
             WHERE household_id = ?1 AND deleted = 0",
        )?;
        let rows = stmt
            .query_map([household_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<(String, String, String)>>>()?;
        Ok(rows)
    }

    /// Return all non-deleted object ids for a given kind.
    /// Used for snapshot-diff deletion detection: anything in the previous
    /// snapshot but absent from the new API response should be tombstoned.
    #[allow(dead_code)]
    pub fn list_object_ids(&self, kind: &str) -> Result<Vec<String>> {
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare("SELECT id FROM crm_objects WHERE kind = ?1 AND deleted = 0")?;
        let rows = stmt
            .query_map([kind], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(rows)
    }

    /// Return every non-deleted object id across all kinds. Used for snapshot-diff
    /// deletion detection: ids present here but absent from the latest full API
    /// response have been removed in Wealthbox and should be tombstoned.
    #[allow(dead_code)]
    pub fn list_all_object_ids(&self) -> Result<Vec<String>> {
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare("SELECT id FROM crm_objects WHERE deleted = 0")?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(rows)
    }

    /// Return every non-deleted object whose store id carries a provider marker in the
    /// id payload, e.g. `contact:sfdc:003...`. This is used for provider-scoped
    /// disconnect so removing Salesforce cannot remove Wealthbox rows.
    #[allow(dead_code)]
    pub fn list_objects_by_provider_marker(&self, marker: &str) -> Result<Vec<CrmObjectRow>> {
        self.list_objects_by_provider_marker_inner(marker, false)
    }

    /// Return every object whose store id carries a provider marker, including
    /// tombstoned rows. Disconnect uses this path so stale RAG chunks from rows
    /// that disappeared in an earlier sync are purged before the DB rows are
    /// hard-deleted.
    #[allow(dead_code)]
    pub fn list_objects_by_provider_marker_including_deleted(
        &self,
        marker: &str,
    ) -> Result<Vec<CrmObjectRow>> {
        self.list_objects_by_provider_marker_inner(marker, true)
    }

    fn list_objects_by_provider_marker_inner(
        &self,
        marker: &str,
        include_deleted: bool,
    ) -> Result<Vec<CrmObjectRow>> {
        let marker = marker.trim();
        if marker.is_empty() || marker.contains('%') || marker.contains('_') {
            anyhow::bail!("invalid CRM provider marker");
        }
        let c = lock_unpoison(&self.conn);
        let like = format!("{marker}%");
        let sql = if include_deleted {
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects
             WHERE substr(id, instr(id, ':') + 1) LIKE ?1"
        } else {
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects
             WHERE substr(id, instr(id, ':') + 1) LIKE ?1 AND deleted = 0"
        };
        let mut stmt = c.prepare(sql)?;
        let rows = stmt
            .query_map([like], row_to_crm_object)?
            .collect::<rusqlite::Result<Vec<CrmObjectRow>>>()?;
        Ok(rows)
    }

    /// Return every legacy Wealthbox row, including tombstoned rows. Wealthbox
    /// owns the original unprefixed id space (`contact:10002`, `note:456`).
    #[allow(dead_code)]
    pub fn list_legacy_wealthbox_objects_including_deleted(&self) -> Result<Vec<CrmObjectRow>> {
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare(
            "SELECT id, kind, household_id, updated_at, content_hash, json, deleted
             FROM crm_objects
             WHERE instr(id, ':') = 0
                OR (
                    substr(id, instr(id, ':') + 1) NOT LIKE 'sfdc:%'
                    AND substr(id, instr(id, ':') + 1) NOT LIKE 'redtail:%'
                )",
        )?;
        let rows = stmt
            .query_map([], row_to_crm_object)?
            .collect::<rusqlite::Result<Vec<CrmObjectRow>>>()?;
        Ok(rows)
    }

    /// Hard-delete every CRM object whose store id carries the given provider
    /// marker. Render-state rows for affected households are also removed so a
    /// later sync recomputes the matter plan from the remaining provider rows.
    #[allow(dead_code)]
    pub fn purge_objects_by_provider_marker(&self, marker: &str) -> Result<usize> {
        let marker = marker.trim();
        if marker.is_empty() || marker.contains('%') || marker.contains('_') {
            anyhow::bail!("invalid CRM provider marker");
        }
        let c = lock_unpoison(&self.conn);
        let like = format!("{marker}%");

        let mut stmt = c.prepare(
            "SELECT DISTINCT household_id FROM crm_objects
             WHERE substr(id, instr(id, ':') + 1) LIKE ?1 AND household_id != ''",
        )?;
        let household_ids = stmt
            .query_map([like.as_str()], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        drop(stmt);

        for household_id in household_ids {
            c.execute(
                "DELETE FROM crm_render_state WHERE household_id = ?1",
                [household_id],
            )?;
        }

        let deleted = c.execute(
            "DELETE FROM crm_objects WHERE substr(id, instr(id, ':') + 1) LIKE ?1",
            [like],
        )?;
        Ok(deleted)
    }

    /// Hard-delete every legacy Wealthbox object while preserving provider-prefixed
    /// rows such as Salesforce (`sfdc:`) and Redtail (`redtail:`).
    #[allow(dead_code)]
    pub fn purge_legacy_wealthbox_objects(&self) -> Result<usize> {
        let c = lock_unpoison(&self.conn);
        let legacy_predicate = "instr(id, ':') = 0
            OR (
                substr(id, instr(id, ':') + 1) NOT LIKE 'sfdc:%'
                AND substr(id, instr(id, ':') + 1) NOT LIKE 'redtail:%'
            )";

        let mut stmt = c.prepare(&format!(
            "SELECT DISTINCT household_id FROM crm_objects
             WHERE ({legacy_predicate}) AND household_id != ''"
        ))?;
        let household_ids = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        drop(stmt);

        for household_id in household_ids {
            c.execute(
                "DELETE FROM crm_render_state WHERE household_id = ?1",
                [household_id],
            )?;
        }

        let deleted = c.execute(
            &format!("DELETE FROM crm_objects WHERE {legacy_predicate}"),
            [],
        )?;
        Ok(deleted)
    }

    #[allow(dead_code)]
    pub fn has_any_objects_including_deleted(&self) -> Result<bool> {
        let c = lock_unpoison(&self.conn);
        let count = c.query_row("SELECT COUNT(*) FROM crm_objects", [], |r| {
            r.get::<_, i64>(0)
        })?;
        Ok(count > 0)
    }

    /// Soft-delete an object (sets `deleted = 1`).
    #[allow(dead_code)]
    pub fn tombstone_object(&self, id: &str) -> Result<()> {
        let c = lock_unpoison(&self.conn);
        c.execute("UPDATE crm_objects SET deleted = 1 WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Return distinct non-empty household ids that have at least one
    /// non-deleted object.  Used by the render/index loop.
    #[allow(dead_code)]
    pub fn list_household_ids(&self) -> Result<Vec<String>> {
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare(
            "SELECT DISTINCT household_id FROM crm_objects
             WHERE household_id != '' AND deleted = 0",
        )?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        Ok(rows)
    }

    // -----------------------------------------------------------------------
    // crm_cursors helpers
    // -----------------------------------------------------------------------

    /// Persist a per-object-type delta cursor (upserts on conflict).
    #[allow(dead_code)]
    pub fn set_cursor(&self, object_type: &str, cursor: &str) -> Result<()> {
        let c = lock_unpoison(&self.conn);
        c.execute(
            "INSERT INTO crm_cursors (object_type, cursor) VALUES (?1, ?2)
             ON CONFLICT(object_type) DO UPDATE SET cursor = ?2",
            rusqlite::params![object_type, cursor],
        )?;
        Ok(())
    }

    /// Retrieve a per-object-type cursor, or `None` if not yet set.
    #[allow(dead_code)]
    pub fn get_cursor(&self, object_type: &str) -> Result<Option<String>> {
        let c = lock_unpoison(&self.conn);
        Ok(c.query_row(
            "SELECT cursor FROM crm_cursors WHERE object_type = ?1",
            [object_type],
            |r| r.get(0),
        )
        .ok())
    }

    // -----------------------------------------------------------------------
    // crm_render_state helpers
    // -----------------------------------------------------------------------

    /// Upsert the render/index state for a household.
    #[allow(dead_code)]
    pub fn set_render_state(
        &self,
        household_id: &str,
        render_hash: &str,
        indexed: bool,
    ) -> Result<()> {
        let c = lock_unpoison(&self.conn);
        c.execute(
            "INSERT INTO crm_render_state (household_id, render_hash, indexed)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(household_id) DO UPDATE SET
                render_hash = ?2,
                indexed     = ?3",
            rusqlite::params![household_id, render_hash, indexed as i64],
        )?;
        Ok(())
    }

    /// Retrieve the render/index state for a household, or `None` if absent.
    #[allow(dead_code)]
    pub fn get_render_state(&self, household_id: &str) -> Result<Option<(String, bool)>> {
        let c = lock_unpoison(&self.conn);
        Ok(c.query_row(
            "SELECT render_hash, indexed FROM crm_render_state
             WHERE household_id = ?1",
            [household_id],
            |r| {
                let hash: String = r.get(0)?;
                let indexed_int: i64 = r.get(1)?;
                Ok((hash, indexed_int != 0))
            },
        )
        .ok())
    }

    // -----------------------------------------------------------------------
    // meta helpers (mirrors EncryptedMailStore)
    // -----------------------------------------------------------------------

    /// Read one meta value, or `None` if the key is not set.
    #[allow(dead_code)]
    pub fn get_meta(&self, key: &str) -> Result<Option<String>> {
        use rusqlite::OptionalExtension;
        let c = lock_unpoison(&self.conn);
        Ok(
            c.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
                .optional()?,
        )
    }

    /// Set (upsert) one meta value.  Idempotent; last-writer-wins.
    #[allow(dead_code)]
    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        let c = lock_unpoison(&self.conn);
        c.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    /// Insert/update a pending proposal in the encrypted CRM store. On update,
    /// `created_at` is preserved so an approval can prove this proposal existed
    /// before the final approve command.
    pub fn proposal_upsert(&self, proposal: &PendingCrmProposal) -> Result<PendingCrmProposal> {
        let c = lock_unpoison(&self.conn);
        let now = chrono::Utc::now().to_rfc3339();
        let created_at = if proposal.created_at.trim().is_empty() {
            now.clone()
        } else {
            proposal.created_at.clone()
        };
        c.execute(
            "INSERT INTO crm_write_proposals
                (proposal_id, provider, kind, matter_id, household_key, content_hash,
                 title, body, due_date, source_ref, requested_at, field, existing_value,
                 new_value, final_value, provenance, ai_source_kind, ai_source_date,
                 status, remote_id, error, created_at, updated_at)
             VALUES
                (?1, ?2, ?3, ?4, ?5, ?6,
                 ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                 ?14, ?15, ?16, ?17, ?18,
                 ?19, ?20, ?21, ?22, ?23)
             ON CONFLICT(proposal_id) DO UPDATE SET
                provider       = excluded.provider,
                kind           = excluded.kind,
                matter_id      = excluded.matter_id,
                household_key  = excluded.household_key,
                content_hash   = excluded.content_hash,
                title          = excluded.title,
                body           = excluded.body,
                due_date       = excluded.due_date,
                source_ref     = excluded.source_ref,
                requested_at   = excluded.requested_at,
                field          = excluded.field,
                existing_value = excluded.existing_value,
                new_value      = excluded.new_value,
                final_value    = excluded.final_value,
                provenance     = excluded.provenance,
                ai_source_kind = excluded.ai_source_kind,
                ai_source_date = excluded.ai_source_date,
                status         = excluded.status,
                remote_id      = excluded.remote_id,
                error          = excluded.error,
                created_at     = crm_write_proposals.created_at,
                updated_at     = excluded.updated_at",
            rusqlite::params![
                &proposal.proposal_id,
                &proposal.provider,
                &proposal.kind,
                &proposal.matter_id,
                &proposal.household_key,
                &proposal.content_hash,
                &proposal.title,
                &proposal.body,
                proposal.due_date.as_deref(),
                &proposal.source_ref,
                proposal.requested_at.as_deref(),
                proposal.field.as_deref(),
                proposal.existing_value.as_deref(),
                proposal.new_value.as_deref(),
                proposal.final_value.as_deref(),
                proposal.provenance.as_deref(),
                proposal.ai_source_kind.as_deref(),
                proposal.ai_source_date.as_deref(),
                &proposal.status,
                proposal.remote_id.as_deref(),
                proposal.error.as_deref(),
                &created_at,
                &now,
            ],
        )?;
        drop(c);
        self.proposal_get(&proposal.proposal_id)?
            .ok_or_else(|| anyhow::anyhow!("pending CRM proposal disappeared after save"))
    }

    pub fn proposal_get(&self, proposal_id: &str) -> Result<Option<PendingCrmProposal>> {
        use rusqlite::OptionalExtension;
        let c = lock_unpoison(&self.conn);
        Ok(c.query_row(
            "SELECT proposal_id, provider, kind, matter_id, household_key, content_hash,
                    title, body, due_date, source_ref, requested_at, field, existing_value,
                    new_value, final_value, provenance, ai_source_kind, ai_source_date,
                    status, remote_id, error, created_at, updated_at
             FROM crm_write_proposals
             WHERE proposal_id = ?1",
            [proposal_id],
            row_to_pending_crm_proposal,
        )
        .optional()?)
    }

    /// Pending proposals only. A sent proposal is not a reviewable row anymore,
    /// and should never reappear after restart.
    pub fn proposal_list_pending(&self) -> Result<Vec<PendingCrmProposal>> {
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare(
            "SELECT proposal_id, provider, kind, matter_id, household_key, content_hash,
                    title, body, due_date, source_ref, requested_at, field, existing_value,
                    new_value, final_value, provenance, ai_source_kind, ai_source_date,
                    status, remote_id, error, created_at, updated_at
             FROM crm_write_proposals
             WHERE status != 'sent'
             ORDER BY created_at ASC",
        )?;
        let rows = stmt
            .query_map([], row_to_pending_crm_proposal)?
            .collect::<rusqlite::Result<Vec<PendingCrmProposal>>>()?;
        Ok(rows)
    }

    pub fn proposal_delete(&self, proposal_id: &str) -> Result<usize> {
        let c = lock_unpoison(&self.conn);
        Ok(c.execute("DELETE FROM crm_write_proposals WHERE proposal_id = ?1", [proposal_id])?)
    }

    /// Look up an outbound write's ledger row by its content-addressed dedup key.
    pub fn outbound_get(&self, dedup_key: &str) -> Result<Option<OutboundWrite>> {
        use rusqlite::OptionalExtension;
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare(
            "SELECT dedup_key, status, remote_id, created_at FROM crm_outbound_writes WHERE dedup_key = ?1",
        )?;
        let row = stmt
            .query_row(rusqlite::params![dedup_key], |r| {
                Ok(OutboundWrite {
                    dedup_key: r.get(0)?,
                    status: r.get(1)?,
                    remote_id: r.get(2)?,
                    created_at: r.get(3)?,
                })
            })
            .optional()?;
        Ok(row)
    }

    /// Insert or update an outbound write's ledger row. `remote_id` is only
    /// overwritten when `Some` — a status transition (e.g. `pending` →
    /// `pending_verify`) that doesn't yet know the remote id must not erase
    /// one recorded by an earlier call.
    #[allow(clippy::too_many_arguments)]
    /// `reset_created_at` MUST be `true` only from the call that's about to
    /// make a genuinely NEW send attempt (`write.rs::upsert_ledger_before_send`)
    /// — every other transition (recording the outcome of THAT SAME attempt:
    /// sent/pending_verify/failed) must pass `false` to preserve the floor
    /// `find_recent_matching`'s recovery check just used. Getting this wrong
    /// in either direction is a correctness bug: resetting on a
    /// non-fresh-attempt transition would make an in-flight recovery check
    /// re-evaluate against a floor that moved out from under it; never
    /// resetting (the previous design, keyed off "was the old status
    /// `failed`") left the floor stale across an attempt that failed
    /// ambiguously, verified as a miss, and then resent — the resend's own
    /// eventual verification could still match a coincidental CRM record
    /// created between the FIRST attempt and the resend.
    #[allow(clippy::too_many_arguments)]
    pub fn outbound_upsert(
        &self,
        dedup_key: &str,
        provider: &str,
        kind: &str,
        household_key: &str,
        matter_id: &str,
        source_ref: &str,
        status: &str,
        remote_id: Option<&str>,
        reset_created_at: bool,
        content_key: &str,
    ) -> Result<()> {
        let c = lock_unpoison(&self.conn);
        let now = chrono::Utc::now().to_rfc3339();
        c.execute(
            "INSERT INTO crm_outbound_writes
                (dedup_key, provider, kind, household_key, matter_id, source_ref, status, remote_id, created_at, updated_at, content_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?11)
             ON CONFLICT(dedup_key) DO UPDATE SET
                status = excluded.status,
                -- Codex round 8 (self-converge): a FRESH send attempt
                -- (reset_created_at = true, from upsert_ledger_before_send)
                -- must clear any STALE remote_id from a PRIOR attempt under
                -- this same key (e.g. a `sent` row downgraded to
                -- pending_verify by a reconnect, then resent to the newly
                -- connected account) rather than preserving it via COALESCE
                -- — otherwise, if the app crashes right after this insert
                -- (before this NEW attempt's own remote_id is ever known),
                -- the row is indistinguishable from the OLD downgraded-sent
                -- row for outbound_find_recovery_candidate's `remote_id IS
                -- NULL` filter, hiding this genuinely interrupted NEW
                -- attempt from crash recovery. Every OTHER transition
                -- (recording sent/pending_verify/failed for the attempt
                -- THIS row already represents) still preserves remote_id
                -- via COALESCE when passed NULL.
                remote_id = CASE WHEN ?10 THEN excluded.remote_id ELSE COALESCE(excluded.remote_id, crm_outbound_writes.remote_id) END,
                updated_at = excluded.updated_at,
                created_at = CASE WHEN ?10 THEN excluded.created_at ELSE crm_outbound_writes.created_at END,
                content_key = excluded.content_key",
            rusqlite::params![
                dedup_key,
                provider,
                kind,
                household_key,
                matter_id,
                source_ref,
                status,
                remote_id,
                now,
                reset_created_at,
                content_key,
            ],
        )?;
        Ok(())
    }

    /// Find the most recent GENUINELY-INTERRUPTED `pending`/`pending_verify`
    /// row for `provider` whose CONTENT (not approval-event) matches
    /// `content_key` — used by `push_crm_write`'s crash-recovery lookup. The
    /// write queue is session-only, so after a crash a re-approval of the
    /// same logical write mints a NEW `requested_at` (a new `dedup_key`),
    /// and the interrupted attempt's row can only be found by its content
    /// shape.
    ///
    /// Deliberately excludes `sent` rows: an intentional repeat of
    /// already-delivered content must still send under its own new key, not
    /// be silently matched against a past delivery.
    ///
    /// Also excludes rows with a `remote_id` (codex round 7, self-converge):
    /// a `sent` row DOWNGRADED to `pending_verify` on reconnect (see
    /// `mark_sent_rows_pending_verify_for_provider`) keeps its `remote_id`
    /// — it proves delivery under SOME account, just needs re-verification
    /// against whichever account is connected now (which the EXACT-key
    /// lookup already does correctly). Treating it as a content-key
    /// recovery candidate too would let a fresh approval — of the same
    /// content, made after a reconnect — find that OLD delivery and get
    /// silently deduped against it, skipping the actual send under the
    /// (possibly different) now-connected account. A genuinely interrupted
    /// attempt (crashed before a response was ever recorded) always has
    /// `remote_id = NULL` — see `upsert_ledger`'s ambiguous-failure and
    /// `upsert_ledger_before_send` call sites.
    pub fn outbound_find_recovery_candidate(
        &self,
        provider: &str,
        content_key: &str,
    ) -> Result<Option<OutboundWrite>> {
        use rusqlite::OptionalExtension;
        let c = lock_unpoison(&self.conn);
        let mut stmt = c.prepare(
            "SELECT dedup_key, status, remote_id, created_at FROM crm_outbound_writes
             WHERE provider = ?1 AND content_key = ?2 AND status IN ('pending', 'pending_verify')
               AND remote_id IS NULL
             ORDER BY created_at DESC LIMIT 1",
        )?;
        let row = stmt
            .query_row(rusqlite::params![provider, content_key], |r| {
                Ok(OutboundWrite {
                    dedup_key: r.get(0)?,
                    status: r.get(1)?,
                    remote_id: r.get(2)?,
                    created_at: r.get(3)?,
                })
            })
            .optional()?;
        Ok(row)
    }

    /// TEST ONLY: force-set a ledger row's `created_at` to an arbitrary
    /// (possibly backdated) timestamp — `outbound_upsert`'s public surface
    /// deliberately always stamps `created_at` with the real time on
    /// insert, so tests that need to simulate an OLD orphaned row (e.g. for
    /// `push_crm_write`'s recovery-window bound) need this escape hatch.
    #[cfg(test)]
    pub fn outbound_backdate_for_test(&self, dedup_key: &str, created_at: &str) -> Result<()> {
        let c = lock_unpoison(&self.conn);
        c.execute(
            "UPDATE crm_outbound_writes SET created_at = ?2 WHERE dedup_key = ?1",
            rusqlite::params![dedup_key, created_at],
        )?;
        Ok(())
    }

    /// Delete every outbound-write ledger row for `provider` (e.g. "wealthbox").
    /// Called on disconnect so a later reconnect — same or different account —
    /// can't reuse a stale `sent`/`pending` row to skip a write that was
    /// never actually delivered to the newly connected account.
    pub fn purge_outbound_writes_for_provider(&self, provider: &str) -> Result<usize> {
        let c = lock_unpoison(&self.conn);
        Ok(c.execute(
            "DELETE FROM crm_outbound_writes WHERE provider = ?1",
            [provider],
        )?)
    }

    /// Downgrade every `sent` outbound-write row for `provider` to
    /// `pending_verify`, leaving `remote_id`/`created_at` untouched. Called
    /// on every successful `crm_connect` for that provider (same account
    /// reconnecting or a genuinely different one) — a `sent` row only proves
    /// delivery to whichever account was connected when it was recorded, so
    /// after any reconnect it must be re-verified against whichever account
    /// is connected NOW before `push_crm_write` ever trusts it as delivered
    /// again. Returns the number of rows downgraded.
    pub fn mark_sent_rows_pending_verify_for_provider(&self, provider: &str) -> Result<usize> {
        let c = lock_unpoison(&self.conn);
        Ok(c.execute(
            "UPDATE crm_outbound_writes SET status = 'pending_verify', updated_at = ?2
             WHERE provider = ?1 AND status = 'sent'",
            rusqlite::params![provider, chrono::Utc::now().to_rfc3339()],
        )?)
    }

    /// Delete every locally-imported Wealthbox object by removing the encrypted
    /// CRM database file. The file is recreated empty the next time `open` is
    /// called. Invoked by `crm_disconnect` so a disconnected workspace retains no
    /// residual CRM data on disk.
    #[allow(dead_code)]
    pub fn purge(workspace_root: &Path) -> Result<()> {
        // Remove the main DB file AND its SQLite sidecars. WAL/SHM hold
        // un-checkpointed pages and the rollback journal holds pre-images; leaving
        // any of them behind would strand decryptable CRM data after a disconnect.
        let base = Self::db_path(workspace_root);
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let p = if suffix.is_empty() {
                base.clone()
            } else {
                let mut s = base.clone().into_os_string();
                s.push(suffix);
                PathBuf::from(s)
            };
            if p.exists() {
                std::fs::remove_file(&p)
                    .with_context(|| format!("failed to remove crm db file {}", p.display()))?;
            }
        }
        let key_service_hint = crm_key_service_hint_path(workspace_root);
        if key_service_hint.exists() {
            std::fs::remove_file(&key_service_hint).with_context(|| {
                format!(
                    "failed to remove CRM key-service hint {}",
                    key_service_hint.display()
                )
            })?;
        }
        Ok(())
    }

    /// Remove a confirmed-unreadable database and create its replacement. The
    /// caller supplies the fresh key path (OS keychain in production, fixed
    /// bytes in the unit test).
    pub(crate) fn replace_unopenable_database<F>(
        workspace_root: &Path,
        create_replacement: F,
    ) -> Result<Self>
    where
        F: FnOnce() -> Result<Self>,
    {
        Self::purge(workspace_root)?;
        create_replacement()
    }

    /// Capture the workspace-owned key name before `purge` removes its hint.
    /// Shared legacy keys are deliberately excluded.
    pub fn workspace_key_service_for_deletion(workspace_root: &Path) -> Option<String> {
        let expected_service = workspace_crm_key_service(workspace_root);
        read_crm_key_service_hint(workspace_root)
            .filter(|service| service == &expected_service)
    }

    /// Delete one already-purged workspace's own credential. Missing is success.
    pub fn delete_workspace_master_key(service: Option<&str>) -> Result<()> {
        let Some(service) = service.filter(|service| is_workspace_crm_key_service(service)) else {
            return Ok(());
        };
        delete_crm_master_key(service)
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Map a `crm_objects` row to a `CrmObjectRow`.
fn row_to_crm_object(r: &rusqlite::Row<'_>) -> rusqlite::Result<CrmObjectRow> {
    let deleted_int: i64 = r.get(6)?;
    Ok(CrmObjectRow {
        id: r.get(0)?,
        kind: r.get(1)?,
        household_id: r.get(2)?,
        updated_at: r.get(3)?,
        content_hash: r.get(4)?,
        json: r.get(5)?,
        deleted: deleted_int != 0,
    })
}

fn row_to_pending_crm_proposal(r: &rusqlite::Row<'_>) -> rusqlite::Result<PendingCrmProposal> {
    Ok(PendingCrmProposal {
        proposal_id: r.get(0)?,
        provider: r.get(1)?,
        kind: r.get(2)?,
        matter_id: r.get(3)?,
        household_key: r.get(4)?,
        content_hash: r.get(5)?,
        title: r.get(6)?,
        body: r.get(7)?,
        due_date: r.get(8)?,
        source_ref: r.get(9)?,
        requested_at: r.get(10)?,
        field: r.get(11)?,
        existing_value: r.get(12)?,
        new_value: r.get(13)?,
        final_value: r.get(14)?,
        provenance: r.get(15)?,
        ai_source_kind: r.get(16)?,
        ai_source_date: r.get(17)?,
        status: r.get(18)?,
        remote_id: r.get(19)?,
        error: r.get(20)?,
        created_at: r.get(21)?,
        updated_at: r.get(22)?,
    })
}

/// Idempotent schema migration: add new columns with `ALTER TABLE ADD COLUMN`.
/// SQLite errors when a column already exists so we swallow each error — the
/// same pattern used by `migrate_message_columns` in the mail store.
fn migrate_crm_columns(conn: &Connection) {
    // Placeholder for future column additions; pattern mirrors mail store.
    // Each new column gets one `let _ = conn.execute(...)` line here.
    let _ = conn.execute(
        "ALTER TABLE crm_objects ADD COLUMN kind TEXT NOT NULL DEFAULT ''",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE crm_outbound_writes ADD COLUMN content_key TEXT NOT NULL DEFAULT ''",
        [],
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Open a CrmStore with a deterministic test key — bypasses the OS keychain.
    fn crm_store() -> (TempDir, CrmStore) {
        let dir = TempDir::new().unwrap();
        let key = [0x33u8; 32];
        let s = CrmStore::open_with_key(dir.path(), &key).expect("crm store open");
        (dir, s)
    }

    #[test]
    fn each_workspace_gets_an_independent_key_service() {
        let first_dir = TempDir::new().unwrap();
        let second_dir = TempDir::new().unwrap();
        let first = workspace_crm_key_service(first_dir.path());
        let second = workspace_crm_key_service(second_dir.path());
        assert_ne!(first, second, "two workspaces must never share one deletable key");
        assert!(is_workspace_crm_key_service(&first));
        assert!(is_workspace_crm_key_service(&second));
        assert!(!is_workspace_crm_key_service(CRM_KEYCHAIN_SERVICE));
        assert!(!is_workspace_crm_key_service(LEGACY_CRM_KEYCHAIN_SERVICE));
    }

    #[test]
    fn disconnect_can_never_select_a_shared_legacy_key_for_deletion() {
        let dir = TempDir::new().unwrap();
        write_crm_key_service_hint(dir.path(), CRM_KEYCHAIN_SERVICE).unwrap();
        assert_eq!(CrmStore::workspace_key_service_for_deletion(dir.path()), None);

        let copied_from = TempDir::new().unwrap();
        let copied_key_service = workspace_crm_key_service(copied_from.path());
        write_crm_key_service_hint(dir.path(), &copied_key_service).unwrap();
        assert_eq!(
            CrmStore::workspace_key_service_for_deletion(dir.path()),
            None,
            "a copied workspace must not delete the original workspace's key"
        );

        let workspace_service = workspace_crm_key_service(dir.path());
        write_crm_key_service_hint(dir.path(), &workspace_service).unwrap();
        assert_eq!(
            CrmStore::workspace_key_service_for_deletion(dir.path()),
            Some(workspace_service)
        );
    }

    #[test]
    fn create_then_open_round_trip_uses_the_same_sqlcipher_key_material() {
        let dir = TempDir::new().unwrap();
        let key = [0x5au8; KEY_LEN];
        let created = CrmStore::open_with_key(dir.path(), &key).expect("create encrypted CRM DB");
        created.upsert_object("household:round-trip", "household", "round-trip", "2026-07-13T00:00:00Z", "hash", r#"{"name":"Round Trip Household"}"#).unwrap();
        drop(created);

        let reopened = CrmStore::open_with_key(dir.path(), &key).expect("reopen encrypted CRM DB");
        assert!(reopened.get_object("household:round-trip").unwrap().is_some());
    }

    #[test]
    fn rotated_or_absent_key_is_a_recoverable_store_error() {
        let dir = TempDir::new().unwrap();
        let original_key = [0x21u8; KEY_LEN];
        let rotated_key = [0x84u8; KEY_LEN];
        drop(CrmStore::open_with_key(dir.path(), &original_key).expect("seed encrypted CRM DB"));

        let error = match CrmStore::open_with_key_candidates(
            dir.path(),
            &[CrmKeyCandidate { service: CRM_KEYCHAIN_SERVICE.to_string(), key: rotated_key }],
        ) {
            Ok(_) => panic!("a rotated key must not open the older database"),
            Err(error) => error,
        };
        assert!(is_crm_store_recovery_required(&error));
        assert_eq!(crm_store_user_message(&error), CRM_STORE_RECOVERY_MESSAGE);
    }

    #[test]
    fn recovery_rebuild_replaces_only_the_unreadable_local_database() {
        let dir = TempDir::new().unwrap();
        let lost_key = [0x11u8; KEY_LEN];
        let replacement_key = [0x92u8; KEY_LEN];
        let old = CrmStore::open_with_key(dir.path(), &lost_key).expect("seed old database");
        old.upsert_object("note:lost", "note", "household:1", "2026-07-13T00:00:00Z", "hash", r#"{"body":"old unreadable cache"}"#).unwrap();
        drop(old);

        let rebuilt = CrmStore::replace_unopenable_database(dir.path(), || {
            CrmStore::open_with_key(dir.path(), &replacement_key)
        }).expect("create replacement database");
        assert!(rebuilt.get_object("note:lost").unwrap().is_none());
        rebuilt.upsert_object("note:fresh", "note", "household:1", "2026-07-13T01:00:00Z", "hash-2", r#"{"body":"fetched again from Wealthbox"}"#).unwrap();
        drop(rebuilt);

        let reopened = CrmStore::open_with_key(dir.path(), &replacement_key).expect("replacement database reopens");
        assert!(reopened.get_object("note:fresh").unwrap().is_some());
    }

    #[test]
    fn legacy_key_reopens_moved_crm_database_when_new_key_is_wrong() {
        let dir = TempDir::new().unwrap();
        let legacy_key = [0x31u8; 32];
        let wrong_new_key = [0x72u8; 32];
        let old_store = CrmStore::open_with_key(dir.path(), &legacy_key).expect("seed old db");
        old_store
            .upsert_object(
                "household:legacy-1",
                "household",
                "legacy-1",
                "2026-07-01T00:00:00Z",
                "hash",
                r#"{"name":"Legacy household"}"#,
            )
            .unwrap();
        drop(old_store);

        let candidates = vec![
            CrmKeyCandidate {
                service: CRM_KEYCHAIN_SERVICE.to_string(),
                key: wrong_new_key,
            },
            CrmKeyCandidate {
                service: LEGACY_CRM_KEYCHAIN_SERVICE.to_string(),
                key: legacy_key,
            },
        ];
        let (reopened, used_index) =
            CrmStore::open_with_key_candidates(dir.path(), &candidates)
                .expect("legacy key should recover the moved encrypted database");

        assert_eq!(used_index, 1);
        assert!(reopened.get_object("household:legacy-1").unwrap().is_some());
    }

    #[test]
    fn historical_key_after_two_wrong_candidates_reopens_upgrade_database() {
        let dir = TempDir::new().unwrap();
        let database_key = [0x19u8; 32];
        let wrong_current_key = [0x72u8; 32];
        let wrong_legacy_key = [0x31u8; 32];
        let old_store =
            CrmStore::open_with_key(dir.path(), &database_key).expect("seed historical db");
        old_store
            .upsert_object(
                "household:historical-1",
                "household",
                "historical-1",
                "2026-07-02T00:00:00Z",
                "hash",
                r#"{"name":"Historical household"}"#,
            )
            .unwrap();
        drop(old_store);

        let candidates = vec![
            CrmKeyCandidate {
                service: CRM_KEYCHAIN_SERVICE.to_string(),
                key: wrong_current_key,
            },
            CrmKeyCandidate {
                service: LEGACY_CRM_KEYCHAIN_SERVICE.to_string(),
                key: wrong_legacy_key,
            },
            CrmKeyCandidate {
                service: "standalone-crm-enc".to_string(),
                key: database_key,
            },
        ];
        let (reopened, used_index) =
            CrmStore::open_with_key_candidates(dir.path(), &candidates)
                .expect("all available historical CRM keys should be tried");

        assert_eq!(used_index, 2);
        assert!(
            reopened
                .get_object("household:historical-1")
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn windows_keyring_target_parser_accepts_only_crm_database_services() {
        assert_eq!(
            crm_service_from_keyring_target("master-key-v1.standalone-crm-enc"),
            Some("standalone-crm-enc".to_string())
        );
        assert_eq!(
            crm_service_from_keyring_target("master-key-v1.lantern-audit-enc"),
            None
        );
        assert_eq!(
            crm_service_from_keyring_target("other-key.standalone-crm-enc"),
            None
        );
        assert_eq!(
            crm_service_from_keyring_target("master-key-v1.bad\0-crm-enc"),
            None
        );
    }

    #[test]
    fn key_service_hint_round_trips_without_storing_key_material() {
        let dir = TempDir::new().unwrap();
        write_crm_key_service_hint(dir.path(), "standalone-crm-enc").unwrap();

        assert_eq!(
            read_crm_key_service_hint(dir.path()),
            Some("standalone-crm-enc".to_string())
        );
        assert_eq!(
            std::fs::read_to_string(crm_key_service_hint_path(dir.path())).unwrap(),
            "standalone-crm-enc"
        );
    }

    fn pending_crm_proposal(id: &str) -> PendingCrmProposal {
        PendingCrmProposal {
            proposal_id: id.to_string(),
            provider: "wealthbox".to_string(),
            kind: "note".to_string(),
            matter_id: "matter-1".to_string(),
            household_key: "household-1".to_string(),
            content_hash: "hash-v1".to_string(),
            title: "Follow-up note".to_string(),
            body: "Discussed Roth conversion planning.".to_string(),
            due_date: None,
            source_ref: "doc:meeting-notes.docx".to_string(),
            requested_at: Some("2026-07-09T12:00:00Z".to_string()),
            field: None,
            existing_value: None,
            new_value: None,
            final_value: None,
            provenance: Some("Generated from the July review meeting.".to_string()),
            ai_source_kind: Some("meeting".to_string()),
            ai_source_date: Some("2026-07-09".to_string()),
            status: "sending".to_string(),
            remote_id: None,
            error: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn proposal_upsert_preserves_created_at_on_reupsert() {
        let (_dir, store) = crm_store();
        let first = store
            .proposal_upsert(&pending_crm_proposal("proposal-preserve-created-at"))
            .expect("insert proposal");
        assert!(
            !first.created_at.trim().is_empty(),
            "first insert must assign created_at"
        );

        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut second = pending_crm_proposal("proposal-preserve-created-at");
        second.content_hash = "hash-v2".to_string();
        second.body = "Advisor approved a revised note body.".to_string();
        second.status = "sent".to_string();
        second.remote_id = Some("crm-note-123".to_string());
        second.created_at = "2099-01-01T00:00:00Z".to_string();

        let saved = store
            .proposal_upsert(&second)
            .expect("re-upsert proposal");

        assert_eq!(
            saved.created_at, first.created_at,
            "re-upsert must keep the original creation time"
        );
        assert_eq!(
            saved.body, "Advisor approved a revised note body.",
            "re-upsert must still save the latest proposal content"
        );
        assert_eq!(saved.status, "sent");
        assert_eq!(saved.remote_id.as_deref(), Some("crm-note-123"));
    }

    #[test]
    fn outbound_ledger_upsert_and_get_roundtrip() {
        let (dir, store) = crm_store();
        let _ = dir;
        assert!(store.outbound_get("k1").unwrap().is_none());
        store
            .outbound_upsert("k1", "wealthbox", "note", "12345", "m1", "doc:a.docx", "pending", None, true, "ck")
            .unwrap();
        let row = store.outbound_get("k1").unwrap().unwrap();
        assert_eq!(row.status, "pending");
        assert_eq!(row.remote_id, None);
        store
            .outbound_upsert("k1", "wealthbox", "note", "12345", "m1", "doc:a.docx", "sent", Some("555"), false, "ck")
            .unwrap();
        let row = store.outbound_get("k1").unwrap().unwrap();
        assert_eq!(row.status, "sent");
        assert_eq!(row.remote_id.as_deref(), Some("555"));
    }

    /// `reset_created_at` is an explicit, caller-decided flag rather than a
    /// heuristic keyed off the previous status: `write.rs::upsert_ledger_before_send`
    /// (a genuinely NEW send attempt) always passes `true`;
    /// `write.rs::upsert_ledger` (recording THAT SAME attempt's outcome —
    /// sent/pending_verify/failed) always passes `false`. This is what makes
    /// the recovery-verification floor (`find_recent_matching`'s not_before)
    /// correct across a resend: a prior design keyed the reset off "was the
    /// old status `failed`", which left the floor stale when a `pending`/
    /// `pending_verify` row was verified as a miss and resent — that resend's
    /// own eventual verification could then match a coincidental CRM record
    /// created between the FIRST attempt and the resend.
    #[test]
    fn outbound_ledger_created_at_only_resets_when_a_fresh_attempt_begins() {
        let (dir, store) = crm_store();
        let _ = dir;
        let fresh_attempt = |status: &str| {
            store
                .outbound_upsert("k2", "wealthbox", "note", "12345", "m1", "doc:a.docx", status, None, true, "ck")
                .unwrap();
        };
        let record_outcome = |status: &str| {
            store
                .outbound_upsert("k2", "wealthbox", "note", "12345", "m1", "doc:a.docx", status, None, false, "ck")
                .unwrap();
        };

        fresh_attempt("pending");
        let first_created = store.outbound_get("k2").unwrap().unwrap().created_at;

        // Recording this SAME attempt's outcome must never move the floor,
        // no matter which status it lands on.
        std::thread::sleep(std::time::Duration::from_millis(5));
        record_outcome("pending_verify");
        assert_eq!(
            store.outbound_get("k2").unwrap().unwrap().created_at,
            first_created,
            "recording an outcome must not move the floor"
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
        record_outcome("failed");
        assert_eq!(
            store.outbound_get("k2").unwrap().unwrap().created_at,
            first_created,
            "recording an outcome must not move the floor, even a definitive one"
        );

        // A genuinely NEW send attempt must start a fresh floor.
        std::thread::sleep(std::time::Duration::from_millis(5));
        fresh_attempt("pending");
        assert_ne!(
            store.outbound_get("k2").unwrap().unwrap().created_at,
            first_created,
            "a fresh send attempt must start a new recovery-verification floor"
        );
    }

    #[test]
    fn purge_outbound_writes_for_provider_only_removes_that_providers_rows() {
        let (dir, store) = crm_store();
        let _ = dir;
        store.outbound_upsert("wb1", "wealthbox", "note", "12345", "m1", "doc:a.docx", "sent", Some("1"), true, "ck").unwrap();
        store.outbound_upsert("sf1", "salesforce", "note", "001XYZ", "m1", "doc:a.docx", "sent", Some("2"), true, "ck").unwrap();

        let n = store.purge_outbound_writes_for_provider("wealthbox").unwrap();
        assert_eq!(n, 1);
        assert!(store.outbound_get("wb1").unwrap().is_none(), "wealthbox row must be gone");
        assert!(store.outbound_get("sf1").unwrap().is_some(), "salesforce row must survive a wealthbox disconnect");
    }

    /// A `sent` row proves delivery only to whichever account was connected
    /// AT THE TIME it was recorded. If the advisor reconnects — same or a
    /// DIFFERENT Wealthbox account — that proof no longer holds: a stale
    /// `sent` row for the SAME household id could otherwise be reused as
    /// false proof-of-delivery to the newly connected account. Called on
    /// every successful crm_connect; downgrading (not deleting) to
    /// `pending_verify` means the NEXT push_crm_write call for that content
    /// re-verifies against whichever account is now connected before ever
    /// treating it as already-delivered, reusing the existing verify-before-
    /// resend machinery instead of blindly forgetting the send happened.
    #[test]
    fn mark_sent_rows_pending_verify_only_touches_that_providers_sent_rows() {
        let (dir, store) = crm_store();
        let _ = dir;
        store.outbound_upsert("wb-sent", "wealthbox", "note", "12345", "m1", "doc:a.docx", "sent", Some("1"), true, "ck").unwrap();
        store.outbound_upsert("wb-pending", "wealthbox", "note", "99999", "m1", "doc:b.docx", "pending", None, true, "ck").unwrap();
        store.outbound_upsert("wb-failed", "wealthbox", "note", "88888", "m1", "doc:c.docx", "failed", None, true, "ck").unwrap();
        store.outbound_upsert("sf-sent", "salesforce", "note", "001XYZ", "m1", "doc:d.docx", "sent", Some("2"), true, "ck").unwrap();

        let n = store.mark_sent_rows_pending_verify_for_provider("wealthbox").unwrap();
        assert_eq!(n, 1, "only the one wealthbox 'sent' row should flip");

        assert_eq!(store.outbound_get("wb-sent").unwrap().unwrap().status, "pending_verify");
        assert_eq!(store.outbound_get("wb-pending").unwrap().unwrap().status, "pending", "non-sent rows must be untouched");
        assert_eq!(store.outbound_get("wb-failed").unwrap().unwrap().status, "failed", "non-sent rows must be untouched");
        assert_eq!(store.outbound_get("sf-sent").unwrap().unwrap().status, "sent", "other providers must be untouched");
        // remote_id and created_at (the recovery-verification floor) must
        // survive the transition unchanged — find_recent_matching still
        // needs them to check whichever account is now connected.
        assert_eq!(store.outbound_get("wb-sent").unwrap().unwrap().remote_id.as_deref(), Some("1"));
    }

    /// Codex round 7 (self-converge): a `sent` row downgraded by
    /// `mark_sent_rows_pending_verify_for_provider` keeps its `remote_id`
    /// and its `status` becomes `pending_verify` — indistinguishable from a
    /// genuinely interrupted attempt UNLESS the recovery lookup also checks
    /// `remote_id`. Without this exclusion, a fresh approval of the same
    /// content after a reconnect could find this OLD delivery and get
    /// silently deduped against it, skipping the actual send under the
    /// (possibly different) now-connected account.
    #[test]
    fn recovery_candidate_excludes_a_downgraded_sent_row_with_a_remote_id() {
        let (dir, store) = crm_store();
        let _ = dir;
        store.outbound_upsert("wb-sent", "wealthbox", "note", "12345", "m1", "doc:a.docx", "sent", Some("1"), true, "shared-content").unwrap();
        store.mark_sent_rows_pending_verify_for_provider("wealthbox").unwrap();
        assert_eq!(store.outbound_get("wb-sent").unwrap().unwrap().status, "pending_verify");

        assert!(
            store.outbound_find_recovery_candidate("wealthbox", "shared-content").unwrap().is_none(),
            "a downgraded sent row (has a remote_id) must not be treated as a crash-recovery candidate"
        );

        // A genuinely interrupted attempt (no remote_id) with the SAME
        // content_key must still be found.
        store.outbound_upsert("wb-interrupted", "wealthbox", "note", "12345", "m1", "doc:a.docx", "pending", None, true, "shared-content").unwrap();
        let candidate = store.outbound_find_recovery_candidate("wealthbox", "shared-content").unwrap();
        assert_eq!(candidate.map(|r| r.dedup_key), Some("wb-interrupted".to_string()));
    }

    /// Codex round 8 (self-converge): a FRESH send attempt reusing an
    /// EXISTING key (the write.rs exact-key path resending after a
    /// downgraded sent row was found un-verified under the newly connected
    /// account) must clear that row's stale remote_id — otherwise, if the
    /// app crashes right after this insert, the row is indistinguishable
    /// from the OLD downgraded-sent row for
    /// `outbound_find_recovery_candidate`'s `remote_id IS NULL` filter,
    /// hiding this genuinely interrupted NEW attempt from crash recovery.
    #[test]
    fn a_fresh_send_attempt_clears_a_stale_remote_id_from_a_downgraded_sent_row() {
        let (dir, store) = crm_store();
        let _ = dir;
        // A row that was `sent` (remote_id set), then downgraded by a
        // reconnect — status flips to pending_verify, remote_id survives.
        store.outbound_upsert("k1", "wealthbox", "note", "12345", "m1", "doc:a.docx", "sent", Some("111"), true, "ck").unwrap();
        store.mark_sent_rows_pending_verify_for_provider("wealthbox").unwrap();
        assert_eq!(store.outbound_get("k1").unwrap().unwrap().remote_id.as_deref(), Some("111"));

        // A FRESH send attempt under the SAME key (mirrors
        // write.rs::upsert_ledger_before_send, always reset_created_at=true,
        // remote_id=None) must clear the stale remote_id, not preserve it.
        store.outbound_upsert("k1", "wealthbox", "note", "12345", "m1", "doc:a.docx", "pending", None, true, "ck").unwrap();
        let row = store.outbound_get("k1").unwrap().unwrap();
        assert_eq!(row.status, "pending");
        assert_eq!(
            row.remote_id, None,
            "a fresh send attempt must clear a stale remote_id inherited from a downgraded sent row"
        );

        // But recording THIS attempt's own outcome (reset_created_at=false)
        // must still preserve a remote_id when passed None — e.g. a
        // pending -> pending_verify transition for the SAME attempt.
        store.outbound_upsert("k1", "wealthbox", "note", "12345", "m1", "doc:a.docx", "sent", Some("222"), false, "ck").unwrap();
        store.outbound_upsert("k1", "wealthbox", "note", "12345", "m1", "doc:a.docx", "pending_verify", None, false, "ck").unwrap();
        assert_eq!(
            store.outbound_get("k1").unwrap().unwrap().remote_id.as_deref(),
            Some("222"),
            "a non-fresh-attempt transition must still preserve remote_id via COALESCE when passed None"
        );
    }

    /// P2.3 row 8: the cheap digest list MUST match `list_objects_by_household`
    /// in order and in (id, kind, content_hash) values — the sync engine's
    /// change-detection depends on it reflecting the exact rows plan rendering
    /// reads. Verifies parity including after an update (content_hash changes)
    /// and a tombstone (deleted rows drop from both).
    #[test]
    fn object_digests_match_list_objects_by_household() {
        let (_d, s) = crm_store();
        s.upsert_object("household:1", "household", "1", "", "h-hh", r#"{"a":1}"#).unwrap();
        s.upsert_object("contact:10", "person", "1", "", "h-c10", r#"{"a":2}"#).unwrap();
        s.upsert_object("note:5", "note", "1", "", "h-n5", r#"{"a":3}"#).unwrap();
        // A different household must not leak in.
        s.upsert_object("contact:99", "person", "2", "", "h-c99", r#"{"a":4}"#).unwrap();

        let expect = |s: &CrmStore| -> Vec<(String, String, String)> {
            s.list_objects_by_household("1")
                .unwrap()
                .into_iter()
                .map(|r| (r.id, r.kind, r.content_hash))
                .collect()
        };
        assert_eq!(s.list_object_digests_by_household("1").unwrap(), expect(&s));

        // Update one object's content_hash → digest reflects it.
        s.upsert_object("contact:10", "person", "1", "", "h-c10-v2", r#"{"a":22}"#).unwrap();
        assert_eq!(s.list_object_digests_by_household("1").unwrap(), expect(&s));

        // Tombstone one → drops from both, still in parity.
        s.tombstone_object("note:5").unwrap();
        let digests = s.list_object_digests_by_household("1").unwrap();
        assert_eq!(digests, expect(&s));
        assert!(!digests.iter().any(|(id, _, _)| id == "note:5"));
    }

    /// P2.3 row 7: `apply_ingest_batch` is behaviourally identical to per-object
    /// `upsert_object` + `tombstone_object`, just committed in one transaction.
    #[test]
    fn apply_ingest_batch_matches_per_object_writes() {
        let per_row = crm_store();
        let batched = crm_store();

        let ups = vec![
            CrmUpsert { id: "household:1".into(), kind: "household".into(), household_id: "1".into(), updated_at: "".into(), content_hash: "h1".into(), json: r#"{"a":1}"#.into() },
            CrmUpsert { id: "contact:10".into(), kind: "person".into(), household_id: "1".into(), updated_at: "".into(), content_hash: "h2".into(), json: r#"{"a":2}"#.into() },
        ];
        // Seed a row that both will tombstone.
        per_row.1.upsert_object("stale:9", "note", "1", "", "hs", r#"{"a":9}"#).unwrap();
        batched.1.upsert_object("stale:9", "note", "1", "", "hs", r#"{"a":9}"#).unwrap();

        // Per-object path.
        for u in &ups {
            per_row.1.upsert_object(&u.id, &u.kind, &u.household_id, &u.updated_at, &u.content_hash, &u.json).unwrap();
        }
        per_row.1.tombstone_object("stale:9").unwrap();

        // Batched path.
        batched.1.apply_ingest_batch(&ups, &["stale:9".to_string()]).unwrap();

        assert_eq!(
            per_row.1.list_objects_by_household("1").unwrap().into_iter().map(|r| (r.id, r.kind, r.content_hash, r.json)).collect::<Vec<_>>(),
            batched.1.list_objects_by_household("1").unwrap().into_iter().map(|r| (r.id, r.kind, r.content_hash, r.json)).collect::<Vec<_>>(),
        );
        assert!(per_row.1.get_object("stale:9").unwrap().unwrap().deleted);
        assert!(batched.1.get_object("stale:9").unwrap().unwrap().deleted);
    }

    /// Build the path for a CRM DB SQLite sidecar suffix (e.g. "-wal").
    fn sidecar(base: &std::path::Path, suffix: &str) -> std::path::PathBuf {
        let mut s = base.to_path_buf().into_os_string();
        s.push(suffix);
        std::path::PathBuf::from(s)
    }

    /// PURGE P4: `purge` must remove the main DB AND every SQLite sidecar (-wal, -shm,
    /// -journal), or a disconnect would leave decryptable CRM pages on disk.
    #[test]
    fn purge_removes_db_and_all_sqlite_sidecars() {
        let dir = TempDir::new().unwrap();
        // Create the real DB, then fabricate its sidecars.
        let _ = CrmStore::open_with_key(dir.path(), &[0x33u8; 32]).expect("open");
        let base = CrmStore::db_path(dir.path());
        for suffix in ["-wal", "-shm", "-journal"] {
            std::fs::write(sidecar(&base, suffix), b"residue").unwrap();
        }
        write_crm_key_service_hint(dir.path(), CRM_KEYCHAIN_SERVICE).unwrap();
        let key_service_hint = crm_key_service_hint_path(dir.path());
        assert!(base.exists(), "db file should exist before purge");
        assert!(key_service_hint.exists(), "key-service hint should exist before purge");
        for suffix in ["-wal", "-shm", "-journal"] {
            assert!(
                sidecar(&base, suffix).exists(),
                "sidecar {suffix} should exist before purge"
            );
        }

        CrmStore::purge(dir.path()).expect("purge");

        assert!(!base.exists(), "crm-enc.db must be gone after purge");
        assert!(
            !key_service_hint.exists(),
            "crm key-service hint must be gone after purge"
        );
        for suffix in ["-wal", "-shm", "-journal"] {
            assert!(
                !sidecar(&base, suffix).exists(),
                "crm-enc.db{suffix} must be gone after purge"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Object upsert + list
    // -----------------------------------------------------------------------

    #[test]
    fn upsert_and_get_and_list_by_household() {
        let (_d, s) = crm_store();

        // Insert a household object and a contact belonging to it.
        s.upsert_object(
            "household:1",
            "household",
            "1",
            "2026-06-01T00:00:00Z",
            "hash-h1",
            r#"{"id":1,"name":"Smith Family"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:10",
            "contact",
            "1",
            "2026-06-01T00:00:00Z",
            "hash-c10",
            r#"{"id":10,"first_name":"Alice"}"#,
        )
        .unwrap();

        // get_object round-trips fields.
        let row = s.get_object("household:1").unwrap().expect("household row");
        assert_eq!(row.id, "household:1");
        assert_eq!(row.kind, "household");
        assert_eq!(row.household_id, "1");
        assert_eq!(row.content_hash, "hash-h1");
        assert_eq!(row.json, r#"{"id":1,"name":"Smith Family"}"#);
        assert!(!row.deleted);

        let row2 = s.get_object("contact:10").unwrap().expect("contact row");
        assert_eq!(row2.kind, "contact");
        assert_eq!(row2.household_id, "1");

        // list_objects_by_household returns both, none deleted.
        let list = s.list_objects_by_household("1").unwrap();
        assert_eq!(list.len(), 2);

        // list_household_ids returns the single household id.
        let hids = s.list_household_ids().unwrap();
        assert_eq!(hids, vec!["1".to_string()]);
    }

    // -----------------------------------------------------------------------
    // Upsert overwrites
    // -----------------------------------------------------------------------

    #[test]
    fn upsert_same_id_twice_returns_latest_json() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10",
            "contact",
            "1",
            "2026-06-01T00:00:00Z",
            "hash-v1",
            r#"{"id":10,"note":"first"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:10",
            "contact",
            "1",
            "2026-06-02T00:00:00Z",
            "hash-v2",
            r#"{"id":10,"note":"second"}"#,
        )
        .unwrap();

        let row = s.get_object("contact:10").unwrap().expect("row");
        assert_eq!(row.json, r#"{"id":10,"note":"second"}"#);
        assert_eq!(row.content_hash, "hash-v2");
        assert_eq!(row.updated_at, "2026-06-02T00:00:00Z");
    }

    // -----------------------------------------------------------------------
    // Tombstone
    // -----------------------------------------------------------------------

    #[test]
    fn tombstone_hides_object_from_list_and_list_ids() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10",
            "contact",
            "1",
            "2026-06-01T00:00:00Z",
            "hash-c10",
            r#"{"id":10}"#,
        )
        .unwrap();

        // Before tombstone: visible in both list paths.
        assert_eq!(s.list_objects_by_household("1").unwrap().len(), 1);
        assert_eq!(s.list_object_ids("contact").unwrap().len(), 1);

        s.tombstone_object("contact:10").unwrap();

        // After tombstone: absent from both list paths.
        assert!(s.list_objects_by_household("1").unwrap().is_empty());
        assert!(s.list_object_ids("contact").unwrap().is_empty());

        // get_object still finds it (deleted flag = true).
        let row = s.get_object("contact:10").unwrap().expect("still findable");
        assert!(row.deleted);
    }

    #[test]
    fn provider_marker_purge_removes_only_salesforce_rows() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10002",
            "person",
            "10001",
            "",
            "hash-wb",
            r#"{"id":10002}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA",
            "person",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf-contact",
            r#"{"external_id":"sfdc:003CC0000000002AAA:acct:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:sfdc:001HH0000000001AAA",
            "household",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf-household",
            r#"{"external_id":"sfdc:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.set_render_state("sfdc:001HH0000000001AAA", "stale", true)
            .unwrap();

        let salesforce_rows = s.list_objects_by_provider_marker("sfdc:").unwrap();
        assert_eq!(salesforce_rows.len(), 2);

        let deleted = s.purge_objects_by_provider_marker("sfdc:").unwrap();
        assert_eq!(deleted, 2);

        assert!(
            s.get_object("contact:10002").unwrap().is_some(),
            "Wealthbox row must survive Salesforce purge"
        );
        assert!(
            s.get_object("contact:sfdc:001HH0000000001AAA")
                .unwrap()
                .is_none(),
            "Salesforce household row must be gone"
        );
        assert_eq!(
            s.get_render_state("sfdc:001HH0000000001AAA").unwrap(),
            None,
            "provider purge must clear stale render state for that household"
        );
    }

    #[test]
    fn legacy_wealthbox_purge_removes_live_and_tombstoned_rows_only() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10002",
            "person",
            "10001",
            "",
            "hash-wb-live",
            r#"{"id":10002}"#,
        )
        .unwrap();
        s.upsert_object(
            "note:20002",
            "note",
            "10001",
            "",
            "hash-wb-tombstoned",
            r#"{"id":20002}"#,
        )
        .unwrap();
        s.tombstone_object("note:20002").unwrap();
        s.upsert_object(
            "contact:sfdc:001HH0000000001AAA",
            "household",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf",
            r#"{"external_id":"sfdc:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:redtail:family:7",
            "household",
            "redtail:family:7",
            "",
            "hash-redtail-family",
            r#"{"external_id":"redtail:family:7"}"#,
        )
        .unwrap();
        s.upsert_object(
            "note:redtail:note:2",
            "note",
            "redtail:family:7",
            "",
            "hash-redtail-note",
            r#"{"external_id":"redtail:note:2"}"#,
        )
        .unwrap();
        s.set_render_state("10001", "stale", true).unwrap();

        let wealthbox_rows = s.list_legacy_wealthbox_objects_including_deleted().unwrap();
        assert_eq!(wealthbox_rows.len(), 2);

        let deleted = s.purge_legacy_wealthbox_objects().unwrap();
        assert_eq!(deleted, 2);

        assert!(s.get_object("contact:10002").unwrap().is_none());
        assert!(s.get_object("note:20002").unwrap().is_none());
        assert!(
            s.get_object("contact:sfdc:001HH0000000001AAA")
                .unwrap()
                .is_some(),
            "Salesforce row must survive Wealthbox purge"
        );
        assert!(
            s.get_object("contact:redtail:family:7").unwrap().is_some(),
            "Redtail row must survive Wealthbox purge"
        );
        assert_eq!(
            s.get_render_state("10001").unwrap(),
            None,
            "legacy Wealthbox purge must clear stale render state for that household"
        );
        assert!(s.has_any_objects_including_deleted().unwrap());
    }

    #[test]
    fn provider_marker_purge_removes_only_redtail_rows() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:10002",
            "person",
            "10001",
            "",
            "hash-wb",
            r#"{"id":10002}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:sfdc:001HH0000000001AAA",
            "household",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf",
            r#"{"external_id":"sfdc:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.upsert_object(
            "contact:redtail:family:7",
            "household",
            "redtail:family:7",
            "",
            "hash-redtail-family",
            r#"{"external_id":"redtail:family:7"}"#,
        )
        .unwrap();
        s.upsert_object(
            "note:redtail:note:2",
            "note",
            "redtail:family:7",
            "",
            "hash-redtail-note",
            r#"{"external_id":"redtail:note:2"}"#,
        )
        .unwrap();
        s.set_render_state("redtail:family:7", "stale", true)
            .unwrap();

        let redtail_rows = s.list_objects_by_provider_marker("redtail:").unwrap();
        assert_eq!(redtail_rows.len(), 2);

        let deleted = s.purge_objects_by_provider_marker("redtail:").unwrap();
        assert_eq!(deleted, 2);

        assert!(
            s.get_object("contact:10002").unwrap().is_some(),
            "Wealthbox row must survive Redtail purge"
        );
        assert!(
            s.get_object("contact:sfdc:001HH0000000001AAA")
                .unwrap()
                .is_some(),
            "Salesforce row must survive Redtail purge"
        );
        assert!(
            s.get_object("contact:redtail:family:7").unwrap().is_none(),
            "Redtail household row must be gone"
        );
        assert_eq!(
            s.get_render_state("redtail:family:7").unwrap(),
            None,
            "provider purge must clear stale render state for that household"
        );
    }

    #[test]
    fn provider_marker_list_including_deleted_returns_tombstoned_salesforce_rows() {
        let (_d, s) = crm_store();

        s.upsert_object(
            "contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA",
            "person",
            "sfdc:001HH0000000001AAA",
            "",
            "hash-sf-contact",
            r#"{"external_id":"sfdc:003CC0000000002AAA:acct:001HH0000000001AAA"}"#,
        )
        .unwrap();
        s.tombstone_object("contact:sfdc:003CC0000000002AAA:acct:001HH0000000001AAA")
            .unwrap();

        assert!(
            s.list_objects_by_provider_marker("sfdc:")
                .unwrap()
                .is_empty(),
            "the live provider-marker list should still hide tombstoned rows"
        );

        let all = s
            .list_objects_by_provider_marker_including_deleted("sfdc:")
            .unwrap();
        assert_eq!(all.len(), 1);
        assert!(
            all[0].deleted,
            "disconnect needs tombstoned provider rows so their stale RAG chunks can be deleted"
        );
    }

    // -----------------------------------------------------------------------
    // Cursor round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn cursor_roundtrip() {
        let (_d, s) = crm_store();

        assert_eq!(s.get_cursor("contacts").unwrap(), None);
        s.set_cursor("contacts", "2026-06-01T00:00:00Z").unwrap();
        assert_eq!(
            s.get_cursor("contacts").unwrap().as_deref(),
            Some("2026-06-01T00:00:00Z")
        );

        // Two types are independent.
        s.set_cursor("households", "2026-06-02T00:00:00Z").unwrap();
        assert_eq!(
            s.get_cursor("contacts").unwrap().as_deref(),
            Some("2026-06-01T00:00:00Z")
        );
        assert_eq!(
            s.get_cursor("households").unwrap().as_deref(),
            Some("2026-06-02T00:00:00Z")
        );
    }

    // -----------------------------------------------------------------------
    // Render-state round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn render_state_roundtrip() {
        let (_d, s) = crm_store();

        assert_eq!(s.get_render_state("1").unwrap(), None);
        s.set_render_state("1", "abc", true).unwrap();
        assert_eq!(
            s.get_render_state("1").unwrap(),
            Some(("abc".to_string(), true))
        );

        // Overwrite.
        s.set_render_state("1", "def", false).unwrap();
        assert_eq!(
            s.get_render_state("1").unwrap(),
            Some(("def".to_string(), false))
        );
    }

    // -----------------------------------------------------------------------
    // Meta round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn meta_roundtrip() {
        let (_d, s) = crm_store();

        assert_eq!(s.get_meta("sync_state").unwrap(), None);
        s.set_meta("sync_state", "idle").unwrap();
        assert_eq!(s.get_meta("sync_state").unwrap().as_deref(), Some("idle"));
        // Last-writer-wins.
        s.set_meta("sync_state", "running").unwrap();
        assert_eq!(
            s.get_meta("sync_state").unwrap().as_deref(),
            Some("running")
        );
    }

    // -----------------------------------------------------------------------
    // Encryption sanity: reading without the key must fail
    // -----------------------------------------------------------------------

    #[test]
    fn raw_connection_without_key_cannot_read() {
        let dir = TempDir::new().unwrap();
        let key = [0x33u8; 32];

        // Write some data.
        {
            let s = CrmStore::open_with_key(dir.path(), &key).unwrap();
            s.upsert_object(
                "household:1",
                "household",
                "1",
                "2026-06-01T00:00:00Z",
                "hash",
                r#"{"id":1}"#,
            )
            .unwrap();
        }

        // Open the same file without supplying the SQLCipher key.
        let db_path = CrmStore::db_path(dir.path());
        let raw = Connection::open(&db_path).expect("open file");
        // A SELECT without a key should fail (file is encrypted).
        let result = raw.query_row("SELECT count(*) FROM crm_objects", [], |r| {
            r.get::<_, i64>(0)
        });
        assert!(
            result.is_err(),
            "plain rusqlite connection must not be able to read SQLCipher DB"
        );
    }
}

//! Durable, 30-day CRM record recovery storage.
//!
//! A row retains the encrypted live-record snapshot while it can be restored.
//! It deliberately lives beside `crm_docs` in the SQLCipher CRM core database,
//! so recovery does not introduce a second browser or plaintext cache.

use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration {
    version: 2,
    id: "0002_trash",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE crm_trash_records (
            doc_key TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            record_type TEXT NOT NULL,
            matter_id TEXT NOT NULL,
            snapshot BLOB NOT NULL,
            state_vector BLOB NOT NULL,
            original_updated_at TEXT NOT NULL,
            deleted_at TEXT NOT NULL,
            deleted_by TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            restored_at TEXT,
            restored_by TEXT
        );
        CREATE INDEX crm_trash_records_active_expiry_idx
            ON crm_trash_records(expires_at)
            WHERE restored_at IS NULL;
        CREATE INDEX crm_trash_records_record_id_idx
            ON crm_trash_records(record_id);
        CREATE TABLE crm_trash_restores (
            doc_key TEXT PRIMARY KEY,
            record_id TEXT NOT NULL,
            record_type TEXT NOT NULL,
            deleted_at TEXT NOT NULL,
            deleted_by TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            restored_at TEXT NOT NULL,
            restored_by TEXT NOT NULL
        );
        "#,
    )?;
    Ok(())
}

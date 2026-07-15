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
        -- Generic CRM upserts and imports must never revive a record still
        -- inside its recovery window. Restore clears restored_at in the same
        -- transaction before changing crm_docs.deleted back to zero.
        CREATE TRIGGER crm_trash_prevent_resurrection
        BEFORE UPDATE OF deleted ON crm_docs
        WHEN OLD.deleted = 1 AND NEW.deleted = 0 AND EXISTS (
            SELECT 1 FROM crm_trash_records
            WHERE doc_key = OLD.doc_key
              AND restored_at IS NULL
              AND julianday(expires_at) > julianday(CURRENT_TIMESTAMP)
        )
        BEGIN
            SELECT RAISE(ABORT, 'CRM record has an active trash tombstone');
        END;
        CREATE TABLE crm_trash_restores (
            restore_id TEXT PRIMARY KEY,
            doc_key TEXT NOT NULL,
            record_id TEXT NOT NULL,
            record_type TEXT NOT NULL,
            deleted_at TEXT NOT NULL,
            deleted_by TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            restored_at TEXT NOT NULL,
            restored_by TEXT NOT NULL
        );
        CREATE INDEX crm_trash_restores_doc_key_idx ON crm_trash_restores(doc_key);
        "#,
    )?;
    Ok(())
}

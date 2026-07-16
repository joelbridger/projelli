//! Durable, redacted receipts for approved household merges.

use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration {
    version: 4,
    id: "0004_merge_receipts",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"CREATE TABLE crm_merge_receipts (
            receipt_id TEXT PRIMARY KEY,
            idempotency_key TEXT NOT NULL UNIQUE,
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            matter_id TEXT NOT NULL,
            approved_by TEXT NOT NULL,
            approved_at TEXT NOT NULL,
            moved_reference_count INTEGER NOT NULL,
            conflict_count INTEGER NOT NULL
        );
        CREATE INDEX crm_merge_receipts_source_target_idx
          ON crm_merge_receipts(source_id, target_id);
        CREATE TRIGGER crm_merge_prevent_source_resurrection
        BEFORE UPDATE OF deleted ON crm_docs
        WHEN OLD.deleted = 1 AND NEW.deleted = 0 AND EXISTS (
            SELECT 1 FROM crm_merge_receipts
            WHERE matter_id = OLD.matter_id
              AND ('live:' || source_id) = OLD.doc_id
        )
        BEGIN
            SELECT RAISE(ABORT, 'CRM merged source has a durable tombstone');
        END;"#,
    )?;
    Ok(())
}

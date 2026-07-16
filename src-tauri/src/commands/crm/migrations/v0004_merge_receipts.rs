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
        "CREATE TABLE crm_merge_receipts (
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
          ON crm_merge_receipts(source_id, target_id);",
    )?;
    Ok(())
}

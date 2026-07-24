//! Durable replay receipt for the native-only meeting Task doorway.

use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration {
    version: 8,
    id: "0008_local_task_delivery_receipts",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE local_task_delivery_receipts (
            delivery_key TEXT PRIMARY KEY,
            artifact_id TEXT NOT NULL,
            proposal_revision TEXT NOT NULL,
            task_id TEXT NOT NULL UNIQUE,
            task_content_sha256 TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            UNIQUE(artifact_id, proposal_revision)
        );",
    )?;
    Ok(())
}

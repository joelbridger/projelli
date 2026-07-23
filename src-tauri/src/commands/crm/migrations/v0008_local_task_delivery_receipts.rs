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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::migrations::{run_migrations, v0001_core_baseline};

    #[test]
    fn receipt_table_binds_one_delivery_identity_to_one_task() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn, &[v0001_core_baseline::MIGRATION, MIGRATION]).unwrap();
        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(local_task_delivery_receipts)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(columns.contains(&"delivery_key".to_string()));
        assert!(columns.contains(&"task_content_sha256".to_string()));
    }
}

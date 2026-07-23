//! Durable receipt ledger for the dark M4 provider-draft save boundary.

use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration {
    version: 7,
    id: "0007_m4_provider_draft_receipts",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE m4_provider_draft_receipts (
            claim_handle TEXT PRIMARY KEY,
            mailbox_handle TEXT NOT NULL,
            mailbox_version INTEGER NOT NULL CHECK(mailbox_version > 0),
            workspace_handle TEXT NOT NULL,
            provider TEXT NOT NULL CHECK(provider = 'microsoft'),
            content_hash TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            provider_draft_id TEXT NOT NULL UNIQUE,
            safe_metadata TEXT NOT NULL,
            saved_at TEXT NOT NULL
         );
         CREATE UNIQUE INDEX m4_provider_draft_receipts_one_key_idx
           ON m4_provider_draft_receipts(workspace_handle, provider, idempotency_key);",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::migrations::{
        run_migrations, v0001_core_baseline, v0006_verified_mailbox,
    };

    #[test]
    fn receipt_ledger_is_transactional_and_binds_one_claim_to_one_provider_draft() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(
            &conn,
            &[
                v0001_core_baseline::MIGRATION,
                v0006_verified_mailbox::MIGRATION,
                MIGRATION,
            ],
        )
        .unwrap();
        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(m4_provider_draft_receipts)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(columns[0], "claim_handle");
        assert!(columns.contains(&"provider_draft_id".to_string()));
        assert!(columns.contains(&"safe_metadata".to_string()));
    }
}

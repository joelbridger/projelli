//! Encrypted, provider-neutral mailbox identity and draft-claim tables.

use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration {
    version: 6,
    id: "0006_verified_mailbox",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE verified_mailboxes (
            workspace_handle TEXT NOT NULL,
            provider TEXT NOT NULL CHECK(provider IN ('microsoft','gmail')),
            mailbox_handle TEXT NOT NULL UNIQUE,
            provider_subject TEXT NOT NULL,
            canonical_address TEXT NOT NULL,
            display_label TEXT NOT NULL,
            workspace_generation INTEGER NOT NULL CHECK(workspace_generation > 0),
            credential_generation INTEGER NOT NULL CHECK(credential_generation > 0),
            verified_at TEXT NOT NULL,
            verified_source TEXT NOT NULL,
            version INTEGER NOT NULL CHECK(version > 0),
            status TEXT NOT NULL CHECK(status IN ('verified','stale','disconnected','refused')),
            PRIMARY KEY(workspace_handle, provider)
         );
         CREATE TABLE verified_draft_claims (
            claim_handle TEXT PRIMARY KEY,
            mailbox_handle TEXT NOT NULL,
            mailbox_version INTEGER NOT NULL CHECK(mailbox_version > 0),
            workspace_handle TEXT NOT NULL,
            provider TEXT NOT NULL CHECK(provider IN ('microsoft','gmail')),
            workspace_generation INTEGER NOT NULL CHECK(workspace_generation > 0),
            credential_generation INTEGER NOT NULL CHECK(credential_generation > 0),
            client_context TEXT NOT NULL,
            meeting_context TEXT NOT NULL,
            recipients_json TEXT NOT NULL,
            draft_subject TEXT NOT NULL,
            body TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            approval_receipt TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            version INTEGER NOT NULL CHECK(version > 0),
            status TEXT NOT NULL CHECK(status IN ('prepared','approved','claimed','saving','saved','unknown','failed','expired')),
            UNIQUE(workspace_handle, provider, idempotency_key)
         );
         CREATE INDEX verified_draft_claims_mailbox_history_idx
           ON verified_draft_claims(mailbox_handle, mailbox_version, version);",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::migrations::{run_migrations, v0001_core_baseline};

    #[test]
    fn m4_shared_foundation_migration_is_transactional_idempotent_and_preserves_old_workspaces() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn, &[v0001_core_baseline::MIGRATION]).unwrap();
        conn.execute(
            "INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted) VALUES(?1,?2,?3,?4,?5,?6,0)",
            ("old/live:one", "old", "live:one", vec![1_u8], Vec::<u8>::new(), "then"),
        )
        .unwrap();

        run_migrations(&conn, &[v0001_core_baseline::MIGRATION, MIGRATION]).unwrap();
        run_migrations(&conn, &[v0001_core_baseline::MIGRATION, MIGRATION]).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM crm_migrations WHERE version=6",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let old: Vec<u8> = conn
            .query_row(
                "SELECT yjs_state FROM crm_docs WHERE doc_key='old/live:one'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old, vec![1]);
    }
}

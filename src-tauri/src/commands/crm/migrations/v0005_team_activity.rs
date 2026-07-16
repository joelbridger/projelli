//! Matter-scoped activity index beside the canonical encrypted CRM documents.

use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration {
    version: 5,
    id: "0005_team_activity",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE crm_team_activity_projection (
            matter_id TEXT NOT NULL,
            record_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK(kind IN ('teamActivityPost','teamActivityComment','teamActivityReaction')),
            parent_post_id TEXT,
            staged_actor_id TEXT NOT NULL,
            authorship_trust TEXT NOT NULL CHECK(authorship_trust='renderer-staged-untrusted'),
            created_at TEXT NOT NULL,
            PRIMARY KEY(matter_id, record_id)
         );
         CREATE INDEX crm_team_activity_scope_time_idx
             ON crm_team_activity_projection(matter_id, created_at DESC, record_id);",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::migrations::{run_migrations, v0001_core_baseline};

    #[test]
    fn applies_once_with_the_transactional_registry_runner() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn, &[v0001_core_baseline::MIGRATION, MIGRATION]).unwrap();
        run_migrations(&conn, &[v0001_core_baseline::MIGRATION, MIGRATION]).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM crm_migrations WHERE version=5",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(crm_team_activity_projection)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            columns,
            [
                "matter_id",
                "record_id",
                "kind",
                "parent_post_id",
                "staged_actor_id",
                "authorship_trust",
                "created_at",
            ]
        );
    }

    #[test]
    fn preserves_existing_canonical_crm_documents() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn, &[v0001_core_baseline::MIGRATION]).unwrap();
        let legacy = br#"{"id":"legacy-1","kind":"note"}"#.to_vec();
        conn.execute(
            "INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted)
             VALUES(?1,?2,?3,?4,?5,?6,0)",
            rusqlite::params![
                "legacy/live:legacy-1",
                "legacy",
                "live:legacy-1",
                legacy,
                Vec::<u8>::new(),
                "2026-07-16T00:00:00Z",
            ],
        )
        .unwrap();

        run_migrations(&conn, &[v0001_core_baseline::MIGRATION, MIGRATION]).unwrap();
        let preserved: Vec<u8> = conn
            .query_row(
                "SELECT yjs_state FROM crm_docs WHERE doc_key='legacy/live:legacy-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preserved, br#"{"id":"legacy-1","kind":"note"}"#);
    }
}

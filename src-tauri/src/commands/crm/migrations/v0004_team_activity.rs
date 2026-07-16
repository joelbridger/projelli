//! Durable, append-only activity projection owned by the team-feed feature.

use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration { version: 4, id: "0004_team_activity", apply };

fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE crm_team_activity_projection (record_id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL);")?;
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
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM crm_migrations WHERE version=4", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }
}

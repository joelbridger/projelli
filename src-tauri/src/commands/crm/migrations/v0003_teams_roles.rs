//! Teams-and-roles durable projections. The aggregate command record remains
//! the write boundary today; these normalized tables reserve stable relational
//! storage for permission enforcement and future query paths.

use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration {
    version: 3,
    id: "0003_teams_roles",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE crm_roles (role_id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, client_access TEXT NOT NULL, capabilities_json TEXT NOT NULL, system INTEGER NOT NULL CHECK(system IN (0,1)), updated_at TEXT NOT NULL);
         CREATE TABLE crm_teams (team_id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, description TEXT, updated_at TEXT NOT NULL);
         CREATE TABLE crm_member_roles (member_id TEXT PRIMARY KEY NOT NULL, role_id TEXT NOT NULL REFERENCES crm_roles(role_id) ON UPDATE CASCADE ON DELETE RESTRICT, updated_at TEXT NOT NULL);
         CREATE TABLE crm_team_memberships (team_id TEXT NOT NULL REFERENCES crm_teams(team_id) ON UPDATE CASCADE ON DELETE CASCADE, member_id TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(team_id, member_id));
         CREATE INDEX crm_team_memberships_member_idx ON crm_team_memberships(member_id);",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::migrations::{run_migrations, v0001_core_baseline};
    use rusqlite::Connection;

    #[test]
    fn applies_once_idempotently_and_rolls_back_with_the_registry_runner() {
        let conn = Connection::open_in_memory().unwrap();
        let registry = [v0001_core_baseline::MIGRATION, MIGRATION];
        run_migrations(&conn, &registry).unwrap();
        run_migrations(&conn, &registry).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('crm_roles','crm_teams','crm_member_roles','crm_team_memberships')", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 4);
        let applied: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM crm_migrations WHERE version=3 AND id='0003_teams_roles'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(applied, 1);
    }
}

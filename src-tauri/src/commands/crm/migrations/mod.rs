//! Numbered, transactional CRM schema migrations.
//!
//! A feature that needs schema changes owns one `vNNNN_feature.rs` file and
//! contributes one entry to `CRM_MIGRATIONS`. The version-1 schema is a frozen
//! compatibility baseline and must not be edited for later features.

mod v0001_core_baseline;
mod v0002_trash;
mod v0003_teams_roles;
mod v0004_merge_receipts;
mod v0005_team_activity;
mod v0006_verified_mailbox;

#[cfg(test)]
mod v0002_test_dummy;

use anyhow::{bail, Context, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};
use std::collections::HashSet;

#[derive(Clone, Copy)]
pub struct Migration {
    pub version: u32,
    pub id: &'static str,
    pub apply: fn(&Connection) -> Result<()>,
}

/// Append new entries in ascending version order. Existing entries are
/// immutable once shipped.
pub const CRM_MIGRATIONS: &[Migration] = &[
    v0001_core_baseline::MIGRATION,
    v0002_trash::MIGRATION,
    v0003_teams_roles::MIGRATION,
    v0004_merge_receipts::MIGRATION,
    v0005_team_activity::MIGRATION,
    v0006_verified_mailbox::MIGRATION,
];

const CREATE_MIGRATIONS_TABLE: &str = r#"
CREATE TABLE IF NOT EXISTS crm_migrations (
    version INTEGER PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
);
"#;

pub fn migrate(conn: &Connection) -> Result<()> {
    run_migrations(conn, CRM_MIGRATIONS)
}

pub fn validate_registry(migrations: &[Migration]) -> Result<()> {
    let mut versions = HashSet::with_capacity(migrations.len());
    let mut ids = HashSet::with_capacity(migrations.len());
    let mut previous_version = None;

    for migration in migrations {
        if migration.version == 0 {
            bail!("CRM migration versions must start at 1")
        }
        if migration.id.trim().is_empty() {
            bail!("CRM migration {} has an empty id", migration.version)
        }
        if !versions.insert(migration.version) {
            bail!("duplicate CRM migration version {}", migration.version)
        }
        if !ids.insert(migration.id) {
            bail!("duplicate CRM migration id {}", migration.id)
        }
        if previous_version.is_some_and(|previous| previous > migration.version) {
            bail!("CRM migration registry is not sorted by version")
        }
        previous_version = Some(migration.version);
    }

    Ok(())
}

pub fn run_migrations(conn: &Connection, migrations: &[Migration]) -> Result<()> {
    validate_registry(migrations)?;
    conn.execute_batch(CREATE_MIGRATIONS_TABLE)
        .context("create CRM migration bookkeeping table")?;

    for migration in migrations {
        // IMMEDIATE serializes concurrent openers before either can decide a
        // migration is missing. The bookkeeping check is therefore part of
        // the same transaction as the migration and its completion row.
        let transaction = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)
            .with_context(|| format!("start CRM migration {}", migration.id))?;
        let recorded_id = transaction
            .query_row(
                "SELECT id FROM crm_migrations WHERE version=?1",
                [migration.version],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(recorded_id) = recorded_id {
            if recorded_id != migration.id {
                bail!(
                    "CRM migration version {} is already recorded as {}, not {}",
                    migration.version,
                    recorded_id,
                    migration.id
                )
            }
            transaction.commit()?;
            continue;
        }

        let recorded_version = transaction
            .query_row(
                "SELECT version FROM crm_migrations WHERE id=?1",
                [migration.id],
                |row| row.get::<_, u32>(0),
            )
            .optional()?;
        if let Some(recorded_version) = recorded_version {
            bail!(
                "CRM migration id {} is already recorded at version {}, not {}",
                migration.id,
                recorded_version,
                migration.version
            )
        }

        (migration.apply)(&transaction)
            .with_context(|| format!("apply CRM migration {}", migration.id))?;
        transaction.execute(
            "INSERT INTO meta(key,value) VALUES('schema_version',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [migration.version.to_string()],
        )?;
        transaction.execute(
            "INSERT INTO crm_migrations(version,id,applied_at) VALUES(?1,?2,?3)",
            (
                migration.version,
                migration.id,
                chrono::Utc::now().to_rfc3339(),
            ),
        )?;
        transaction
            .commit()
            .with_context(|| format!("commit CRM migration {}", migration.id))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;

    fn no_op(_: &Connection) -> Result<()> {
        Ok(())
    }

    fn fail_after_write(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE should_roll_back (id INTEGER PRIMARY KEY); INSERT INTO should_roll_back(id) VALUES(1);",
        )?;
        Err(anyhow!("deliberate migration failure"))
    }

    #[test]
    fn registry_is_sorted_and_unique() {
        validate_registry(CRM_MIGRATIONS).unwrap();

        let duplicate_version = [
            Migration {
                version: 1,
                id: "one",
                apply: no_op,
            },
            Migration {
                version: 1,
                id: "two",
                apply: no_op,
            },
        ];
        assert!(validate_registry(&duplicate_version)
            .unwrap_err()
            .to_string()
            .contains("duplicate CRM migration version 1"));

        let duplicate_id = [
            Migration {
                version: 1,
                id: "same",
                apply: no_op,
            },
            Migration {
                version: 2,
                id: "same",
                apply: no_op,
            },
        ];
        assert!(validate_registry(&duplicate_id)
            .unwrap_err()
            .to_string()
            .contains("duplicate CRM migration id same"));

        let unsorted = [
            Migration {
                version: 2,
                id: "two",
                apply: no_op,
            },
            Migration {
                version: 1,
                id: "one",
                apply: no_op,
            },
        ];
        assert!(validate_registry(&unsorted)
            .unwrap_err()
            .to_string()
            .contains("not sorted"));
    }

    #[test]
    fn applies_each_migration_once_and_records_it() {
        v0002_test_dummy::reset_apply_count();
        let conn = Connection::open_in_memory().unwrap();
        let registry = [v0001_core_baseline::MIGRATION, v0002_test_dummy::MIGRATION];

        run_migrations(&conn, &registry).unwrap();
        run_migrations(&conn, &registry).unwrap();

        assert_eq!(v0002_test_dummy::apply_count(), 1);
        let applied: Vec<(u32, String)> = {
            let mut statement = conn
                .prepare("SELECT version,id FROM crm_migrations ORDER BY version")
                .unwrap();
            statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        assert_eq!(
            applied,
            vec![
                (1, "0001_core_baseline".to_string()),
                (2, "0002_test_dummy".to_string()),
            ]
        );
    }

    #[test]
    fn trash_migration_applies_once_and_remains_recorded() {
        let conn = Connection::open_in_memory().unwrap();

        migrate(&conn).unwrap();
        migrate(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM crm_migrations WHERE version=2 AND id='0002_trash'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let table_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='crm_trash_records'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(table_exists, 1);
    }

    #[test]
    fn failed_migration_rolls_back_schema_data_and_bookkeeping() {
        let conn = Connection::open_in_memory().unwrap();
        let registry = [
            v0001_core_baseline::MIGRATION,
            Migration {
                version: 2,
                id: "0002_failing",
                apply: fail_after_write,
            },
        ];

        assert!(run_migrations(&conn, &registry).is_err());
        let failed_table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='should_roll_back'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let failed_bookkeeping_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM crm_migrations WHERE version=2",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(failed_table_count, 0);
        assert_eq!(failed_bookkeeping_count, 0);
    }

    #[test]
    fn adopts_the_frozen_schema_without_changing_existing_data() {
        let conn = Connection::open_in_memory().unwrap();
        crate::commands::crm::core_schema::apply_baseline(&conn).unwrap();
        conn.execute(
            "INSERT INTO crm_docs(doc_key,matter_id,doc_id,yjs_state,state_vector,updated_at,deleted) VALUES(?1,?2,?3,?4,?5,?6,0)",
            (
                "client-1/live:future-1",
                "client-1",
                "live:future-1",
                br#"{"id":"future-1","kind":"futureFeature","matterId":"client-1"}"#.as_slice(),
                &[] as &[u8],
                "2026-07-15T00:00:00Z",
            ),
        )
        .unwrap();

        migrate(&conn).unwrap();

        let bytes: Vec<u8> = conn
            .query_row(
                "SELECT yjs_state FROM crm_docs WHERE doc_key='client-1/live:future-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
            serde_json::json!({"id":"future-1","kind":"futureFeature","matterId":"client-1"})
        );
    }
}

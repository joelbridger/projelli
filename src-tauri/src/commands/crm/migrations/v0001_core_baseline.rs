use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration {
    version: crate::commands::crm::core_schema::CRM_CORE_BASELINE_VERSION,
    id: "0001_core_baseline",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    crate::commands::crm::core_schema::apply_baseline(conn)
}

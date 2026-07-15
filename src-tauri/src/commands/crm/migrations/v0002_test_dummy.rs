//! Test-only example of the extension contract: one migration file and one
//! registry entry, with no edit to the frozen baseline.

use anyhow::Result;
use rusqlite::Connection;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::Migration;

static APPLY_COUNT: AtomicUsize = AtomicUsize::new(0);

pub const MIGRATION: Migration = Migration {
    version: 2,
    id: "0002_test_dummy",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    APPLY_COUNT.fetch_add(1, Ordering::SeqCst);
    conn.execute_batch(
        "CREATE TABLE test_dummy_feature (id TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )?;
    Ok(())
}

pub fn reset_apply_count() {
    APPLY_COUNT.store(0, Ordering::SeqCst);
}

pub fn apply_count() -> usize {
    APPLY_COUNT.load(Ordering::SeqCst)
}

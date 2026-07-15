---
name: add-crm-migration-descriptor
description: Add an append-only CRM SQL migration or live-record descriptor without changing the frozen baseline or central write behavior.
---

# Add a CRM migration or record descriptor

Use this recipe when a CRM feature needs new SQL schema or feature-specific
validation/projection for a generic live record. These are two independent
append-only registries. Add only the part the feature needs.

## Add a schema migration

1. Leave `src-tauri/src/commands/crm/core_schema.rs` and
   `migrations/v0001_core_baseline.rs` unchanged. Version 1 only delegates to
   the frozen baseline (`migrations/v0001_core_baseline.rs:6-14`).
2. Choose the next unused migration number and create
   `src-tauri/src/commands/crm/migrations/vNNNN_feature_name.rs`.
3. Follow the real `Migration` shape at `migrations/mod.rs:16-21` and the
   test-only extension example at `migrations/v0002_test_dummy.rs:12-23`:

```rust
use anyhow::Result;
use rusqlite::Connection;

use super::Migration;

pub const MIGRATION: Migration = Migration {
    version: 2,
    id: "0002_feature_name",
    apply,
};

fn apply(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE crm_feature_name (id TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )?;
    Ok(())
}
```

4. Add `mod vNNNN_feature_name;` beside the other migration modules, then
   append `vNNNN_feature_name::MIGRATION` to `CRM_MIGRATIONS` in ascending
   version order. The mount point and append-only rule are at
   `migrations/mod.rs:23-25`; uniqueness and order checks are at
   `migrations/mod.rs:39-60`.
5. Add a test that opens the old schema, runs migrations twice, and proves the
   new schema/data is correct and the migration ran once. Migration execution
   and bookkeeping share one immediate transaction (`migrations/mod.rs:66-70`
   and the transaction body below it), so do not start or commit a separate
   transaction inside `apply`.

Never edit an existing migration id, version, SQL body, module order, or the
frozen baseline to make a later feature fit. Add the next file and registry
entry instead.

## Add a live-record descriptor

1. Put the validator/projector in a feature-owned Rust module. Use the exact
   function types and descriptor shape at
   `record_descriptors/registry.rs:8-16`:

```rust
use anyhow::{bail, Result};
use rusqlite::Connection;
use serde_json::Value;

use super::RecordDescriptor;

fn validate(record: &Value) -> Result<()> {
    if record.get("name").and_then(Value::as_str).is_none() {
        bail!("name is required")
    }
    Ok(())
}

fn project(record: &Value, conn: &Connection) -> Result<()> {
    conn.execute(
        "INSERT INTO crm_feature_name(id,name) VALUES(?1,?2) \
         ON CONFLICT(id) DO UPDATE SET name=excluded.name",
        (record["id"].as_str().unwrap(), record["name"].as_str().unwrap()),
    )?;
    Ok(())
}

pub const DESCRIPTOR: RecordDescriptor = RecordDescriptor {
    kind: "feature_name",
    validate: Some(validate),
    project: Some(project),
};
```

2. Export the feature module through `record_descriptors/mod.rs`, then append
   `feature_name::DESCRIPTOR` to `CRM_RECORD_DESCRIPTORS` in lexical `kind`
   order. The sole mount point and empty compatibility baseline are at
   `record_descriptors/mod.rs:24-26`.
3. Keep generic identity rules out of the feature validator. Shared id/kind
   syntax is enforced at `record_descriptors/registry.rs:61-87`; registered
   validators are dispatched by exact `kind` at
   `record_descriptors/registry.rs:89-98`.
4. A projector receives the same SQL transaction as the generic document
   write (`core_store.rs:137-180`). Do not open another database connection or
   commit inside the projector. A projector failure must roll back both writes.
5. Add tests for a valid record, each feature-specific invalid shape, the SQL
   projection, and rollback on projector failure. Also run the registry tests,
   which reject duplicate, invalid, or unsorted kinds.

Unknown syntactically valid kinds must continue to use the generic document
contract. Do not add a central enum/switch, and do not change the Wealthbox
importer's opaque-source-id compatibility path when adding a descriptor.

## Verify

Run from `src-tauri/`:

```bash
cargo test -p lantern commands::crm::migrations::tests
cargo test -p lantern commands::crm::record_descriptors::tests
cargo test -p lantern commands::crm::core_store::tests
cargo test -p lantern commands::crm
```

Before committing, confirm `core_schema.rs`,
`migrations/v0001_core_baseline.rs`, and all pre-existing entries in
`CRM_MIGRATIONS` are byte-identical to the branch point.

//! Durable, operator-readable migration exports.
//!
//! The export files intentionally live beside the selected workspace rather
//! than inside the CRM database.  A firm must still have its evidence if it
//! later resets or replaces the local CRM store.

use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::fetchers::SourceType;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WrittenExport {
    pub path: PathBuf,
    pub byte_length: usize,
    pub sha256: String,
}

fn export_dir(workspace: &Path) -> PathBuf {
    workspace.join(format!("{} migration exports", crate::generated_brand::PRODUCT_NAME))
}

fn safe_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<WrittenExport> {
    let parent = path
        .parent()
        .context("migration export has no parent directory")?;
    fs::create_dir_all(parent).context("create migration export folder")?;
    // A batch export is immutable evidence. A person may safely ask for a
    // second copy, but we must never quietly replace the first one. Pick the
    // next free numbered name and create it atomically so a retry is useful
    // even if the first attempt already made a file.
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .context("migration export has no filename stem")?;
    let extension = path.extension().and_then(|value| value.to_str());
    for copy in 0usize.. {
        let name = if copy == 0 {
            match extension {
                Some(extension) => format!("{stem}.{extension}"),
                None => stem.to_string(),
            }
        } else {
            match extension {
                Some(extension) => format!("{stem}-{copy}.{extension}"),
                None => format!("{stem}-{copy}"),
            }
        };
        let candidate = parent.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                use std::io::Write;
                file.write_all(bytes)
                    .with_context(|| format!("write migration export {}", candidate.display()))?;
                file.sync_all()
                    .with_context(|| format!("sync migration export {}", candidate.display()))?;
                return Ok(WrittenExport {
                    path: candidate,
                    byte_length: bytes.len(),
                    sha256: hex::encode(Sha256::digest(bytes)),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("create migration export {}", candidate.display()));
            }
        }
    }
    unreachable!("unbounded export copy sequence always returns or errors")
}

/// Writes a decrypted, portable archive. The manifest is inside the package,
/// so copying this one file is sufficient for a later audit.
pub fn write_decrypted_archive(
    workspace: &Path,
    batch_id: &str,
    records: &[Value],
    fidelity_matrix: &[Value],
) -> Result<WrittenExport> {
    let mut counts = std::collections::BTreeMap::<String, usize>::new();
    let captured_records: Vec<Value> = records
        .iter()
        .filter_map(|record| {
            let source_type = record.get("sourceType")?.as_str()?.to_string();
            let source_id = record.get("sourceId")?.as_str()?.to_string();
            let payload = record.get("sourcePayload")?.clone();
            *counts.entry(source_type.clone()).or_default() += 1;
            Some(json!({
                "sourceType": source_type,
                "sourceId": source_id,
                "targetRecordId": record.get("id").cloned().unwrap_or(Value::Null),
                "payload": payload,
            }))
        })
        .collect();
    let manifest = json!({
        "format": "lantern-wealthbox-archive-v1",
        "batchId": batch_id,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "recordCounts": counts,
        "fidelityMatrix": fidelity_matrix,
        "recordCount": captured_records.len(),
        "notice": "This is a decrypted export. Store it somewhere approved by your firm.",
    });
    // The file is only a trustworthy cutover artifact if the three views of a
    // migration agree: what the source returned, what landed, and what this
    // archive carries. Fail closed rather than creating a comforting but
    // incomplete file.
    for row in fidelity_matrix {
        let source_type = row.get("sourceType").and_then(Value::as_str).unwrap_or("");
        let fetched = row.get("fetched").and_then(Value::as_u64).unwrap_or(0) as usize;
        let imported = row.get("imported").and_then(Value::as_u64).unwrap_or(0) as usize;
        let skipped = row.get("skipped").and_then(Value::as_u64).unwrap_or(0) as usize;
        let rejected = row.get("rejected").and_then(Value::as_u64).unwrap_or(0) as usize;
        if fetched != imported + skipped + rejected {
            anyhow::bail!("fidelity row for {source_type} does not reconcile fetched records");
        }
        let archived = counts.get(source_type).copied().unwrap_or(0);
        if archived != imported {
            anyhow::bail!(
                "fidelity row for {source_type} says {imported} landed but archive has {archived}"
            );
        }
    }
    let package = json!({ "manifest": manifest, "records": captured_records });
    let bytes = serde_json::to_vec_pretty(&package).context("serialize decrypted archive")?;
    let path =
        export_dir(workspace).join(format!("wealthbox-archive-{}.json", safe_segment(batch_id)));
    write_new_file(&path, &bytes)
}

use crate::safe_csv::{csv_cell, csv_row};

/// Writes a Wealthbox-shaped contact CSV for imported household and person
/// records. It deliberately labels its coverage so a user never mistakes it
/// for a promise to restore notes, tasks, or files.
pub fn write_rollback_csv(
    workspace: &Path,
    batch_id: &str,
    records: &[Value],
) -> Result<WrittenExport> {
    let mut rows = vec![csv_row(
        ["Contact Type", "Name", "First Name", "Last Name", "Source ID", "Notes"]
            .into_iter()
            .map(csv_cell),
    )];
    for record in records {
        let Some(source_type) = record.get("sourceType").and_then(Value::as_str) else {
            continue;
        };
        if source_type != SourceType::Contact.as_str() {
            continue;
        }
        let payload = record.get("sourcePayload").unwrap_or(record);
        let contact_type = payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("person");
        let name = record
            .get("label")
            .and_then(Value::as_str)
            .or_else(|| payload.get("name").and_then(Value::as_str))
            .unwrap_or("");
        let first_name = payload
            .get("first_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        let last_name = payload
            .get("last_name")
            .and_then(Value::as_str)
            .unwrap_or("");
        let source_id = record.get("sourceId").and_then(Value::as_str).unwrap_or("");
        let note = format!(
            "Exported by {} for rollback; verify Wealthbox's current import columns before use.",
            crate::generated_brand::PRODUCT_NAME,
        );
        // Every field here is third-party data from the source CRM. A contact
        // named `=cmd|'/c calc'!A1` used to be written with quoting only, which
        // a spreadsheet still evaluates; csv_cell prefixes it so the operator
        // reads text instead of running a command.
        rows.push(csv_row(
            [contact_type, name, first_name, last_name, source_id, note.as_str()]
                .into_iter()
                .map(csv_cell),
        ));
    }
    let bytes = rows.join("\n").into_bytes();
    let path = export_dir(workspace).join(format!(
        "wealthbox-rollback-contacts-{}.csv",
        safe_segment(batch_id)
    ));
    write_new_file(&path, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_workspace(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "lantern-migration-export-{name}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn archive_is_a_real_file_with_manifest_counts() {
        let root = temp_workspace("archive");
        let record = json!({ "id": "opportunity:1", "sourceType": "opportunity", "sourceId": "1", "sourcePayload": { "name": "Transfer" } });
        let written = write_decrypted_archive(&root, "batch-1", &[record], &[json!({"sourceType":"opportunity","fetched":1,"imported":1,"skipped":0,"rejected":0})]).unwrap();
        let parsed: Value = serde_json::from_slice(&fs::read(&written.path).unwrap()).unwrap();
        assert_eq!(parsed["manifest"]["recordCounts"]["opportunity"], 1);
        assert_eq!(parsed["records"].as_array().unwrap().len(), 1);
        assert_eq!(
            written.byte_length,
            fs::metadata(&written.path).unwrap().len() as usize
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_is_a_real_quoted_csv() {
        let root = temp_workspace("rollback");
        let record = json!({ "id": "person:1", "label": "Ada, Advisor", "sourceType": "contact", "sourceId": "1", "sourcePayload": { "type": "person", "first_name": "Ada", "last_name": "Advisor" } });
        let written = write_rollback_csv(&root, "batch-1", &[record]).unwrap();
        let body = fs::read_to_string(&written.path).unwrap();
        assert!(body.contains("\"Ada, Advisor\""));
        assert!(body.contains("Source ID"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn retry_keeps_the_first_export_and_writes_a_new_copy() {
        let root = temp_workspace("retry");
        let record = json!({ "id": "person:1", "label": "Ada", "sourceType": "contact", "sourceId": "1", "sourcePayload": { "type": "person" } });
        let first = write_rollback_csv(&root, "batch-1", &[record.clone()]).unwrap();
        let second = write_rollback_csv(&root, "batch-1", &[record]).unwrap();
        assert!(first.path.exists());
        assert!(second.path.exists());
        assert_ne!(first.path, second.path);
        assert_eq!(fs::read(&first.path).unwrap(), fs::read(&second.path).unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn archive_refuses_a_matrix_that_does_not_match_landed_records() {
        let root = temp_workspace("mismatch");
        let record = json!({ "id": "project:1", "sourceType": "project", "sourceId": "1", "sourcePayload": {} });
        let error = write_decrypted_archive(
            &root,
            "batch-1",
            &[record],
            &[json!({"sourceType":"project","fetched":2,"imported":2,"skipped":0,"rejected":0})],
        )
        .unwrap_err();
        assert!(error.to_string().contains("archive has 1"));
        assert!(!root.join(format!("{} migration exports", crate::generated_brand::PRODUCT_NAME)).exists());
    }
}

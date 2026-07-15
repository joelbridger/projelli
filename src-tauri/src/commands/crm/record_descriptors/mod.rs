//! Optional, feature-owned behavior for generic CRM live records.
//!
//! Unknown but syntactically valid kinds deliberately remain valid. A feature
//! adds a descriptor only when it needs validation beyond the generic contract
//! or an atomic SQL projection.

mod registry;

pub use registry::{
    project_live_record, validate_live_record, validate_registry, RecordDescriptor, RecordIdentity,
    RecordProjector, RecordValidator,
};

/// Append feature-owned descriptors in lexical `kind` order. The empty
/// baseline is intentional: existing live records need no special branches.
pub const CRM_RECORD_DESCRIPTORS: &[RecordDescriptor] = &[];

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::{bail, Result};
    use rusqlite::Connection;
    use serde_json::Value;

    fn validate_named(record: &Value) -> Result<()> {
        if record.get("name").and_then(Value::as_str).is_none() {
            bail!("name is required")
        }
        Ok(())
    }

    fn no_op_projector(_: &Value, _: &Connection) -> Result<()> {
        Ok(())
    }

    const ALPHA: RecordDescriptor = RecordDescriptor {
        kind: "alphaFeature",
        validate: Some(validate_named),
        project: Some(no_op_projector),
    };
    const BETA: RecordDescriptor = RecordDescriptor {
        kind: "betaFeature",
        validate: None,
        project: None,
    };

    #[test]
    fn registry_requires_sorted_unique_valid_kinds() {
        validate_registry(&[ALPHA, BETA]).unwrap();

        assert!(validate_registry(&[BETA, ALPHA])
            .unwrap_err()
            .to_string()
            .contains("not sorted"));
        assert!(validate_registry(&[ALPHA, ALPHA])
            .unwrap_err()
            .to_string()
            .contains("duplicate CRM record descriptor kind"));

        let invalid = RecordDescriptor {
            kind: "not valid",
            ..BETA
        };
        assert!(validate_registry(&[invalid]).is_err());
    }

    #[test]
    fn unknown_valid_kind_uses_the_generic_contract() {
        let record = serde_json::json!({
            "id": "future-record:1",
            "kind": "futureFeature",
            "matterId": "client-1",
            "payload": { "kept": true }
        });

        let identity = validate_live_record(&record, &[ALPHA, BETA]).unwrap();
        assert_eq!(identity.id, "future-record:1");
        assert_eq!(identity.kind, "futureFeature");
    }

    #[test]
    fn registered_validator_runs_without_a_central_enum_branch() {
        let missing_name = serde_json::json!({"id":"a-1","kind":"alphaFeature"});
        let error = validate_live_record(&missing_name, &[ALPHA, BETA]).unwrap_err();
        assert!(format!("{error:#}").contains("name is required"));

        let valid = serde_json::json!({"id":"a-1","kind":"alphaFeature","name":"A"});
        validate_live_record(&valid, &[ALPHA, BETA]).unwrap();
    }
}

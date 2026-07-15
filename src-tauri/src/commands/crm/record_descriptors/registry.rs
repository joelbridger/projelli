use anyhow::{bail, Context, Result};
use rusqlite::Connection;
use serde_json::Value;
use std::collections::HashSet;

use super::valid_record_identifier;

pub type RecordValidator = fn(&Value) -> Result<()>;
pub type RecordProjector = fn(&Value, &Connection) -> Result<()>;

#[derive(Clone, Copy)]
pub struct RecordDescriptor {
    pub kind: &'static str,
    pub validate: Option<RecordValidator>,
    pub project: Option<RecordProjector>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordIdentity<'a> {
    pub id: &'a str,
    pub kind: &'a str,
}

pub fn validate_registry(descriptors: &[RecordDescriptor]) -> Result<()> {
    let mut kinds = HashSet::with_capacity(descriptors.len());
    let mut previous_kind = None;

    for descriptor in descriptors {
        if !valid_record_identifier(descriptor.kind, false) {
            bail!("invalid CRM record descriptor kind {}", descriptor.kind)
        }
        if !kinds.insert(descriptor.kind) {
            bail!("duplicate CRM record descriptor kind {}", descriptor.kind)
        }
        if previous_kind.is_some_and(|previous| previous > descriptor.kind) {
            bail!("CRM record descriptor registry is not sorted by kind")
        }
        previous_kind = Some(descriptor.kind);
    }

    Ok(())
}

pub fn validate_live_record<'a>(
    record: &'a Value,
    descriptors: &[RecordDescriptor],
) -> Result<RecordIdentity<'a>> {
    validate_live_record_with_syntax(record, descriptors, true)
}

/// Wealthbox source ids are opaque strings. The importer historically accepted
/// every non-empty id, so descriptor dispatch must not add a character-set gate
/// at this lower-level migration boundary.
pub fn validate_imported_live_record<'a>(
    record: &'a Value,
    descriptors: &[RecordDescriptor],
) -> Result<RecordIdentity<'a>> {
    validate_live_record_with_syntax(record, descriptors, false)
}

fn validate_live_record_with_syntax<'a>(
    record: &'a Value,
    descriptors: &[RecordDescriptor],
    enforce_identifier_syntax: bool,
) -> Result<RecordIdentity<'a>> {
    validate_registry(descriptors)?;
    let object = record
        .as_object()
        .context("CRM live record must be an object")?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .context("CRM live record requires id")?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .context("CRM live record requires kind")?;
    if enforce_identifier_syntax {
        if !valid_record_identifier(kind, false) {
            bail!("CRM live record kind is invalid")
        }
        if !valid_record_identifier(id, true) {
            bail!("CRM live record id is invalid")
        }
    }

    if let Some(descriptor) = descriptors
        .iter()
        .find(|descriptor| descriptor.kind == kind)
    {
        if let Some(validate) = descriptor.validate {
            validate(record).with_context(|| format!("validate CRM record kind {kind}"))?;
        }
    }

    Ok(RecordIdentity { id, kind })
}

pub fn project_live_record(
    record: &Value,
    conn: &Connection,
    descriptors: &[RecordDescriptor],
) -> Result<()> {
    let identity = validate_live_record(record, descriptors)?;
    if let Some(project) = descriptors
        .iter()
        .find(|descriptor| descriptor.kind == identity.kind)
        .and_then(|descriptor| descriptor.project)
    {
        project(record, conn)
            .with_context(|| format!("project CRM record kind {}", identity.kind))?;
    }
    Ok(())
}

pub fn project_imported_live_record(
    record: &Value,
    conn: &Connection,
    descriptors: &[RecordDescriptor],
) -> Result<()> {
    let identity = validate_imported_live_record(record, descriptors)?;
    if let Some(project) = descriptors
        .iter()
        .find(|descriptor| descriptor.kind == identity.kind)
        .and_then(|descriptor| descriptor.project)
    {
        project(record, conn)
            .with_context(|| format!("project CRM record kind {}", identity.kind))?;
    }
    Ok(())
}

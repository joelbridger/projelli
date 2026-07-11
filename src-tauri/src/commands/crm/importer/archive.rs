//! Append-only raw captures and immutable import-batch archive manifests.

use std::collections::BTreeMap;

use anyhow::bail;
use sha2::{Digest, Sha256};

use super::fetchers::SourceType;

pub const CAPTURE_LAYER_VERSION: &str = "wealthbox-raw-capture-v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawRecordRef(pub String);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalRefProjection {
    pub provider: String,
    pub source_type: String,
    pub source_id: String,
    /// Empty for one-entity records. Multi-household Notes use the canonical
    /// sorted-set fingerprint, so they cannot be replayed into a different scope.
    pub scope: String,
    pub target_entity_ref: String,
}

impl ExternalRefProjection {
    pub fn key(&self) -> String {
        format!(
            "{}\u{1f}{}\u{1f}{}\u{1f}{}",
            self.provider, self.source_type, self.source_id, self.scope
        )
    }
}

pub fn household_scope_fingerprint(household_refs: &[String]) -> String {
    let mut refs = household_refs.to_vec();
    refs.sort();
    refs.dedup();
    let mut digest = Sha256::new();
    digest.update(refs.join("\u{1f}").as_bytes());
    format!("households:{}", hex::encode(digest.finalize()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawCapture {
    pub raw_record_ref: RawRecordRef,
    pub import_batch_id: String,
    pub provider: String,
    pub request_path: String,
    pub source_locator: String,
    pub capture_layer_version: String,
    pub fixture_corpus_identity: String,
    pub captured_at: String,
    pub response_bytes: Vec<u8>,
    pub byte_length: usize,
    pub response_sha256: String,
}

impl RawCapture {
    pub fn new(
        import_batch_id: &str,
        provider: &str,
        request_path: &str,
        source_locator: &str,
        fixture_corpus_identity: &str,
        captured_at: &str,
        response_bytes: Vec<u8>,
    ) -> Self {
        let response_sha256 = sha256(&response_bytes);
        let raw_record_ref = RawRecordRef(format!("raw:{}:{}", import_batch_id, response_sha256));
        let byte_length = response_bytes.len();
        Self {
            raw_record_ref,
            import_batch_id: import_batch_id.to_string(),
            provider: provider.to_string(),
            request_path: request_path.to_string(),
            source_locator: source_locator.to_string(),
            capture_layer_version: CAPTURE_LAYER_VERSION.to_string(),
            fixture_corpus_identity: fixture_corpus_identity.to_string(),
            captured_at: captured_at.to_string(),
            response_bytes,
            byte_length,
            response_sha256,
        }
    }
}

pub trait RawCaptureStore {
    /// Append only. Existing records with different bytes are a hard error.
    fn append(&mut self, capture: RawCapture) -> anyhow::Result<()>;
    fn get(&self, raw_record_ref: &RawRecordRef) -> Option<&RawCapture>;
}

#[derive(Default)]
pub struct InMemoryRawCaptureStore {
    captures: BTreeMap<String, RawCapture>,
}

impl RawCaptureStore for InMemoryRawCaptureStore {
    fn append(&mut self, capture: RawCapture) -> anyhow::Result<()> {
        let key = capture.raw_record_ref.0.clone();
        if let Some(existing) = self.captures.get(&key) {
            if existing.response_sha256 != capture.response_sha256
                || existing.response_bytes != capture.response_bytes
            {
                bail!("raw capture collision for {}", key);
            }
            return Ok(());
        }
        self.captures.insert(key, capture);
        Ok(())
    }

    fn get(&self, raw_record_ref: &RawRecordRef) -> Option<&RawCapture> {
        self.captures.get(&raw_record_ref.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypedOutcome {
    Landed,
    Skipped,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawArchiveEntry {
    pub raw_record_ref: RawRecordRef,
    pub source_type: SourceType,
    pub request_path: String,
    pub source_locator: String,
    pub capture_layer_version: String,
    pub fixture_corpus_identity: String,
    pub captured_at: String,
    pub response_sha256: String,
    pub byte_length: usize,
    pub typed_outcome: TypedOutcome,
    pub target_entity_ref: Option<String>,
    pub skip_reason: Option<String>,
    pub resulting_external_refs: Vec<ExternalRefProjection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportArchiveManifest {
    pub import_batch_id: String,
    pub provider: String,
    pub captured_at: String,
    pub source_workspace_label: String,
    pub records: Vec<RawArchiveEntry>,
    pub finalized_at: Option<String>,
    pub manifest_sha256: Option<String>,
}

impl ImportArchiveManifest {
    pub fn new(
        import_batch_id: &str,
        provider: &str,
        captured_at: &str,
        source_workspace_label: &str,
    ) -> Self {
        Self {
            import_batch_id: import_batch_id.into(),
            provider: provider.into(),
            captured_at: captured_at.into(),
            source_workspace_label: source_workspace_label.into(),
            records: Vec::new(),
            finalized_at: None,
            manifest_sha256: None,
        }
    }

    pub fn append(&mut self, entry: RawArchiveEntry) -> anyhow::Result<()> {
        if self.finalized_at.is_some() {
            bail!("archive manifest is sealed");
        }
        if self.records.iter().any(|existing| {
            existing.raw_record_ref == entry.raw_record_ref
                && existing.source_locator == entry.source_locator
        }) {
            bail!("archive entry already exists for raw record/source locator");
        }
        self.records.push(entry);
        Ok(())
    }

    pub fn seal(&mut self, finalized_at: &str) -> anyhow::Result<&str> {
        if self.finalized_at.is_some() {
            bail!("archive manifest is already sealed");
        }
        self.records.sort_by(|a, b| {
            a.raw_record_ref
                .0
                .cmp(&b.raw_record_ref.0)
                .then(a.source_locator.cmp(&b.source_locator))
        });
        let canonical = self.canonical_bytes();
        self.manifest_sha256 = Some(sha256(&canonical));
        self.finalized_at = Some(finalized_at.to_string());
        Ok(self.manifest_sha256.as_deref().expect("just set"))
    }

    fn canonical_bytes(&self) -> Vec<u8> {
        // Length-prefixing prevents separators in user supplied labels from
        // changing the meaning of an archive checksum.
        let mut output = Vec::new();
        for value in [
            &self.import_batch_id,
            &self.provider,
            &self.captured_at,
            &self.source_workspace_label,
        ] {
            output.extend_from_slice(value.len().to_string().as_bytes());
            output.push(b':');
            output.extend_from_slice(value.as_bytes());
        }
        for entry in &self.records {
            let line = format!(
                "{}|{}|{}|{}|{}|{}|{}|{}|{:?}|{:?}|{:?}|{:?}",
                entry.raw_record_ref.0,
                entry.source_type.as_str(),
                entry.request_path,
                entry.source_locator,
                entry.capture_layer_version,
                entry.fixture_corpus_identity,
                entry.captured_at,
                entry.response_sha256,
                entry.typed_outcome,
                entry.target_entity_ref,
                entry.skip_reason,
                entry
                    .resulting_external_refs
                    .iter()
                    .map(ExternalRefProjection::key)
                    .collect::<Vec<_>>()
            );
            output.extend_from_slice(line.len().to_string().as_bytes());
            output.push(b':');
            output.extend_from_slice(line.as_bytes());
        }
        output
    }
}

pub fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_is_stable_for_sorted_household_set() {
        assert_eq!(
            household_scope_fingerprint(&["h2".into(), "h1".into()]),
            household_scope_fingerprint(&["h1".into(), "h2".into(), "h2".into()])
        );
    }

    #[test]
    fn sealed_manifest_cannot_change() {
        let capture = RawCapture::new(
            "batch",
            "wealthbox",
            "/contacts",
            "/contacts?page=1",
            "northcrest-v1",
            "2026-07-11T00:00:00Z",
            b"{}".to_vec(),
        );
        let mut manifest =
            ImportArchiveManifest::new("batch", "wealthbox", "2026-07-11T00:00:00Z", "Northcrest");
        manifest
            .append(RawArchiveEntry {
                raw_record_ref: capture.raw_record_ref,
                source_type: SourceType::Contact,
                request_path: capture.request_path,
                source_locator: capture.source_locator,
                capture_layer_version: capture.capture_layer_version,
                fixture_corpus_identity: capture.fixture_corpus_identity,
                captured_at: capture.captured_at,
                response_sha256: capture.response_sha256,
                byte_length: capture.byte_length,
                typed_outcome: TypedOutcome::Rejected,
                target_entity_ref: None,
                skip_reason: Some("malformed source".into()),
                resulting_external_refs: vec![],
            })
            .unwrap();
        manifest.seal("2026-07-11T01:00:00Z").unwrap();
        assert!(manifest.append(manifest.records[0].clone()).is_err());
    }
}

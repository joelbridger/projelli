//! The D8 import landing pipeline and operator-local migration records.

use std::collections::BTreeMap;

use anyhow::bail;

use super::{
    archive::{
        ExternalRefProjection, ImportArchiveManifest, RawArchiveEntry, RawCapture, RawCaptureStore,
        RawRecordRef, TypedOutcome,
    },
    fetchers::{FetchedPage, SourceType, TypedSourceRecord},
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LandingResult {
    Landed {
        target_entity_ref: String,
        external_refs: Vec<ExternalRefProjection>,
    },
    Skipped {
        reason: String,
    },
    Rejected {
        reason: String,
    },
}

/// The encrypted entity/CRDT store and external_refs projection implement this
/// transaction seam. It keeps the four D8 steps together and prevents a
/// second importer idempotency key from appearing.
pub trait LandingStore {
    /// Resolves the canonical confidentiality scope. For Notes this must
    /// resolve every Contact link to a household and reject a partial or
    /// unauthorized set before the record can land.
    fn scope_for_record(&self, record: &TypedSourceRecord) -> anyhow::Result<String>;

    fn land_in_transaction(
        &mut self,
        record: &TypedSourceRecord,
        raw_record_ref: &RawRecordRef,
        external_ref: &ExternalRefProjection,
    ) -> anyhow::Result<LandingResult>;
}

#[derive(Debug, Clone)]
pub struct LandingContext {
    pub import_batch_id: String,
    pub provider: String,
    pub fixture_corpus_identity: String,
    pub captured_at: String,
}

pub struct ImportPipeline<'a, C: RawCaptureStore, L: LandingStore> {
    captures: &'a mut C,
    landing: &'a mut L,
    manifest: &'a mut ImportArchiveManifest,
    context: LandingContext,
}

impl<'a, C: RawCaptureStore, L: LandingStore> ImportPipeline<'a, C, L> {
    pub fn new(
        captures: &'a mut C,
        landing: &'a mut L,
        manifest: &'a mut ImportArchiveManifest,
        context: LandingContext,
    ) -> Self {
        Self {
            captures,
            landing,
            manifest,
            context,
        }
    }

    /// Saves the unedited response bytes before any typed record is parsed or
    /// landed. Each source record receives the page capture ref plus a locator
    /// that identifies its source id inside that response.
    pub fn land_page(&mut self, page: FetchedPage) -> anyhow::Result<Vec<LandingResult>> {
        let source_locator = page.raw_response.request_path.clone();
        let capture = RawCapture::new(
            &self.context.import_batch_id,
            &self.context.provider,
            &page.request_path,
            &source_locator,
            &self.context.fixture_corpus_identity,
            &self.context.captured_at,
            page.raw_response.response_bytes,
        );
        let raw_record_ref = capture.raw_record_ref.clone();
        self.captures.append(capture.clone())?;

        page.records
            .iter()
            .map(|record| self.land_record(record, &capture, &raw_record_ref))
            .collect()
    }

    fn land_record(
        &mut self,
        record: &TypedSourceRecord,
        capture: &RawCapture,
        raw_record_ref: &RawRecordRef,
    ) -> anyhow::Result<LandingResult> {
        let scope = self.landing.scope_for_record(record)?;
        let external_ref = ExternalRefProjection {
            provider: self.context.provider.clone(),
            source_type: record.source_type.as_str().to_string(),
            source_id: record.source_id.clone(),
            scope,
            // The store must replace this placeholder with the resolved target
            // before returning Landed; it is never persisted as-is.
            target_entity_ref: String::new(),
        };
        let result = self
            .landing
            .land_in_transaction(record, raw_record_ref, &external_ref)?;
        let (typed_outcome, target_entity_ref, skip_reason, resulting_external_refs) = match &result
        {
            LandingResult::Landed {
                target_entity_ref,
                external_refs,
            } => {
                if external_refs
                    .iter()
                    .any(|reference| reference.target_entity_ref.is_empty())
                {
                    bail!("landed external_refs require a target entity");
                }
                (
                    TypedOutcome::Landed,
                    Some(target_entity_ref.clone()),
                    None,
                    external_refs.clone(),
                )
            }
            LandingResult::Skipped { reason } => (
                TypedOutcome::Skipped,
                None,
                Some(reason.clone()),
                Vec::new(),
            ),
            LandingResult::Rejected { reason } => (
                TypedOutcome::Rejected,
                None,
                Some(reason.clone()),
                Vec::new(),
            ),
        };
        self.manifest.append(RawArchiveEntry {
            raw_record_ref: raw_record_ref.clone(),
            source_type: record.source_type,
            request_path: capture.request_path.clone(),
            source_locator: format!("{}#{}", capture.source_locator, record.source_id),
            capture_layer_version: capture.capture_layer_version.clone(),
            fixture_corpus_identity: capture.fixture_corpus_identity.clone(),
            captured_at: capture.captured_at.clone(),
            response_sha256: capture.response_sha256.clone(),
            byte_length: capture.byte_length,
            typed_outcome,
            target_entity_ref,
            skip_reason,
            resulting_external_refs,
        })?;
        Ok(result)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncrementalCursor {
    pub source_type: SourceType,
    pub updated_since: Option<String>,
    pub activity_cursor: Option<String>,
    pub last_incremental_sync_at: Option<String>,
    pub last_full_reconciliation_at: Option<String>,
    pub page_checkpoint: Option<usize>,
}

impl IncrementalCursor {
    pub fn next_query(&self) -> Option<&str> {
        if self.source_type == SourceType::Activity {
            self.activity_cursor.as_deref()
        } else {
            self.updated_since.as_deref()
        }
    }

    /// Only a full reconciliation may advance this timestamp, because it alone
    /// may tombstone source records missing from the complete listing.
    pub fn mark_complete(&mut self, completed_at: &str, full_reconciliation: bool) {
        self.last_incremental_sync_at = Some(completed_at.to_string());
        self.page_checkpoint = None;
        if full_reconciliation {
            self.last_full_reconciliation_at = Some(completed_at.to_string());
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteBackDisposition {
    RoundTrips { operation: &'static str },
    LanternOnly { reason: &'static str },
    ReadOnlyMirror { reason: &'static str },
    GuidedFallback { reason: &'static str },
}

pub fn parallel_run_field_registry(source_type: SourceType, field: &str) -> WriteBackDisposition {
    match (source_type, field) {
        (SourceType::Note, "create") => WriteBackDisposition::RoundTrips {
            operation: "POST /notes",
        },
        (SourceType::Task, "create") => WriteBackDisposition::RoundTrips {
            operation: "POST /tasks",
        },
        (SourceType::Contact, "background_information") => WriteBackDisposition::RoundTrips {
            operation: "PUT /contacts/{id}",
        },
        (SourceType::Opportunity | SourceType::Project, _) => {
            WriteBackDisposition::ReadOnlyMirror {
                reason: "No verified write-back path during parallel run",
            }
        }
        (SourceType::Workflow | SourceType::WorkflowStep | SourceType::WorkflowTemplate, _) => {
            WriteBackDisposition::GuidedFallback {
                reason: "Open workflow state is not an API import path",
            }
        }
        (_, _) => WriteBackDisposition::LanternOnly {
            reason: "This stays in Lantern until cutover",
        },
    }
}

/// Local-only rows from 02 section 1.21. They must be copied into a sealed
/// archive package and fidelity report, never a CRM CRDT document or relay message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MigrationChecklistItem {
    pub id: String,
    pub import_batch_id: String,
    pub legacy_project_ref: String,
    pub household_ref: Option<String>,
    pub source_template_label: Option<String>,
    pub activity_evidence_refs: Vec<String>,
    pub decision: ChecklistDecision,
    pub resulting_workflow_instance_ref: Option<String>,
    pub gap_reason: Option<String>,
    pub decided_at: Option<String>,
    pub decided_by: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChecklistDecision {
    Pending,
    Recreate,
    Gap,
    NotNeeded,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentAccountingRecord {
    pub id: String,
    pub import_batch_id: String,
    pub household_ref: String,
    pub status: AttachmentStatus,
    pub export_source: Option<String>,
    pub exported_at: Option<String>,
    pub exported_by: Option<String>,
    pub gap_reason: Option<String>,
    pub gap_owner_user_id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentStatus {
    Exported,
    Gap,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExportJob {
    pub id: String,
    pub import_batch_id: String,
    pub kind: ExportKind,
    pub status: ExportStatus,
    pub manifest_ref: Option<String>,
    pub fidelity_report_sha256: Option<String>,
    pub destination_label: Option<String>,
    pub failure_reason: Option<String>,
    pub started_at: String,
    pub started_by: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportKind {
    Archive,
    Rollback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportStatus {
    Preparing,
    Ready,
    Failed,
    Exported,
}

pub fn archive_job_can_export(
    job: &ExportJob,
    manifest: &ImportArchiveManifest,
    checklist_items: &[MigrationChecklistItem],
    attachment_records: &[AttachmentAccountingRecord],
) -> bool {
    job.kind == ExportKind::Archive
        && job.status == ExportStatus::Ready
        && manifest.finalized_at.is_some()
        && job.manifest_ref.is_some()
        && job.fidelity_report_sha256.is_some()
        && checklist_items
            .iter()
            .all(|item| item.import_batch_id == job.import_batch_id)
        && attachment_records
            .iter()
            .all(|item| item.import_batch_id == job.import_batch_id)
}

#[derive(Default)]
pub struct InMemoryMigrationOperations {
    pub checklist_items: BTreeMap<String, MigrationChecklistItem>,
    pub attachment_records: BTreeMap<String, AttachmentAccountingRecord>,
    pub export_jobs: BTreeMap<String, ExportJob>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::importer::archive::InMemoryRawCaptureStore;

    struct FakeLanding;
    impl LandingStore for FakeLanding {
        fn scope_for_record(&self, record: &TypedSourceRecord) -> anyhow::Result<String> {
            if record.source_type == SourceType::Note {
                return Ok(super::super::archive::household_scope_fingerprint(&[
                    "household:1".into(),
                    "household:2".into(),
                ]));
            }
            Ok(String::new())
        }

        fn land_in_transaction(
            &mut self,
            record: &TypedSourceRecord,
            _raw: &RawRecordRef,
            reference: &ExternalRefProjection,
        ) -> anyhow::Result<LandingResult> {
            Ok(LandingResult::Landed {
                target_entity_ref: format!("entity:{}", record.source_id),
                external_refs: vec![ExternalRefProjection {
                    target_entity_ref: format!("entity:{}", record.source_id),
                    ..reference.clone()
                }],
            })
        }
    }

    #[test]
    fn multi_household_note_is_one_landing_with_composite_scope() {
        let page = FetchedPage {
            source_type: SourceType::Note, request_path: "/notes".into(), page: Some(1), activity_cursor: None,
            raw_response: super::super::fetchers::RawHttpResponse { request_path: "/notes?page=1".into(), response_bytes: br#"{"status_updates":[{"id":7,"linked_to":[{"type":"Contact","id":2},{"type":"Contact","id":1}]}]}"#.to_vec() },
            records: vec![TypedSourceRecord { source_type: SourceType::Note, source_id: "7".into(), payload: serde_json::json!({"id": 7, "linked_to": [{"type": "Contact", "id": 2}, {"type": "Contact", "id": 1}]}) }],
        };
        let mut captures = InMemoryRawCaptureStore::default();
        let mut landing = FakeLanding;
        let mut manifest = ImportArchiveManifest::new("batch", "wealthbox", "now", "Northcrest");
        let mut pipeline = ImportPipeline::new(
            &mut captures,
            &mut landing,
            &mut manifest,
            LandingContext {
                import_batch_id: "batch".into(),
                provider: "wealthbox".into(),
                fixture_corpus_identity: "northcrest-v1".into(),
                captured_at: "now".into(),
            },
        );
        let results = pipeline.land_page(page).unwrap();
        assert!(matches!(&results[0], LandingResult::Landed { .. }));
        assert!(manifest.records[0].resulting_external_refs[0]
            .scope
            .starts_with("households:"));
    }

    #[test]
    fn only_full_reconciliation_sets_deletion_timestamp() {
        let mut cursor = IncrementalCursor {
            source_type: SourceType::Contact,
            updated_since: None,
            activity_cursor: None,
            last_incremental_sync_at: None,
            last_full_reconciliation_at: None,
            page_checkpoint: Some(2),
        };
        cursor.mark_complete("later", false);
        assert_eq!(cursor.last_full_reconciliation_at, None);
        cursor.mark_complete("nightly", true);
        assert_eq!(
            cursor.last_full_reconciliation_at.as_deref(),
            Some("nightly")
        );
    }

    #[test]
    fn projects_are_read_only_during_parallel_run() {
        assert!(matches!(
            parallel_run_field_registry(SourceType::Project, "title"),
            WriteBackDisposition::ReadOnlyMirror { .. }
        ));
    }
}

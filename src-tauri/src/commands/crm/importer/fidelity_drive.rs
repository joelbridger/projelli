//! Layer-4 migration-fidelity drive.
//!
//! `npm run test:fidelity` starts the fabricated-only Wealthbox simulator and
//! passes its base URL through `WBSIM_BASE_URL`. This drives the real HTTP
//! client, raw capture, typed fetchers, landing seam, external references,
//! sealed archive manifest, and fidelity report in one run.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::Result;

use crate::commands::crm::client::WealthboxClient;

use super::{
    archive::{
        household_scope_fingerprint, ExternalRefProjection, InMemoryRawCaptureStore,
        RawCaptureStore, RawRecordRef, TypedOutcome,
    },
    build_fidelity_report, fetch_activity_page, fetch_custom_fields_page, fetch_page,
    AttachmentAccountingRecord, AttachmentStatus, ImportArchiveManifest, ImportPipeline,
    LandingContext, LandingResult, LandingStore, RecordOutcome, RecordStatus, SourceType,
    TypedSourceRecord,
};

const FIXTURE_CORPUS_IDENTITY: &str = "northcrest-demo-20260711";
const FIRM_HOME: &str = "firm_home";

/// This is deliberately kept one-for-one with `tests/wbsim/corpus/manifest.ts`.
/// The simulator smoke test owns the TypeScript-side manifest validation; this
/// Rust drive owns the importer-side exact-count assertion.
const CORPUS_COUNTS: &[(SourceType, usize)] = &[
    (SourceType::Contact, 124),
    (SourceType::Note, 63),
    (SourceType::Task, 58),
    (SourceType::Event, 37),
    (SourceType::Opportunity, 25),
    (SourceType::Project, 16),
    (SourceType::WorkflowTemplate, 0),
    (SourceType::Workflow, 0),
    (SourceType::WorkflowStep, 0),
    (SourceType::CustomField, 3),
    (SourceType::Tag, 5),
    (SourceType::OpportunityStage, 0),
    (SourceType::ContactRole, 4),
    (SourceType::User, 4),
    (SourceType::Team, 2),
    (SourceType::CustomizableCategory, 4),
    (SourceType::Activity, 113),
];

const PAGED_SOURCES: &[SourceType] = &[
    SourceType::Contact,
    SourceType::Note,
    SourceType::Task,
    SourceType::Event,
    SourceType::Opportunity,
    SourceType::Project,
    SourceType::WorkflowTemplate,
    SourceType::Workflow,
    SourceType::WorkflowStep,
    SourceType::Tag,
    SourceType::OpportunityStage,
    SourceType::ContactRole,
    SourceType::User,
    SourceType::Team,
    SourceType::CustomizableCategory,
];

#[derive(Debug, Clone, PartialEq, Eq)]
struct FixtureEntity {
    kind: String,
    household_links: BTreeSet<String>,
    raw_stage_id: Option<String>,
    stage_label_missing: bool,
    read_only: bool,
}

#[derive(Default)]
struct FixtureLanding {
    /// Contact id -> importing household scope. This makes the fixture store
    /// exercise the same type-aware Contact-link boundary the real importer
    /// needs to protect.
    contact_scopes: BTreeMap<String, String>,
    entities: BTreeMap<String, FixtureEntity>,
    external_refs: BTreeMap<String, ExternalRefProjection>,
    active_client_source: BTreeMap<String, bool>,
}

impl FixtureLanding {
    fn source_key(source_type: SourceType, source_id: &str) -> String {
        format!("{}:{source_id}", source_type.as_str())
    }

    fn is_active_client_source(&self, source_type: SourceType, source_id: &str) -> bool {
        self.active_client_source
            .get(&Self::source_key(source_type, source_id))
            .copied()
            .unwrap_or(false)
    }

    fn contact_scope(record: &TypedSourceRecord) -> String {
        let payload = &record.payload;
        match payload.get("type").and_then(|value| value.as_str()) {
            Some("household") => format!("household:{}", record.source_id),
            Some("person") => payload
                .get("household")
                .and_then(|household| household.get("id"))
                .and_then(json_id)
                .map(|id| format!("household:{id}"))
                .unwrap_or_else(|| FIRM_HOME.to_string()),
            _ => FIRM_HOME.to_string(),
        }
    }

    fn contact_link_scopes(&self, record: &TypedSourceRecord) -> BTreeSet<String> {
        record
            .payload
            .get("linked_to")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .filter(|link| {
                link.get("type")
                    .and_then(|value| value.as_str())
                    .is_some_and(|kind| kind.eq_ignore_ascii_case("contact"))
            })
            .filter_map(|link| link.get("id").and_then(json_id))
            .filter_map(|id| self.contact_scopes.get(&id).cloned())
            .filter(|scope| scope != FIRM_HOME)
            .collect()
    }

    fn target_for(record: &TypedSourceRecord) -> (String, String) {
        let prefix = match record.source_type {
            SourceType::Contact => {
                match record.payload.get("type").and_then(|value| value.as_str()) {
                    Some("household") => "household",
                    _ => "person",
                }
            }
            SourceType::Note => "note",
            SourceType::Task => "task",
            SourceType::Event | SourceType::Activity => "activityEvent",
            SourceType::Opportunity => "opportunity",
            SourceType::Project => "legacyProject",
            SourceType::WorkflowTemplate => "workflowTemplate",
            SourceType::Workflow => "workflow",
            SourceType::WorkflowStep => "workflowStep",
            SourceType::CustomField => "customFieldDef",
            SourceType::Tag => "tag",
            SourceType::ContactRole => "contactRole",
            SourceType::User | SourceType::Team => "firmDirectoryEntry",
            SourceType::CustomizableCategory => "customizableCategory",
            SourceType::OpportunityStage => "stageDef",
            SourceType::Attachment => "attachmentAccounting",
        };
        (format!("{prefix}:{}", record.source_id), prefix.to_string())
    }

    fn active_link(record: &TypedSourceRecord, household_links: &BTreeSet<String>) -> bool {
        match record.source_type {
            SourceType::Contact => matches!(
                record.payload.get("type").and_then(|value| value.as_str()),
                Some("household") | Some("person")
            ),
            SourceType::Note | SourceType::Task | SourceType::Event | SourceType::Opportunity => {
                !household_links.is_empty()
            }
            _ => false,
        }
    }
}

impl LandingStore for FixtureLanding {
    fn scope_for_record(&self, record: &TypedSourceRecord) -> Result<String> {
        if record.source_type == SourceType::Contact {
            return Ok(Self::contact_scope(record));
        }
        let household_links = self.contact_link_scopes(record);
        if record.source_type == SourceType::Note && household_links.len() > 1 {
            return Ok(household_scope_fingerprint(
                &household_links.into_iter().collect::<Vec<_>>(),
            ));
        }
        Ok(household_links
            .into_iter()
            .next()
            .unwrap_or_else(|| FIRM_HOME.to_string()))
    }

    fn land_in_transaction(
        &mut self,
        record: &TypedSourceRecord,
        _raw_record_ref: &RawRecordRef,
        external_ref: &ExternalRefProjection,
    ) -> Result<LandingResult> {
        let household_links = self.contact_link_scopes(record);
        if record.source_type == SourceType::Note && household_links.is_empty() {
            self.active_client_source.insert(
                Self::source_key(record.source_type, &record.source_id),
                false,
            );
            return Ok(LandingResult::Skipped {
                reason: "no resolved household link".into(),
            });
        }

        let (target_entity_ref, kind) = Self::target_for(record);
        let ref_key = external_ref.key();
        if let Some(existing) = self.external_refs.get(&ref_key) {
            return Ok(LandingResult::Landed {
                target_entity_ref: existing.target_entity_ref.clone(),
                external_refs: vec![existing.clone()],
            });
        }

        if record.source_type == SourceType::Contact {
            self.contact_scopes
                .insert(record.source_id.clone(), Self::contact_scope(record));
        }

        let raw_stage_id = (record.source_type == SourceType::Opportunity)
            .then(|| record.payload.get("stage").and_then(json_id))
            .flatten();
        let stage_label_missing = record.source_type == SourceType::Opportunity
            && record
                .payload
                .get("stage_label_missing")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
        let entity = FixtureEntity {
            kind,
            household_links: household_links.clone(),
            raw_stage_id,
            stage_label_missing,
            read_only: record.source_type == SourceType::Project,
        };
        self.active_client_source.insert(
            Self::source_key(record.source_type, &record.source_id),
            Self::active_link(record, &household_links),
        );
        self.entities.insert(target_entity_ref.clone(), entity);
        let reference = ExternalRefProjection {
            target_entity_ref: target_entity_ref.clone(),
            ..external_ref.clone()
        };
        self.external_refs.insert(ref_key, reference.clone());
        Ok(LandingResult::Landed {
            target_entity_ref,
            external_refs: vec![reference],
        })
    }
}

fn json_id(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) if !value.is_empty() => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

#[derive(Debug)]
struct DriveRun {
    manifest: ImportArchiveManifest,
    outcomes: Vec<RecordOutcome>,
}

async fn land_page(
    captures: &mut InMemoryRawCaptureStore,
    landing: &mut FixtureLanding,
    manifest: &mut ImportArchiveManifest,
    batch_id: &str,
    page: super::FetchedPage,
) -> Result<()> {
    let mut pipeline = ImportPipeline::new(
        captures,
        landing,
        manifest,
        LandingContext {
            import_batch_id: batch_id.into(),
            provider: "wealthbox".into(),
            fixture_corpus_identity: FIXTURE_CORPUS_IDENTITY.into(),
            captured_at: "2026-07-11T00:00:00Z".into(),
        },
    );
    pipeline.land_page(page)?;
    Ok(())
}

async fn drive_full_import(
    client: &WealthboxClient,
    landing: &mut FixtureLanding,
    batch_id: &str,
) -> Result<DriveRun> {
    let mut captures = InMemoryRawCaptureStore::default();
    let mut manifest = ImportArchiveManifest::new(
        batch_id,
        "wealthbox",
        "2026-07-11T00:00:00Z",
        "DEMO Northcrest Advisory Practice — fabricated data only",
    );

    for source_type in PAGED_SOURCES {
        let mut page_number = 1;
        loop {
            let page = fetch_page(client, *source_type, page_number, None).await?;
            let record_count = page.records.len();
            land_page(&mut captures, landing, &mut manifest, batch_id, page).await?;
            if record_count < super::IMPORTER_PAGE_SIZE {
                break;
            }
            page_number += 1;
        }
    }

    let custom_fields = fetch_custom_fields_page(client, "Contact", 1).await?;
    land_page(
        &mut captures,
        landing,
        &mut manifest,
        batch_id,
        custom_fields,
    )
    .await?;

    let mut cursor = None;
    loop {
        let activity = fetch_activity_page(client, cursor.as_deref()).await?;
        let next_cursor = activity.next_cursor.clone();
        land_page(
            &mut captures,
            landing,
            &mut manifest,
            batch_id,
            activity.fetched,
        )
        .await?;
        match next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }

    for entry in &manifest.records {
        assert!(
            captures.get(&entry.raw_record_ref).is_some(),
            "every archive record must point to verbatim raw capture"
        );
        assert!(
            entry.byte_length > 0 && !entry.response_sha256.is_empty(),
            "every archive record must retain response checksum and byte count"
        );
    }

    let outcomes = manifest
        .records
        .iter()
        .map(|entry| {
            let source_id = entry
                .source_locator
                .rsplit('#')
                .next()
                .expect("manifest locator includes source id");
            RecordOutcome {
                source_type: entry.source_type,
                raw_record_ref: format!("{}#{}", entry.raw_record_ref.0, source_id),
                status: match entry.typed_outcome {
                    TypedOutcome::Landed => RecordStatus::Landed,
                    TypedOutcome::Skipped => RecordStatus::Skipped,
                    TypedOutcome::Rejected => RecordStatus::Rejected,
                },
                skip_reason: entry.skip_reason.clone(),
                linked_to_active_household: landing
                    .is_active_client_source(entry.source_type, source_id),
            }
        })
        .collect::<Vec<_>>();
    manifest.seal("2026-07-11T00:01:00Z")?;
    Ok(DriveRun { manifest, outcomes })
}

fn count_for(entries: &[RecordOutcome], source_type: SourceType) -> usize {
    entries
        .iter()
        .filter(|entry| entry.source_type == source_type)
        .count()
}

fn attachment_gaps() -> (Vec<String>, Vec<AttachmentAccountingRecord>) {
    let households = (1..=40)
        .map(|index| format!("household:{}", 10000 + index))
        .collect::<Vec<_>>();
    let records = households
        .iter()
        .map(|household_ref| AttachmentAccountingRecord {
            id: format!("attachment-gap:{household_ref}"),
            import_batch_id: "fidelity-run-1".into(),
            household_ref: household_ref.clone(),
            status: AttachmentStatus::Gap,
            export_source: None,
            exported_at: None,
            exported_by: None,
            gap_reason: Some("API read paths absent".into()),
            gap_owner_user_id: Some("demo-import-operator".into()),
        })
        .collect();
    (households, records)
}

/// Requires `WBSIM_BASE_URL`, supplied only by `npm run test:fidelity`.
/// A normal broad `cargo test` skips it rather than trying to contact anything.
#[tokio::test]
async fn wbsim_fidelity_drive_matches_the_frozen_matrix() -> Result<()> {
    let Ok(base_url) = std::env::var("WBSIM_BASE_URL") else {
        eprintln!("skipping wbsim fidelity drive; WBSIM_BASE_URL is not set");
        return Ok(());
    };
    let client = WealthboxClient::new_with_base("fabricated-token".into(), base_url);
    let mut landing = FixtureLanding::default();

    let first = drive_full_import(&client, &mut landing, "fidelity-run-1").await?;
    for (source_type, expected) in CORPUS_COUNTS {
        assert_eq!(
            count_for(&first.outcomes, *source_type),
            *expected,
            "{} fetched rows must exactly match the seeded corpus manifest",
            source_type.as_str()
        );
        let landed = first
            .outcomes
            .iter()
            .filter(|outcome| {
                outcome.source_type == *source_type && outcome.status == RecordStatus::Landed
            })
            .count();
        let disclosed_skip_or_rejection = first
            .outcomes
            .iter()
            .filter(|outcome| {
                outcome.source_type == *source_type && outcome.status != RecordStatus::Landed
            })
            .count();
        assert_eq!(
            landed + disclosed_skip_or_rejection,
            *expected,
            "{} must be landed or disclosed exactly once",
            source_type.as_str()
        );
        if *source_type != SourceType::Note {
            assert_eq!(
                landed,
                *expected,
                "{} has no fixture-approved skips and must land every fetched record",
                source_type.as_str()
            );
        }
    }
    assert_eq!(
        first.manifest.records.len(),
        CORPUS_COUNTS.iter().map(|(_, count)| count).sum::<usize>(),
        "the sealed archive manifest must index every fetched source record exactly once"
    );
    assert!(
        first.manifest.finalized_at.is_some() && first.manifest.manifest_sha256.is_some(),
        "the raw archive manifest must be sealed before fidelity scoring"
    );
    for entry in &first.manifest.records {
        for external_ref in &entry.resulting_external_refs {
            assert_eq!(
                landing.external_refs.get(&external_ref.key()),
                Some(external_ref),
                "every landed row must have the canonical external_refs projection"
            );
        }
    }

    let (affected_attachment_households, attachment_records) = attachment_gaps();
    let report = build_fidelity_report(
        "2026-07-11T00:02:00Z",
        "fidelity-run-1",
        first
            .manifest
            .manifest_sha256
            .as_deref()
            .expect("sealed manifest hash"),
        Some("2026-07-11T00:01:00Z".into()),
        Some("2026-07-11T00:01:00Z".into()),
        &first.outcomes,
        &affected_attachment_households,
        &attachment_records,
        &[],
    );
    assert!(
        report.failures.is_empty() && report.matters_complete,
        "client records must be 100% complete: {:?}",
        report.failures
    );
    assert!(report.attachment_accounting_complete);
    assert!(report.in_flight_workflows_complete);

    let skipped = first
        .outcomes
        .iter()
        .filter(|outcome| outcome.status != RecordStatus::Landed)
        .collect::<Vec<_>>();
    assert_eq!(
        skipped.len(),
        1,
        "the collision fixture is the only disclosed skip"
    );
    assert_eq!(skipped[0].source_type, SourceType::Note);
    assert_eq!(
        skipped[0].skip_reason.as_deref(),
        Some("no resolved household link")
    );
    assert_eq!(
        report
            .per_type
            .get("note")
            .expect("note report row")
            .skip_reason_counts
            .get("no resolved household link"),
        Some(&1),
        "every skip must use a matrix-approved reason"
    );

    let notes = landing
        .entities
        .iter()
        .filter(|(_, entity)| entity.kind == "note")
        .collect::<Vec<_>>();
    assert_eq!(
        notes.len(),
        62,
        "one unresolved collision note is disclosed, not duplicated"
    );
    assert!(
        notes
            .iter()
            .any(|(_, entity)| entity.household_links.len() > 1),
        "a multi-household source note must remain one Note with householdLinks"
    );
    assert!(
        notes
            .iter()
            .all(|(_, entity)| !entity.household_links.is_empty()),
        "landed notes must retain every resolved household link"
    );

    let opportunities = landing
        .entities
        .values()
        .filter(|entity| entity.kind == "opportunity")
        .collect::<Vec<_>>();
    assert_eq!(opportunities.len(), 25);
    assert!(
        opportunities.iter().all(|entity| {
            entity.raw_stage_id.as_deref() == Some("1169841") && entity.stage_label_missing
        }),
        "opportunities must preserve their raw stage ids and flag every missing label"
    );
    assert_eq!(
        opportunities
            .iter()
            .filter(|entity| entity.stage_label_missing)
            .count(),
        25
    );

    let projects = landing
        .entities
        .iter()
        .filter(|(_, entity)| entity.kind == "legacyProject")
        .collect::<Vec<_>>();
    assert_eq!(projects.len(), 16);
    assert!(
        projects.iter().all(|(id, entity)| {
            entity.read_only
                && landing.external_refs.values().any(|reference| {
                    reference.target_entity_ref == **id && reference.scope == FIRM_HOME
                })
        }),
        "unlinked projects must land as read-only LegacyProject records at firm home"
    );

    assert_eq!(
        attachment_records
            .iter()
            .filter(|record| record.status == AttachmentStatus::Gap)
            .count(),
        40,
        "attachments are 0%-via-API but every affected household must have an explicit gap"
    );

    let entities_before_rerun = landing.entities.clone();
    let refs_before_rerun = landing.external_refs.clone();
    let second = drive_full_import(&client, &mut landing, "fidelity-run-2").await?;
    assert_eq!(
        landing.entities, entities_before_rerun,
        "an immediate re-import must create or change no entities"
    );
    assert_eq!(
        landing.external_refs, refs_before_rerun,
        "an immediate re-import must create or change no external_refs"
    );
    for (source_type, expected) in CORPUS_COUNTS {
        assert_eq!(count_for(&second.outcomes, *source_type), *expected);
    }

    // This is intentionally last: it exposes the present importer bug without
    // hiding the rest of the end-to-end evidence above. A report must render
    // every canonical matrix row, including zero-fetched types and the
    // 0%-via-API attachments row, or a reviewer cannot see those boundaries.
    for source_type in [
        SourceType::WorkflowTemplate,
        SourceType::Workflow,
        SourceType::Attachment,
    ] {
        assert!(
            report.per_type.contains_key(source_type.as_str()),
            "BUG: fidelity report omits the required zero-count {} matrix row",
            source_type.as_str()
        );
    }

    Ok(())
}

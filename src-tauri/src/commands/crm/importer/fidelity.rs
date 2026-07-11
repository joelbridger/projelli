//! Canonical fidelity matrix and durable migration report calculation.

use std::collections::{BTreeMap, BTreeSet};

use super::{
    fetchers::SourceType,
    pipeline::{
        AttachmentAccountingRecord, AttachmentStatus, ChecklistDecision, MigrationChecklistItem,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Completeness {
    AllResolvedActive,
    AllResolvedLinks,
    Parseable,
    ProvenSupportedShapes,
    AttachmentAccounting,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatrixRule {
    pub source_type: SourceType,
    pub target: &'static str,
    pub completeness: Completeness,
    pub allowed_skip_reasons: &'static [&'static str],
    pub matters_when_linked_to_active_household: bool,
}

const MALFORMED: &str = "malformed source";
pub const FIDELITY_MATRIX: &[MatrixRule] = &[
    MatrixRule { source_type: SourceType::Contact, target: "Household, Person, Person.personType, household membership", completeness: Completeness::AllResolvedActive, allowed_skip_reasons: &[MALFORMED, "unsupported source type", "unresolved required household link"], matters_when_linked_to_active_household: true },
    MatrixRule { source_type: SourceType::Note, target: "One Note with householdLinks[]", completeness: Completeness::AllResolvedLinks, allowed_skip_reasons: &[MALFORMED, "no resolved household link", "partial/missing household-link set", "confidentiality intersection cannot be established"], matters_when_linked_to_active_household: true },
    MatrixRule { source_type: SourceType::Task, target: "Canonical Task", completeness: Completeness::AllResolvedLinks, allowed_skip_reasons: &[MALFORMED, "unresolved required household link", "unsupported subtask shape"], matters_when_linked_to_active_household: true },
    MatrixRule { source_type: SourceType::Event, target: "ActivityEvent", completeness: Completeness::AllResolvedLinks, allowed_skip_reasons: &[MALFORMED, "unresolved required household link"], matters_when_linked_to_active_household: true },
    MatrixRule { source_type: SourceType::Opportunity, target: "Opportunity linked to PipelineDef/StageDef", completeness: Completeness::AllResolvedActive, allowed_skip_reasons: &[MALFORMED, "missing required stage-category reference", "unresolved required household link", "stage value shape unverified pending seeded re-probe"], matters_when_linked_to_active_household: true },
    MatrixRule { source_type: SourceType::Project, target: "LegacyProject", completeness: Completeness::Parseable, allowed_skip_reasons: &[MALFORMED, "unresolved required link"], matters_when_linked_to_active_household: false },
    MatrixRule { source_type: SourceType::WorkflowTemplate, target: "WorkflowTemplate", completeness: Completeness::Parseable, allowed_skip_reasons: &[MALFORMED, "unsupported source shape"], matters_when_linked_to_active_household: false },
    MatrixRule { source_type: SourceType::Workflow, target: "New Lantern workflow instance created by operator at cutover", completeness: Completeness::AllResolvedLinks, allowed_skip_reasons: &[MALFORMED, "guided manual re-creation fallback required because /workflow_instances is absent and populated current state is unverified", "unresolved required link"], matters_when_linked_to_active_household: false },
    MatrixRule { source_type: SourceType::CustomField, target: "Field inventory plus typed target field/provenance", completeness: Completeness::ProvenSupportedShapes, allowed_skip_reasons: &[MALFORMED, "unsupported field type", "populated definition/value shape unverified pending seeded re-probe"], matters_when_linked_to_active_household: false },
    MatrixRule { source_type: SourceType::Tag, target: "Firm lookup/read model and entity labels", completeness: Completeness::Parseable, allowed_skip_reasons: &[MALFORMED, "unresolved registry reference"], matters_when_linked_to_active_household: false },
    MatrixRule { source_type: SourceType::ContactRole, target: "Person.roles[] and HouseholdMember.role", completeness: Completeness::Parseable, allowed_skip_reasons: &[MALFORMED, "role has no supported target scope"], matters_when_linked_to_active_household: false },
    MatrixRule { source_type: SourceType::User, target: "FirmDirectoryEntry read model", completeness: Completeness::Parseable, allowed_skip_reasons: &[MALFORMED], matters_when_linked_to_active_household: false },
    MatrixRule { source_type: SourceType::Team, target: "FirmDirectoryEntry read model", completeness: Completeness::Parseable, allowed_skip_reasons: &[MALFORMED], matters_when_linked_to_active_household: false },
    MatrixRule { source_type: SourceType::Activity, target: "ActivityEvent timeline record", completeness: Completeness::Parseable, allowed_skip_reasons: &[MALFORMED, "unsupported activity subtype"], matters_when_linked_to_active_household: false },
    MatrixRule { source_type: SourceType::Attachment, target: "No API migration target; operator exported-or-gap accounting", completeness: Completeness::AttachmentAccounting, allowed_skip_reasons: &["API read paths absent", "operator export unavailable", "attachment gap remains open"], matters_when_linked_to_active_household: false },
];

pub fn matrix_rule(source_type: SourceType) -> Option<&'static MatrixRule> {
    FIDELITY_MATRIX
        .iter()
        .find(|rule| rule.source_type == source_type)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordOutcome {
    pub source_type: SourceType,
    pub raw_record_ref: String,
    pub status: RecordStatus,
    pub skip_reason: Option<String>,
    pub linked_to_active_household: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordStatus {
    Landed,
    Skipped,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TypeFidelity {
    pub fetched: usize,
    pub imported: usize,
    pub skipped: usize,
    pub rejected: usize,
    pub skip_reason_counts: BTreeMap<String, usize>,
    pub raw_record_refs: Vec<String>,
    /// Present only on the attachments matrix row. These counts deliberately
    /// describe the operator-export boundary rather than pretending the rows
    /// were fetched through an API.
    pub attachment_accounting: Option<AttachmentAccountingFidelity>,
    /// Present only on the open-workflow matrix row. An in-flight workflow has
    /// no API-imported state: the checklist is the truthful migration result.
    pub workflow_recreation: Option<WorkflowRecreationFidelity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct AttachmentAccountingFidelity {
    pub affected_households: usize,
    pub exported_households: usize,
    pub gap_households: usize,
    pub unaccounted_households: usize,
    pub reason_counts: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WorkflowRecreationFidelity {
    pub checklist_rows: usize,
    pub pending: usize,
    pub recreated: usize,
    pub gaps: usize,
    pub not_needed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FidelityReport {
    pub generated_at: String,
    pub import_batch_id: String,
    pub manifest_sha256: String,
    pub last_incremental_sync_at: Option<String>,
    pub last_full_reconciliation_at: Option<String>,
    pub per_type: BTreeMap<String, TypeFidelity>,
    pub matters_complete: bool,
    pub attachment_accounting_complete: bool,
    pub in_flight_workflows_complete: bool,
    pub failures: Vec<String>,
}

pub fn build_fidelity_report(
    generated_at: &str,
    import_batch_id: &str,
    manifest_sha256: &str,
    last_incremental_sync_at: Option<String>,
    last_full_reconciliation_at: Option<String>,
    outcomes: &[RecordOutcome],
    affected_attachment_households: &[String],
    attachments: &[AttachmentAccountingRecord],
    checklists: &[MigrationChecklistItem],
) -> FidelityReport {
    // The report is the migration boundary's honest ledger, not a list of
    // whichever API collections happened to be non-empty. Seed it from the
    // frozen matrix so zero-fetched types (especially attachments and empty
    // workflow templates) remain visible to a reviewer.
    let mut per_type = FIDELITY_MATRIX
        .iter()
        .map(|rule| {
            (
                rule.source_type.as_str().to_string(),
                TypeFidelity {
                    // Show the complete allowed-reason breakdown even when a
                    // reason's count is zero. That prevents a row from
                    // concealing a permitted migration boundary.
                    skip_reason_counts: rule
                        .allowed_skip_reasons
                        .iter()
                        .map(|reason| ((*reason).to_string(), 0))
                        .collect(),
                    ..Default::default()
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let mut failures = Vec::new();

    for outcome in outcomes {
        let entry = per_type
            .entry(outcome.source_type.as_str().to_string())
            .or_default();
        entry.fetched += 1;
        entry.raw_record_refs.push(outcome.raw_record_ref.clone());
        match outcome.status {
            RecordStatus::Landed => entry.imported += 1,
            RecordStatus::Skipped | RecordStatus::Rejected => {
                if outcome.status == RecordStatus::Skipped {
                    entry.skipped += 1;
                } else {
                    entry.rejected += 1;
                }
                match (&outcome.skip_reason, matrix_rule(outcome.source_type)) {
                    (Some(reason), Some(rule))
                        if rule.allowed_skip_reasons.contains(&reason.as_str()) =>
                    {
                        *entry.skip_reason_counts.entry(reason.clone()).or_default() += 1;
                    }
                    (Some(reason), _) => failures.push(format!(
                        "{} has unapproved skip reason: {}",
                        outcome.raw_record_ref, reason
                    )),
                    (None, _) => failures.push(format!(
                        "{} was not landed without exactly one reason",
                        outcome.raw_record_ref
                    )),
                }
            }
        }
        if outcome.linked_to_active_household && outcome.status != RecordStatus::Landed {
            failures.push(format!(
                "active-client record {} was not imported",
                outcome.raw_record_ref
            ));
        }
    }

    let affected_households = affected_attachment_households
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let attachment_rule = matrix_rule(SourceType::Attachment)
        .expect("the frozen fidelity matrix must include attachments");
    let mut attachment_statuses = BTreeMap::new();
    let mut attachment_reason_counts = attachment_rule
        .allowed_skip_reasons
        .iter()
        .map(|reason| ((*reason).to_string(), 0))
        .collect::<BTreeMap<_, _>>();
    for record in attachments {
        attachment_statuses.insert(record.household_ref.clone(), record.status);
        if record.status == AttachmentStatus::Gap {
            match &record.gap_reason {
                Some(reason)
                    if attachment_rule
                        .allowed_skip_reasons
                        .contains(&reason.as_str()) =>
                {
                    *attachment_reason_counts.entry(reason.clone()).or_default() += 1;
                }
                Some(reason) => failures.push(format!(
                    "attachment accounting {} has unapproved skip reason: {}",
                    record.id, reason
                )),
                None => failures.push(format!(
                    "attachment accounting {} has a gap without exactly one reason",
                    record.id
                )),
            }
        }
    }
    let exported_households = affected_households
        .iter()
        .filter(|household| {
            attachment_statuses.get(*household) == Some(&AttachmentStatus::Exported)
        })
        .count();
    let gap_households = affected_households
        .iter()
        .filter(|household| attachment_statuses.get(*household) == Some(&AttachmentStatus::Gap))
        .count();
    let unaccounted_households = affected_households
        .iter()
        .filter(|household| !attachment_statuses.contains_key(*household))
        .count();
    let attachment_accounting_complete = unaccounted_households == 0;
    if !attachment_accounting_complete {
        failures.push("an affected household has no exported-or-gap attachment accounting".into());
    }

    let mut workflow_recreation = WorkflowRecreationFidelity {
        checklist_rows: checklists.len(),
        ..Default::default()
    };
    for item in checklists {
        match item.decision {
            ChecklistDecision::Pending => workflow_recreation.pending += 1,
            ChecklistDecision::Recreate => workflow_recreation.recreated += 1,
            ChecklistDecision::Gap => workflow_recreation.gaps += 1,
            ChecklistDecision::NotNeeded => workflow_recreation.not_needed += 1,
        }
    }
    let in_flight_workflows_complete = workflow_recreation.pending == 0;
    if !in_flight_workflows_complete {
        failures.push("an in-flight workflow has no recorded operator decision".into());
    }

    // Both rows exist even with zero fetched API records. Their specialised
    // details make the non-API migration work inspectable instead of silently
    // reducing it to an empty count.
    per_type
        .get_mut(SourceType::Attachment.as_str())
        .expect("the frozen fidelity matrix must seed the attachments row")
        .attachment_accounting = Some(AttachmentAccountingFidelity {
        affected_households: affected_households.len(),
        exported_households,
        gap_households,
        unaccounted_households,
        reason_counts: attachment_reason_counts,
    });
    per_type
        .get_mut(SourceType::Workflow.as_str())
        .expect("the frozen fidelity matrix must seed the workflow row")
        .workflow_recreation = Some(workflow_recreation);

    let matters_complete = !outcomes.iter().any(|outcome| {
        outcome.linked_to_active_household && outcome.status != RecordStatus::Landed
    });
    FidelityReport {
        generated_at: generated_at.into(),
        import_batch_id: import_batch_id.into(),
        manifest_sha256: manifest_sha256.into(),
        last_incremental_sync_at,
        last_full_reconciliation_at,
        per_type,
        matters_complete,
        attachment_accounting_complete,
        in_flight_workflows_complete,
        failures,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_client_skip_fails_even_when_reason_is_allowed() {
        let report = build_fidelity_report(
            "now",
            "batch",
            "hash",
            None,
            None,
            &[RecordOutcome {
                source_type: SourceType::Task,
                raw_record_ref: "raw:1".into(),
                status: RecordStatus::Skipped,
                skip_reason: Some("unresolved required household link".into()),
                linked_to_active_household: true,
            }],
            &[],
            &[],
            &[],
        );
        assert!(!report.matters_complete);
        assert!(report
            .failures
            .iter()
            .any(|failure| failure.contains("active-client")));
    }

    #[test]
    fn unknown_skip_reason_is_never_silent() {
        let report = build_fidelity_report(
            "now",
            "batch",
            "hash",
            None,
            None,
            &[RecordOutcome {
                source_type: SourceType::Project,
                raw_record_ref: "raw:1".into(),
                status: RecordStatus::Rejected,
                skip_reason: Some("made up".into()),
                linked_to_active_household: false,
            }],
            &[],
            &[],
            &[],
        );
        assert!(report
            .failures
            .iter()
            .any(|failure| failure.contains("unapproved skip reason")));
    }

    #[test]
    fn seeds_every_frozen_matrix_row_with_zero_counts_and_allowed_reasons() {
        let report = build_fidelity_report("now", "batch", "hash", None, None, &[], &[], &[], &[]);

        for rule in FIDELITY_MATRIX {
            let row = report
                .per_type
                .get(rule.source_type.as_str())
                .expect("every canonical matrix rule has a report row");
            assert_eq!(row.fetched, 0);
            assert_eq!(row.imported, 0);
            for reason in rule.allowed_skip_reasons {
                assert_eq!(row.skip_reason_counts.get(*reason), Some(&0));
            }
        }
    }

    #[test]
    fn attachment_and_workflow_rows_disclose_non_api_accounting() {
        let report = build_fidelity_report(
            "now",
            "batch",
            "hash",
            None,
            None,
            &[],
            &["household:1".into(), "household:2".into()],
            &[
                AttachmentAccountingRecord {
                    id: "attachment:1".into(),
                    import_batch_id: "batch".into(),
                    household_ref: "household:1".into(),
                    status: AttachmentStatus::Exported,
                    export_source: Some("operator export".into()),
                    exported_at: Some("now".into()),
                    exported_by: Some("operator".into()),
                    gap_reason: None,
                    gap_owner_user_id: None,
                },
                AttachmentAccountingRecord {
                    id: "attachment:2".into(),
                    import_batch_id: "batch".into(),
                    household_ref: "household:2".into(),
                    status: AttachmentStatus::Gap,
                    export_source: None,
                    exported_at: None,
                    exported_by: None,
                    gap_reason: Some("API read paths absent".into()),
                    gap_owner_user_id: Some("operator".into()),
                },
            ],
            &[MigrationChecklistItem {
                id: "workflow:1".into(),
                import_batch_id: "batch".into(),
                legacy_project_ref: "legacy:1".into(),
                household_ref: Some("household:1".into()),
                source_template_label: Some("Annual review".into()),
                activity_evidence_refs: vec!["raw:1".into()],
                decision: ChecklistDecision::Recreate,
                resulting_workflow_instance_ref: Some("workflow:1".into()),
                gap_reason: None,
                decided_at: Some("now".into()),
                decided_by: Some("operator".into()),
            }],
        );

        let attachments = report
            .per_type
            .get(SourceType::Attachment.as_str())
            .and_then(|row| row.attachment_accounting.as_ref())
            .expect("attachments row includes export-or-gap accounting");
        assert_eq!(attachments.affected_households, 2);
        assert_eq!(attachments.exported_households, 1);
        assert_eq!(attachments.gap_households, 1);
        assert_eq!(attachments.unaccounted_households, 0);
        assert_eq!(
            attachments.reason_counts.get("API read paths absent"),
            Some(&1)
        );

        let workflows = report
            .per_type
            .get(SourceType::Workflow.as_str())
            .and_then(|row| row.workflow_recreation.as_ref())
            .expect("workflow row includes guided-recreation checklist accounting");
        assert_eq!(workflows.checklist_rows, 1);
        assert_eq!(workflows.recreated, 1);
        assert_eq!(workflows.pending, 0);
    }
}

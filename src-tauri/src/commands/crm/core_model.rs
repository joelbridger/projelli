//! Typed CRM-core document wrappers.  Their JSON is the CRDT projection payload;
//! SQLCipher is only a rebuildable local index (design/02 §3.1).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActorRef {
    pub user_id: String,
    pub seat: Option<String>,
    pub display: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct HlcStamp {
    pub wall_millis: i64,
    pub logical_counter: u32,
    pub actor_id: String,
    pub operation_id: String,
}

impl Ord for HlcStamp {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (
            self.wall_millis,
            self.logical_counter,
            &self.actor_id,
            &self.operation_id,
        )
            .cmp(&(
                other.wall_millis,
                other.logical_counter,
                &other.actor_id,
                &other.operation_id,
            ))
    }
}
impl PartialOrd for HlcStamp {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrmBaseRecord {
    pub id: String,
    pub kind: String,
    pub matter_id: String,
    pub created_at: String,
    pub created_by: ActorRef,
    pub updated_at: String,
    pub updated_by: ActorRef,
    pub source: Value,
    pub deleted: bool,
    pub external_refs: Vec<Value>,
    pub raw_record_ref: Option<Value>,
    pub schema_version: u32,
}

/// Every named CRM entity has a concrete Rust wrapper.  The fields following
/// `base` are intentionally kept as a serde object: it preserves forward
/// compatible CRDT fields exactly while the typed wrapper protects entity kind,
/// identity, scope, tombstones, and JSON access at the storage boundary.
macro_rules! core_entity {
    ($name:ident, $kind:literal) => {
        #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
        #[serde(rename_all = "camelCase")]
        pub struct $name {
            #[serde(flatten)]
            pub base: CrmBaseRecord,
            #[serde(flatten)]
            pub fields: Map<String, Value>,
        }
        impl $name {
            pub const KIND: &'static str = $kind;
            pub fn id(&self) -> &str {
                &self.base.id
            }
            pub fn matter_id(&self) -> &str {
                &self.base.matter_id
            }
            pub fn deleted(&self) -> bool {
                self.base.deleted
            }
            pub fn field(&self, key: &str) -> Option<&Value> {
                self.fields.get(key)
            }
            pub fn into_json(self) -> Value {
                serde_json::to_value(self).expect("CRM entity serializes")
            }
        }
    };
}
core_entity!(Household, "household");
core_entity!(Person, "person");
core_entity!(Account, "account");
core_entity!(Fact, "fact");
core_entity!(Note, "note");
core_entity!(Task, "task");
core_entity!(WorkflowTemplate, "workflowTemplate");
core_entity!(WorkflowInstance, "workflowInstance");
core_entity!(ServicePolicy, "servicePolicy");
core_entity!(ActivityEvent, "activityEvent");
core_entity!(FirmDoc, "firmDoc");
core_entity!(Tag, "tag");
core_entity!(CustomFieldDef, "customFieldDef");
core_entity!(Opportunity, "opportunity");
core_entity!(PipelineDef, "pipelineDef");
core_entity!(StageDef, "stageDef");
core_entity!(ProposalRecord, "proposalRecord");
core_entity!(Project, "project");
core_entity!(LegacyProject, "legacyProject");
core_entity!(FirmDirectoryEntry, "firmDirectoryEntry");
core_entity!(HouseholdDirectoryShell, "householdDirectoryShell");
core_entity!(IntakeLink, "intakeLink");
core_entity!(IntakeSubmission, "intakeSubmission");
core_entity!(ImportArchiveManifest, "importArchiveManifest");
core_entity!(SavedView, "savedView");

/// Generic live-record wrapper. Feature kinds remain data, rather than enum
/// branches in this central model. Features that need stricter validation or a
/// SQL projection register a descriptor beside their native implementation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CrmEntity {
    #[serde(flatten)]
    pub base: CrmBaseRecord,
    #[serde(flatten)]
    pub fields: Map<String, Value>,
}

impl CrmEntity {
    pub fn kind(&self) -> &str {
        self.base.kind.as_str()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CompletionOperation {
    pub completion_id: String,
    pub step_id: String,
    pub completed_at: String,
    pub completed_by: ActorRef,
    pub outcome: Option<String>,
    pub source_operation_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentOperation {
    pub assignment_id: String,
    pub step_id: String,
    pub assigned_user_id: Option<String>,
    pub assigned_at: String,
    pub assigned_by: ActorRef,
    pub source_operation_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PropagationDecision {
    pub instance_id: String,
    pub revision_id: String,
    pub step_id: String,
    pub field: String,
    pub decision: String,
    pub source_operation_id: String,
    pub supersedes_decision_key: Option<String>,
    pub reoffer_state: String,
    pub json: Value,
}

/// The four approval-gated mutations are explicit so an AI cannot smuggle an
/// unrecognised external write through the durable proposal queue.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProposalMutation {
    WorkflowLaunch { workflow_template_id: String },
    TaskCreate { task: Value },
    FactAdd { fact: Value },
    CommunicationDraft { draft_ref: Value },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RawArchiveEntry {
    pub raw_record_id: String,
    pub request_path: String,
    pub capture_layer_version: String,
    pub fixture_corpus_identity: String,
    pub captured_at: String,
    pub response_sha256: String,
    pub byte_length: u64,
    pub typed_outcome: String,
    pub target_entity_ref: Option<Value>,
    pub skip_reason: Option<String>,
    pub resulting_external_refs: Vec<Value>,
}

/// These three records are deliberately local-only. They have no CrmBase,
/// document stream, or relay serialization route; their sealed archive copy is
/// the cross-device compliance artifact.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct MigrationChecklistItem {
    pub id: String,
    pub import_batch_id: String,
    pub legacy_project_ref: Value,
    pub household_ref: Option<Value>,
    pub source_template_label: Option<String>,
    pub activity_evidence_refs: Vec<Value>,
    pub decision: String,
    pub resulting_workflow_instance_ref: Option<Value>,
    pub gap_reason: Option<String>,
    pub decided_at: Option<String>,
    pub decided_by: Option<ActorRef>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentAccountingRecord {
    pub id: String,
    pub import_batch_id: String,
    pub household_ref: Value,
    pub status: String,
    pub export_source: Option<String>,
    pub exported_at: Option<String>,
    pub exported_by: Option<ActorRef>,
    pub gap_reason: Option<String>,
    pub gap_owner_user_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportJob {
    pub id: String,
    pub import_batch_id: String,
    pub kind: String,
    pub status: String,
    pub manifest_ref: Option<Value>,
    pub fidelity_report_sha256: Option<String>,
    pub destination_label: Option<String>,
    pub failure_reason: Option<String>,
    pub started_at: String,
    pub started_by: ActorRef,
    pub finished_at: Option<String>,
}

/// Derived-only workflow display. The append-only operations remain the truth;
/// invalid/quarantined candidates are omitted by the caller before this order is
/// applied. Ties intentionally fall through to the immutable operation id.
pub fn displayed_completion<'a>(
    operations: impl IntoIterator<Item = (&'a CompletionOperation, &'a HlcStamp)>,
) -> Option<&'a CompletionOperation> {
    operations
        .into_iter()
        .max_by(|(left, left_stamp), (right, right_stamp)| {
            left_stamp
                .cmp(right_stamp)
                .then_with(|| left.source_operation_id.cmp(&right.source_operation_id))
        })
        .map(|(operation, _)| operation)
}
pub fn displayed_assignment<'a>(
    operations: impl IntoIterator<Item = (&'a AssignmentOperation, &'a HlcStamp)>,
) -> Option<&'a AssignmentOperation> {
    operations
        .into_iter()
        .max_by(|(left, left_stamp), (right, right_stamp)| {
            left_stamp
                .cmp(right_stamp)
                .then_with(|| left.source_operation_id.cmp(&right.source_operation_id))
        })
        .map(|(operation, _)| operation)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generic_entity_accepts_a_new_kind_without_an_enum_branch() {
        let entity: CrmEntity = serde_json::from_value(serde_json::json!({
            "id": "future-1",
            "kind": "futureFeature",
            "matterId": "client-1",
            "createdAt": "2026-07-15T00:00:00Z",
            "createdBy": {"userId":"u1","seat":null,"display":"User","kind":"user"},
            "updatedAt": "2026-07-15T00:00:00Z",
            "updatedBy": {"userId":"u1","seat":null,"display":"User","kind":"user"},
            "source": {"kind":"manual"},
            "deleted": false,
            "externalRefs": [],
            "rawRecordRef": null,
            "schemaVersion": 1,
            "featurePayload": {"kept": true}
        }))
        .unwrap();

        assert_eq!(entity.kind(), "futureFeature");
        assert_eq!(entity.fields["featurePayload"]["kept"], true);
    }

    #[test]
    fn hlc_orders_actor_and_operation_after_time() {
        let low = HlcStamp {
            wall_millis: 1,
            logical_counter: 2,
            actor_id: "a".into(),
            operation_id: "1".into(),
        };
        let high = HlcStamp {
            actor_id: "b".into(),
            ..low.clone()
        };
        assert!(high > low);
    }

    #[test]
    fn completion_projection_uses_hlc_not_completion_time() {
        let actor = ActorRef {
            user_id: "u".into(),
            seat: None,
            display: "U".into(),
            kind: "user".into(),
        };
        let early = CompletionOperation {
            completion_id: "old".into(),
            step_id: "s".into(),
            completed_at: "later".into(),
            completed_by: actor.clone(),
            outcome: None,
            source_operation_id: "a".into(),
        };
        let late = CompletionOperation {
            completion_id: "new".into(),
            step_id: "s".into(),
            completed_at: "earlier".into(),
            completed_by: actor,
            outcome: None,
            source_operation_id: "b".into(),
        };
        let stamp1 = HlcStamp {
            wall_millis: 1,
            logical_counter: 0,
            actor_id: "a".into(),
            operation_id: "a".into(),
        };
        let stamp2 = HlcStamp {
            wall_millis: 2,
            logical_counter: 0,
            actor_id: "a".into(),
            operation_id: "b".into(),
        };
        assert_eq!(
            displayed_completion([(&early, &stamp1), (&late, &stamp2)])
                .unwrap()
                .completion_id,
            "new"
        );
    }
}

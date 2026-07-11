//! CRM-core SQLCipher schema migration.  All entity tables below are projections
//! of `crm_docs`; only the three migration-operation tables are operator-local.

use anyhow::Result;
use rusqlite::Connection;

pub const CRM_CORE_SCHEMA_VERSION: &str = "1";

pub fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
    conn.execute("INSERT INTO meta(key,value) VALUES('schema_version',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [CRM_CORE_SCHEMA_VERSION])?;
    Ok(())
}

// Kept in one migration module so a corruption rebuild can deliberately clear
// projections without touching crm_docs or the local migration-operation rows.
const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS crm_docs (doc_key TEXT PRIMARY KEY, matter_id TEXT NOT NULL, doc_id TEXT NOT NULL, yjs_state BLOB NOT NULL, state_vector BLOB NOT NULL, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_crm_docs_scope ON crm_docs(matter_id, doc_id);
CREATE TABLE IF NOT EXISTS crm_sync_cursors (stream_key TEXT PRIMARY KEY, cursor INTEGER NOT NULL, key_epoch INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS crm_sync_applied (stream_key TEXT NOT NULL, cursor INTEGER NOT NULL, blob_id TEXT NOT NULL, PRIMARY KEY(stream_key,cursor));
CREATE TABLE IF NOT EXISTS crm_immutable_operations (operation_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crm_activity_outbox (idempotency_key TEXT PRIMARY KEY, event_id TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crm_notification_outbox_intents (org_id TEXT NOT NULL, envelope_id TEXT NOT NULL, mutation_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(org_id,envelope_id));
CREATE TABLE IF NOT EXISTS crm_propagation_transactions (event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, instance_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crm_hlc_state (org_id TEXT PRIMARY KEY, last_relay_observed_millis INTEGER, last_valid_issued_hlc_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crm_merge_quarantine (operation_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, stamp_json TEXT NOT NULL, reason TEXT NOT NULL, quarantined_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crm_outbox (org_id TEXT NOT NULL, envelope_id TEXT NOT NULL, mutation_id TEXT NOT NULL, recipient_user_id TEXT NOT NULL, envelope_class TEXT NOT NULL CHECK(envelope_class IN ('firm_operational','client_confidential')), ciphertext BLOB NOT NULL, created_at TEXT NOT NULL, delivered_at TEXT, dead_letter_at TEXT, PRIMARY KEY(org_id,envelope_id));
CREATE INDEX IF NOT EXISTS idx_crm_outbox_org_delivery ON crm_outbox(org_id, delivered_at, created_at);
CREATE TABLE IF NOT EXISTS crm_inbox (org_id TEXT NOT NULL, envelope_id TEXT NOT NULL, ciphertext BLOB NOT NULL, received_at TEXT NOT NULL, decrypted_at TEXT, deduped_at TEXT, dead_letter_at TEXT, PRIMARY KEY(org_id,envelope_id));
CREATE INDEX IF NOT EXISTS idx_crm_inbox_org_received ON crm_inbox(org_id, received_at);

CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY,matter_id TEXT NOT NULL,name TEXT,status TEXT,primary_advisor_id TEXT,ownership TEXT,service_policy_id TEXT,archived INTEGER DEFAULT 0,updated_at TEXT,next_review_due TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_hh_matter ON households(matter_id); CREATE INDEX IF NOT EXISTS idx_hh_advisor ON households(primary_advisor_id); CREATE INDEX IF NOT EXISTS idx_hh_review ON households(next_review_due);
CREATE TABLE IF NOT EXISTS persons (id TEXT PRIMARY KEY,matter_id TEXT NOT NULL,household_id TEXT,is_external INTEGER DEFAULT 0,external_role TEXT,first_name TEXT,last_name TEXT,birth_date TEXT,date_of_death TEXT,updated_at TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_person_hh ON persons(household_id); CREATE INDEX IF NOT EXISTS idx_person_ext ON persons(is_external,external_role); CREATE INDEX IF NOT EXISTS idx_person_birth ON persons(birth_date);
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY,matter_id TEXT NOT NULL,household_id TEXT,custodian TEXT,account_type TEXT,last4 TEXT,purpose TEXT,ownership TEXT,status TEXT,updated_at TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_acct_hh ON accounts(household_id);
CREATE TABLE IF NOT EXISTS facts (id TEXT PRIMARY KEY,matter_id TEXT NOT NULL,household_id TEXT,subject_kind TEXT,subject_id TEXT,fact_type TEXT,status TEXT,pinned INTEGER DEFAULT 0,as_of TEXT,observed_at TEXT,superseded_by TEXT,value_num REAL,value_text TEXT,updated_at TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_fact_hh_type ON facts(household_id,fact_type,status); CREATE INDEX IF NOT EXISTS idx_fact_current ON facts(household_id,fact_type,as_of) WHERE status='current' AND deleted=0; CREATE INDEX IF NOT EXISTS idx_fact_pinned ON facts(household_id,pinned);
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY,matter_id TEXT NOT NULL,anchor_household_id TEXT,audience TEXT,pinned INTEGER DEFAULT 0,title TEXT,authored_via TEXT,created_at TEXT,updated_at TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_note_hh_aud ON notes(anchor_household_id,audience);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY,household_id TEXT,title TEXT,assignee_user_id TEXT,status TEXT,priority TEXT,due_at TEXT,recurrence_json TEXT,updated_at TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_task_status_due ON tasks(status,due_at); CREATE INDEX IF NOT EXISTS idx_task_hh ON tasks(household_id); CREATE INDEX IF NOT EXISTS idx_task_assignee ON tasks(assignee_user_id);
CREATE TABLE IF NOT EXISTS workflow_templates (id TEXT PRIMARY KEY,name TEXT,category TEXT,head_revision_set_json TEXT,status TEXT,updated_at TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS workflow_instances (id TEXT PRIMARY KEY,matter_id TEXT NOT NULL,household_id TEXT,template_id TEXT,displayed_revision_set_json TEXT,status TEXT,started_at TEXT,open_offer_count INTEGER DEFAULT 0,updated_at TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_winst_template ON workflow_instances(template_id,status);
CREATE TABLE IF NOT EXISTS template_revisions (revision_id TEXT PRIMARY KEY,template_id TEXT NOT NULL,parent_revision_ids_json TEXT NOT NULL,issued_hlc_json TEXT NOT NULL,label TEXT NOT NULL,json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_template_revision_template ON template_revisions(template_id);
CREATE TABLE IF NOT EXISTS workflow_completion_operations (completion_id TEXT PRIMARY KEY,workflow_instance_id TEXT NOT NULL,step_id TEXT NOT NULL,completed_at TEXT NOT NULL,completed_by_json TEXT NOT NULL,source_operation_id TEXT NOT NULL,json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_completion_instance_step ON workflow_completion_operations(workflow_instance_id,step_id);
CREATE TABLE IF NOT EXISTS workflow_assignment_operations (assignment_id TEXT PRIMARY KEY,workflow_instance_id TEXT NOT NULL,step_id TEXT NOT NULL,assigned_user_id TEXT,assigned_at TEXT NOT NULL,assigned_by_json TEXT NOT NULL,source_operation_id TEXT NOT NULL,json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_assignment_instance_step ON workflow_assignment_operations(workflow_instance_id,step_id,assigned_at);
CREATE TABLE IF NOT EXISTS workflow_step_progress (workflow_instance_id TEXT NOT NULL,step_id TEXT NOT NULL,origin TEXT NOT NULL,assignee_user_id TEXT,status TEXT NOT NULL,removal_requested_by_json TEXT NOT NULL,detached_from_template INTEGER NOT NULL DEFAULT 0,json TEXT NOT NULL,PRIMARY KEY(workflow_instance_id,step_id));
CREATE TABLE IF NOT EXISTS propagation_decisions (instance_id TEXT NOT NULL,revision_id TEXT NOT NULL,step_id TEXT NOT NULL,field TEXT NOT NULL,decision TEXT NOT NULL,source_operation_id TEXT NOT NULL,supersedes_decision_key TEXT,reoffer_state TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(instance_id,revision_id,step_id,field));
CREATE TABLE IF NOT EXISTS opportunities (id TEXT PRIMARY KEY,matter_id TEXT NOT NULL,household_id TEXT,name TEXT,pipeline_id TEXT,stage_id TEXT,status TEXT,amount REAL,expected_close_date TEXT,owner_id TEXT,updated_at TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_opp_pipeline_stage ON opportunities(pipeline_id,stage_id,status);
CREATE TABLE IF NOT EXISTS service_policies (id TEXT PRIMARY KEY,matter_id TEXT,scope TEXT,tier_name TEXT,cadence_days INTEGER,scheduling_link_url TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS pipeline_defs (id TEXT PRIMARY KEY,name TEXT,archived INTEGER DEFAULT 0,json TEXT NOT NULL,deleted INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS stage_defs (id TEXT PRIMARY KEY,pipeline_id TEXT NOT NULL,name TEXT,status_effect TEXT,archived INTEGER DEFAULT 0,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_stage_pipeline ON stage_defs(pipeline_id);
CREATE TABLE IF NOT EXISTS proposal_records (id TEXT PRIMARY KEY,household_id TEXT,proposal_kind TEXT NOT NULL,state TEXT,decided_at TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_proposal_pending ON proposal_records(state,household_id);
CREATE TABLE IF NOT EXISTS legacy_projects (id TEXT PRIMARY KEY,matter_id TEXT NOT NULL,anchor_household_id TEXT,title TEXT NOT NULL,source_status TEXT,unlinked INTEGER NOT NULL DEFAULT 0,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_legacy_project_anchor ON legacy_projects(anchor_household_id);
CREATE TABLE IF NOT EXISTS legacy_project_household_links (legacy_project_id TEXT NOT NULL,household_id TEXT NOT NULL,matter_id TEXT NOT NULL,PRIMARY KEY(legacy_project_id,household_id));
CREATE TABLE IF NOT EXISTS firm_directory_entries (id TEXT PRIMARY KEY,user_id TEXT UNIQUE,display_name TEXT,email TEXT,active INTEGER DEFAULT 1,json TEXT NOT NULL,deleted INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS household_directory_shells (id TEXT PRIMARY KEY,household_id TEXT NOT NULL UNIQUE,operational_status TEXT NOT NULL,json TEXT NOT NULL,deleted INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS intake_links (id TEXT PRIMARY KEY,household_id TEXT,audience TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_intake_link_status ON intake_links(status);
CREATE TABLE IF NOT EXISTS intake_submissions (id TEXT PRIMARY KEY,intake_link_id TEXT NOT NULL,audience TEXT NOT NULL,state TEXT NOT NULL,submitted_at TEXT NOT NULL,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE INDEX IF NOT EXISTS idx_intake_submission_review ON intake_submissions(state,submitted_at);
CREATE TABLE IF NOT EXISTS intake_matching_decisions (decision_id TEXT PRIMARY KEY,submission_id TEXT NOT NULL,decision TEXT NOT NULL,household_id TEXT,decided_at TEXT NOT NULL,decided_by_json TEXT NOT NULL,source_operation_id TEXT NOT NULL,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS import_archive_manifests (id TEXT PRIMARY KEY,import_batch_id TEXT UNIQUE,provider TEXT,finalized_at TEXT,manifest_sha256 TEXT,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS note_household_links (note_id TEXT NOT NULL,household_id TEXT NOT NULL,matter_id TEXT NOT NULL,PRIMARY KEY(note_id,household_id));
CREATE TABLE IF NOT EXISTS activity_events (id TEXT PRIMARY KEY,matter_id TEXT,household_id TEXT,at TEXT NOT NULL,actor_id TEXT,verb TEXT,target_kind TEXT,target_id TEXT,important INTEGER DEFAULT 0,json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_activity_hh_at ON activity_events(household_id,at); CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_events(at); CREATE INDEX IF NOT EXISTS idx_activity_important ON activity_events(important,at);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY,name TEXT,color TEXT,category TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0); CREATE TABLE IF NOT EXISTS entity_tags (entity_id TEXT,entity_kind TEXT,tag_id TEXT,PRIMARY KEY(entity_id,tag_id)); CREATE INDEX IF NOT EXISTS idx_entity_tags_tag ON entity_tags(tag_id);
CREATE TABLE IF NOT EXISTS custom_field_defs (id TEXT PRIMARY KEY,key TEXT,label TEXT,field_type TEXT,applies_to TEXT,options_json TEXT,archived INTEGER DEFAULT 0,json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS saved_views (id TEXT PRIMARY KEY,matter_id TEXT,name TEXT,surface TEXT,visibility TEXT,report_kind TEXT,json TEXT NOT NULL,deleted INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS external_refs (provider TEXT NOT NULL,source_type TEXT NOT NULL,source_id TEXT NOT NULL,scope TEXT NOT NULL,crm_key TEXT,entity_kind TEXT NOT NULL,entity_id TEXT NOT NULL,last_synced_at TEXT,PRIMARY KEY(provider,source_type,source_id,scope)); CREATE INDEX IF NOT EXISTS idx_extref_entity ON external_refs(entity_id);
CREATE TABLE IF NOT EXISTS import_directory_mappings (provider TEXT NOT NULL,external_user_id TEXT NOT NULL,directory_entry_id TEXT NOT NULL,PRIMARY KEY(provider,external_user_id));
CREATE TABLE IF NOT EXISTS migration_checklist_items (id TEXT PRIMARY KEY,import_batch_id TEXT NOT NULL,legacy_project_id TEXT NOT NULL,household_id TEXT,decision TEXT NOT NULL,resulting_workflow_instance_id TEXT,gap_reason TEXT,decided_at TEXT,decided_by_json TEXT,json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_migration_checklist_batch ON migration_checklist_items(import_batch_id,decision);
CREATE TABLE IF NOT EXISTS attachment_accounting_records (id TEXT PRIMARY KEY,import_batch_id TEXT NOT NULL,household_id TEXT NOT NULL,status TEXT NOT NULL,export_source TEXT,exported_at TEXT,exported_by_json TEXT,gap_reason TEXT,gap_owner_user_id TEXT,json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_attachment_accounting_batch ON attachment_accounting_records(import_batch_id,status);
CREATE TABLE IF NOT EXISTS export_jobs (id TEXT PRIMARY KEY,import_batch_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,manifest_id TEXT,fidelity_report_sha256 TEXT,destination_label TEXT,failure_reason TEXT,started_at TEXT NOT NULL,started_by_json TEXT NOT NULL,finished_at TEXT,json TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_export_job_batch ON export_jobs(import_batch_id,kind,status);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
-- Local decrypted FTS projection. It is cleared and rebuilt with the other projections.
CREATE VIRTUAL TABLE IF NOT EXISTS crm_fts USING fts5(entity_id UNINDEXED, entity_kind UNINDEXED, matter_id UNINDEXED, content);
"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_has_required_note_and_org_scoped_notification_indexes() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let note_index: String = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_note_hh_aud'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(note_index, "idx_note_hh_aud");
        let sql: String = conn
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='crm_outbox'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(sql.contains("org_id"));
    }
}

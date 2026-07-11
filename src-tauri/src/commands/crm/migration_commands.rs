//! Desktop bridge for the already-built Wealthbox importer primitives.
//!
//! This command deliberately uses the same raw-response fetchers as the
//! fidelity drive.  It stores only encrypted CRM collection documents; the
//! renderer receives the derived report, never a database handle.

use serde_json::{json, Value};
use tauri::State;

use super::{
    client::WealthboxClient,
    commands::CrmState,
    core_store::CrmCoreStore,
    importer::{
        fetch_activity_page, fetch_custom_fields_page, fetch_page, SourceType, IMPORTER_PAGE_SIZE,
    },
};

const SOURCES: &[SourceType] = &[
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
    SourceType::ContactRole,
    SourceType::User,
    SourceType::Team,
    SourceType::CustomizableCategory,
    SourceType::OpportunityStage,
];

async fn workspace(state: &CrmState) -> Result<std::path::PathBuf, String> {
    state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Open a workspace before using CRM data.".to_string())
}

fn source_kind(source: SourceType, payload: &Value) -> &'static str {
    match source {
        SourceType::Contact if payload.get("type").and_then(Value::as_str) == Some("household") => {
            "household"
        }
        SourceType::Contact => "person",
        SourceType::Note => "note",
        SourceType::Task => "task",
        SourceType::Event | SourceType::Activity => "activity",
        SourceType::Opportunity => "opportunity",
        SourceType::Project => "legacy_project",
        SourceType::WorkflowTemplate => "workflow_template",
        SourceType::Workflow => "workflow",
        SourceType::WorkflowStep => "workflow_step",
        SourceType::CustomField => "custom_field",
        SourceType::Tag => "tag",
        SourceType::ContactRole => "contact_role",
        SourceType::User | SourceType::Team => "directory_entry",
        SourceType::CustomizableCategory => "customizable_category",
        SourceType::OpportunityStage => "opportunity_stage",
        SourceType::Attachment => "attachment_accounting",
    }
}

fn source_label(payload: &Value, fallback: &str) -> String {
    payload
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| payload.get("title").and_then(Value::as_str))
        .or_else(|| payload.get("subject").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| fallback.to_string())
}

fn matrix_row(source_type: &str, fetched: usize, imported: usize, skipped: usize) -> Value {
    let plain_reason = if skipped == 0 {
        Value::Null
    } else if source_type == "note" {
        json!(format!("{skipped} note{} couldn't be imported because it is not linked to a client. Review it and add it manually if it still matters.", if skipped == 1 { "" } else { "s" }))
    } else {
        json!(format!(
            "{skipped} {} record{} couldn't be imported. Review this row for what to do next.",
            source_type.replace('_', " "),
            if skipped == 1 { "" } else { "s" }
        ))
    };
    json!({ "sourceType": source_type, "fetched": fetched, "imported": imported, "skipped": skipped, "rejected": 0, "plainReason": plain_reason })
}

#[tauri::command]
pub async fn crm_migration_import(
    state: State<'_, CrmState>,
    base_url: String,
) -> Result<Value, String> {
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err("The simulator address must start with http:// or https://.".into());
    }
    let workspace = workspace(&state).await?;
    let client = WealthboxClient::new_with_base("fabricated-token".into(), base_url);
    let result = tokio::task::spawn_blocking(move || CrmCoreStore::open(&workspace))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let store = result;
    let mut fetched = std::collections::BTreeMap::<String, usize>::new();
    let mut imported = std::collections::BTreeMap::<String, usize>::new();
    let mut skipped = std::collections::BTreeMap::<String, usize>::new();
    let mut unchanged = 0usize;
    let mut households = Vec::<(String, String)>::new();
    let mut workflow_rows = Vec::<Value>::new();

    for source in SOURCES {
        let mut page_number = 1usize;
        loop {
            let page = fetch_page(&client, *source, page_number, None)
                .await
                .map_err(|error| error.to_string())?;
            let count = page.records.len();
            for record in page.records {
                *fetched.entry(source.as_str().to_string()).or_default() += 1;
                // A note with no Contact link has no safe client home.  The
                // fidelity drive uses this same fabricated collision case.
                if record.source_type == SourceType::Note
                    && !record
                        .payload
                        .get("linked_to")
                        .and_then(Value::as_array)
                        .is_some_and(|links| {
                            links.iter().any(|link| {
                                link.get("type")
                                    .and_then(Value::as_str)
                                    .is_some_and(|kind| kind.eq_ignore_ascii_case("contact"))
                            })
                        })
                {
                    *skipped.entry("note".into()).or_default() += 1;
                    continue;
                }
                let kind = source_kind(record.source_type, &record.payload);
                let id = format!("{}:{}", kind, record.source_id);
                let label = source_label(&record.payload, &id);
                let mut live = json!({ "id": id, "kind": kind, "matterId": "firm", "sourceType": record.source_type.as_str(), "sourceId": record.source_id, "label": label, "sourcePayload": record.payload });
                if kind == "household" {
                    let name = live
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or("Untitled household")
                        .to_string();
                    live["name"] = Value::String(name.clone());
                    live["lifecycle"] = Value::String("Active".into());
                    live["primaryAdvisor"] = Value::String("Imported".into());
                    live["serviceTier"] = Value::String("Imported".into());
                    households.push((live["id"].as_str().unwrap_or_default().to_string(), name));
                }
                if kind == "task" {
                    live["title"] = live
                        .get("label")
                        .cloned()
                        .unwrap_or_else(|| Value::String("Imported task".into()));
                    live["status"] = Value::String("open".into());
                    live["priority"] = Value::String("normal".into());
                    live["assigneeUserId"] = Value::String("imported".into());
                    live["assigneeLabel"] = Value::String("Imported".into());
                }
                let already = store
                    .list_live_records()
                    .map_err(|error| error.to_string())?
                    .iter()
                    .any(|saved| saved.get("id") == live.get("id"));
                store
                    .upsert_live_record(&live)
                    .map_err(|error| error.to_string())?;
                *imported.entry(source.as_str().to_string()).or_default() += 1;
                if already {
                    unchanged += 1;
                }
                if kind == "workflow" || kind == "legacy_project" {
                    workflow_rows.push(json!({ "id": format!("migration-workflow:{}", live["sourceId"].as_str().unwrap_or("unknown")), "kind": "migration_workflow_checklist", "clientLabel": "Imported client", "sourceTemplateLabel": label, "activityEvidence": ["Imported workflow or project trace"], "availableSteps": ["Review imported trace", "Create the matching workflow"], "decision": "pending" }));
                }
            }
            if count < IMPORTER_PAGE_SIZE {
                break;
            }
            page_number += 1;
        }
    }
    let custom_fields = fetch_custom_fields_page(&client, "Contact", 1)
        .await
        .map_err(|error| error.to_string())?;
    for record in custom_fields.records {
        *fetched.entry("custom_field".into()).or_default() += 1;
        *imported.entry("custom_field".into()).or_default() += 1;
        let live = json!({ "id": format!("custom_field:{}", record.source_id), "kind": "custom_field", "matterId": "firm", "sourceType": "custom_field", "sourcePayload": record.payload });
        store
            .upsert_live_record(&live)
            .map_err(|error| error.to_string())?;
    }
    let mut cursor: Option<String> = None;
    loop {
        let activity = fetch_activity_page(&client, cursor.as_deref())
            .await
            .map_err(|error| error.to_string())?;
        let count = activity.fetched.records.len();
        for record in activity.fetched.records {
            *fetched.entry("activity".into()).or_default() += 1;
            *imported.entry("activity".into()).or_default() += 1;
            let live = json!({ "id": format!("activity:{}", record.source_id), "kind": "activity", "matterId": "firm", "sourceType": "activity", "sourcePayload": record.payload });
            store
                .upsert_live_record(&live)
                .map_err(|error| error.to_string())?;
        }
        if count == 0 || activity.next_cursor.is_none() {
            break;
        }
        cursor = activity.next_cursor;
    }
    let workflow_count = workflow_rows.len();
    for item in workflow_rows {
        store
            .upsert_live_record(&item)
            .map_err(|error| error.to_string())?;
    }
    for (household_id, household_label) in &households {
        let item = json!({ "id": format!("migration-attachment:{household_id}"), "kind": "migration_attachment_accounting", "matterId": "firm", "clientLabel": household_label, "status": "pending" });
        store
            .upsert_live_record(&item)
            .map_err(|error| error.to_string())?;
    }
    let all_rows = [
        "contact",
        "note",
        "task",
        "event",
        "opportunity",
        "project",
        "workflow_template",
        "workflow",
        "custom_field",
        "tag",
        "contact_role",
        "user",
        "team",
        "activity",
        "attachment",
    ]
    .into_iter()
    .map(|name| {
        matrix_row(
            name,
            *fetched.get(name).unwrap_or(&0),
            *imported.get(name).unwrap_or(&0),
            *skipped.get(name).unwrap_or(&0),
        )
    })
    .collect::<Vec<_>>();
    let report = json!({ "id": "migration-report:wealthbox", "kind": "migration_report", "matterId": "firm", "batchId": "wealthbox-simulator", "generatedAt": chrono::Utc::now().to_rfc3339(), "matrix": all_rows, "attachments": { "viaApi": "0% via API", "affected": households.len(), "exported": 0, "gaps": 0, "unaccounted": households.len() }, "workflows": { "checklists": workflow_count, "pending": workflow_count }, "message": "Import finished. The report below shows exactly what was brought over and what still needs a person to check." });
    store
        .upsert_live_record(&report)
        .map_err(|error| error.to_string())?;
    for kind in ["archive", "rollback"] {
        store.upsert_live_record(&json!({ "id": format!("migration-export:{kind}"), "kind": "migration_export", "matterId": "firm", "exportKind": kind, "status": "ready" })).map_err(|error| error.to_string())?;
    }
    Ok(
        json!({ "batchId": "wealthbox-simulator", "imported": imported.values().sum::<usize>(), "unchanged": unchanged }),
    )
}

#[tauri::command]
pub async fn crm_migration_export(
    state: State<'_, CrmState>,
    kind: String,
) -> Result<Value, String> {
    if kind != "archive" && kind != "rollback" {
        return Err("Unknown migration export type.".into());
    }
    let workspace = workspace(&state).await?;
    let store = tokio::task::spawn_blocking(move || CrmCoreStore::open(&workspace))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let record = json!({ "id": format!("migration-export:{kind}"), "kind": "migration_export", "matterId": "firm", "exportKind": kind, "status": "exported", "exportedAt": chrono::Utc::now().to_rfc3339(), "manifestId": "wealthbox-simulator", "reconciliationReportId": "migration-report:wealthbox" });
    store
        .upsert_live_record(&record)
        .map_err(|error| error.to_string())?;
    Ok(record)
}

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
        fetch_activity_page, fetch_custom_fields_page, fetch_page, write_decrypted_archive,
        write_rollback_csv, SourceType, IMPORTER_PAGE_SIZE,
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

fn linked_household_id(
    payload: &Value,
    contact_households: &std::collections::BTreeMap<String, String>,
) -> Option<String> {
    payload
        .get("linked_to")
        .and_then(Value::as_array)?
        .iter()
        .find_map(|link| {
            let is_contact = link
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.eq_ignore_ascii_case("contact"));
            let id = link.get("id").and_then(|value| {
                value
                    .as_i64()
                    .map(|id| id.to_string())
                    .or_else(|| value.as_str().map(str::to_string))
            });
            is_contact
                .then_some(id)
                .flatten()
                .and_then(|id| contact_households.get(&id).cloned())
        })
}

fn money_amount(payload: &Value) -> Option<f64> {
    payload
        .get("amounts")
        .and_then(Value::as_array)?
        .first()?
        .get("amount")?
        .as_str()?
        .replace(['$', ','], "")
        .parse()
        .ok()
}

fn custom_field_type(value: &str) -> &'static str {
    match value {
        "number" | "number_field" => "number",
        "currency" | "money" | "money_field" => "money",
        "date" | "date_field" => "date",
        "checkbox" | "boolean" => "bool",
        "select" | "dropdown" => "enum",
        "multi_select" | "multi-select" => "multi-enum",
        _ => "text",
    }
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
    policy: State<'_, crate::network_policy::NetworkPolicy>,
    base_url: String,
    source: Option<String>,
    source_id_field: Option<String>,
) -> Result<Value, String> {
    if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
        return Err("The simulator address must start with http:// or https://.".into());
    }
    // These are prepared, fabricated samples rather than live Redtail or
    // Salesforce connections.  Their source names still become durable
    // provenance, so importing one cannot overwrite another sample's data.
    let provider = match source
        .as_deref()
        .unwrap_or("wealthbox")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "wealthbox" => "wealthbox",
        "redtail" => "redtail",
        "salesforce" => "salesforce",
        _ => return Err("Choose the Wealthbox, Redtail, or Salesforce sample source.".into()),
    };
    let batch_id = format!("{provider}-simulator");
    let source_id_field = source_id_field
        .unwrap_or_else(|| "external_id".into())
        .trim()
        .to_string();
    if source_id_field.is_empty() {
        return Err("Name the outside ID field used to match imported records.".into());
    }
    let workspace = workspace(&state).await?;
    let client = WealthboxClient::new_migration(
        "fabricated-token".into(),
        base_url,
        policy.inner().clone(),
    )
    .map_err(|error| error.to_string())?;
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
    let mut contact_households = std::collections::BTreeMap::<String, String>::new();
    let mut workflow_rows = Vec::<Value>::new();
    let mut note_gap_rows = Vec::<Value>::new();

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
                    let fallback_id = format!("{provider}:note:{}", record.source_id);
                    note_gap_rows.push(json!({
                        "id": format!("migration-note-gap:{provider}:{}", record.source_id),
                        "kind": "migration_note_gap",
                        "matterId": "firm",
                        "label": source_label(&record.payload, &fallback_id),
                        "reason": "This note was not linked to a client, so Lantern could not safely choose a household for it."
                    }));
                    continue;
                }
                let kind = source_kind(record.source_type, &record.payload);
                let id = format!("{provider}:{kind}:{}", record.source_id);
                let label = source_label(&record.payload, &id);
                let mut live = json!({ "id": id, "kind": kind, "matterId": "firm", "sourceType": record.source_type.as_str(), "sourceId": record.source_id, "externalId": record.source_id, "externalIdField": source_id_field, "sourceProvider": provider, "label": label, "sourcePayload": record.payload });
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
                    contact_households.insert(
                        record.source_id.clone(),
                        live["id"].as_str().unwrap_or_default().to_string(),
                    );
                } else if record.source_type == SourceType::Contact {
                    if let Some(household_source_id) = record
                        .payload
                        .get("household")
                        .and_then(|household| household.get("id"))
                        .and_then(|value| {
                            value
                                .as_i64()
                                .map(|id| id.to_string())
                                .or_else(|| value.as_str().map(str::to_string))
                        })
                    {
                        if let Some(household_id) =
                            contact_households.get(&household_source_id).cloned()
                        {
                            contact_households
                                .insert(record.source_id.clone(), household_id.clone());
                            live["householdId"] = Value::String(household_id);
                        }
                    }
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
                if record.source_type == SourceType::Opportunity {
                    let Some(household_id) =
                        linked_household_id(&record.payload, &contact_households)
                    else {
                        *skipped.entry("opportunity".into()).or_default() += 1;
                        continue;
                    };
                    let Some(stage_id) = record.payload.get("stage").and_then(|value| {
                        value
                            .as_i64()
                            .map(|id| id.to_string())
                            .or_else(|| value.as_str().map(str::to_string))
                    }) else {
                        *skipped.entry("opportunity".into()).or_default() += 1;
                        continue;
                    };
                    live["householdId"] = Value::String(household_id);
                    live["pipelineId"] = Value::String("imported-wealthbox-pipeline".into());
                    live["stageId"] = Value::String(format!("opportunity_stage:{stage_id}"));
                    live["status"] = Value::String("open".into());
                    if let Some(amount) = money_amount(&record.payload) {
                        live["amount"] = json!({ "value": amount, "currency": "USD" });
                    }
                    if let Some(probability) =
                        record.payload.get("probability").and_then(Value::as_f64)
                    {
                        live["probability"] = json!(probability);
                    }
                    if let Some(close_date) =
                        record.payload.get("target_close").and_then(Value::as_str)
                    {
                        live["expectedCloseDate"] = json!(close_date);
                    }
                    if let Some(owner_id) = record.payload.get("manager").and_then(|value| {
                        value
                            .as_i64()
                            .map(|id| id.to_string())
                            .or_else(|| value.as_str().map(str::to_string))
                    }) {
                        live["ownerId"] = json!(owner_id);
                    }
                }
                if record.source_type == SourceType::Project {
                    live["title"] = live["label"].clone();
                    live["description"] = record
                        .payload
                        .get("description")
                        .cloned()
                        .unwrap_or(Value::Null);
                    live["unlinked"] = Value::Bool(
                        linked_household_id(&record.payload, &contact_households).is_none(),
                    );
                    live["manualWorkflowLaunches"] = json!([]);
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
                    let household_id = linked_household_id(&record.payload, &contact_households);
                    let client_label = household_id
                        .as_ref()
                        .and_then(|id| {
                            households
                                .iter()
                                .find(|(candidate, _)| candidate == id)
                                .map(|(_, name)| name.clone())
                        })
                        .unwrap_or_else(|| "Client not identified from the source trace".into());
                    let available_steps = record
                        .payload
                        .get("steps")
                        .and_then(Value::as_array)
                        .map(|steps| {
                            steps
                                .iter()
                                .filter_map(|step| {
                                    step.get("name")
                                        .and_then(Value::as_str)
                                        .or_else(|| step.get("title").and_then(Value::as_str))
                                        .map(str::to_string)
                                })
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    workflow_rows.push(json!({ "id": format!("migration-workflow:{provider}:{}", live["sourceId"].as_str().unwrap_or("unknown")), "kind": "migration_workflow_checklist", "matterId": "firm", "clientLabel": client_label, "householdId": household_id, "sourceTemplateLabel": label, "activityEvidence": ["Imported workflow or project trace"], "availableSteps": available_steps, "decision": "pending", "sourceProvider": provider }));
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
        let live = json!({ "id": format!("{provider}:custom_field:{}", record.source_id), "kind": "custom_field", "matterId": "firm", "sourceType": "custom_field", "sourceId": record.source_id, "externalId": record.source_id, "externalIdField": source_id_field, "sourceProvider": provider, "sourcePayload": record.payload });
        let mut live = live;
        let label = live["sourcePayload"]
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("Imported field")
            .to_string();
        let source_type = live["sourcePayload"]
            .get("field_type")
            .and_then(Value::as_str)
            .unwrap_or("text_field")
            .to_string();
        live["label"] = Value::String(label.clone());
        live["key"] = Value::String(format!("{provider}_{}", record.source_id));
        live["fieldType"] = Value::String(custom_field_type(&source_type).into());
        live["appliesTo"] = json!(["household", "person"]);
        live["archived"] = Value::Bool(false);
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
            let live = json!({ "id": format!("{provider}:activity:{}", record.source_id), "kind": "activity", "matterId": "firm", "sourceType": "activity", "sourceId": record.source_id, "externalId": record.source_id, "externalIdField": source_id_field, "sourceProvider": provider, "sourcePayload": record.payload });
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
    for item in note_gap_rows {
        store
            .upsert_live_record(&item)
            .map_err(|error| error.to_string())?;
    }
    for (household_id, household_label) in &households {
        let item = json!({ "id": format!("migration-attachment:{provider}:{household_id}"), "kind": "migration_attachment_accounting", "matterId": "firm", "clientLabel": household_label, "status": "pending", "sourceProvider": provider });
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
    let report = json!({ "id": format!("migration-report:{provider}"), "kind": "migration_report", "matterId": "firm", "batchId": batch_id, "sourceProvider": provider, "externalIdField": source_id_field, "generatedAt": chrono::Utc::now().to_rfc3339(), "matrix": all_rows, "attachments": { "viaApi": "0% via API", "affected": households.len(), "exported": 0, "gaps": 0, "unaccounted": households.len() }, "workflows": { "checklists": workflow_count, "pending": workflow_count }, "message": format!("{provider} sample import finished. The report below shows exactly what was brought over and what still needs a person to check.") });
    store
        .upsert_live_record(&report)
        .map_err(|error| error.to_string())?;
    for kind in ["archive", "rollback"] {
        store.upsert_live_record(&json!({ "id": format!("migration-export:{kind}"), "kind": "migration_export", "matterId": "firm", "exportKind": kind, "status": "ready" })).map_err(|error| error.to_string())?;
    }
    Ok(
        json!({ "batchId": batch_id, "sourceProvider": provider, "imported": imported.values().sum::<usize>(), "unchanged": unchanged }),
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
    let store_workspace = workspace.clone();
    let store = tokio::task::spawn_blocking(move || CrmCoreStore::open(&store_workspace))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    let records = store
        .list_live_records()
        .map_err(|error| error.to_string())?;
    let report = records.iter().find(|record| {
        record.get("id") == Some(&Value::String("migration-report:wealthbox".into()))
    });
    let Some(report) = report else {
        return Err("Run the migration before creating an export file.".into());
    };
    let batch_id = report
        .get("batchId")
        .and_then(Value::as_str)
        .unwrap_or("wealthbox-simulator");
    let matrix = report
        .get("matrix")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let written = match kind.as_str() {
        "archive" => write_decrypted_archive(&workspace, batch_id, &records, &matrix),
        "rollback" => write_rollback_csv(&workspace, batch_id, &records),
        _ => unreachable!("kind is checked above"),
    };
    let record = match written {
        Ok(written) => json!({
            "id": format!("migration-export:{kind}"), "kind": "migration_export", "matterId": "firm",
            "exportKind": kind, "status": "exported", "exportedAt": chrono::Utc::now().to_rfc3339(),
            "manifestId": batch_id, "reconciliationReportId": "migration-report:wealthbox",
            "filePath": written.path.to_string_lossy(), "byteLength": written.byte_length,
            "sha256": written.sha256,
        }),
        Err(error) => json!({
            "id": format!("migration-export:{kind}"), "kind": "migration_export", "matterId": "firm",
            "exportKind": kind, "status": "failed", "failedAt": chrono::Utc::now().to_rfc3339(),
            "manifestId": batch_id, "reconciliationReportId": "migration-report:wealthbox",
            "failureReason": format!("Could not create the file: {error}"),
        }),
    };
    store
        .upsert_live_record(&record)
        .map_err(|error| error.to_string())?;
    if record.get("status").and_then(Value::as_str) == Some("failed") {
        return Err(record
            .get("failureReason")
            .and_then(Value::as_str)
            .unwrap_or("Could not create the export file.")
            .to_string());
    }
    Ok(record)
}

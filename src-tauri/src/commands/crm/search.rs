//! Local-only CRM retrieval over the encrypted core's FTS projection.
//!
//! The projection is deliberately rebuilt from the current live collection
//! documents before each query. It never crosses the relay and only exists in
//! the SQLCipher database on this device.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use super::{commands::CrmState, core_store::CrmCoreStore};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrmSearchHit {
    pub entity_id: String,
    pub entity_kind: String,
    pub matter_id: String,
    pub title: String,
    pub snippet: String,
    pub content: String,
}

fn fts_query(query: &str) -> Option<String> {
    // Treat punctuation as separators rather than passing FTS syntax through
    // from the renderer. Prefix matching makes partial names useful without
    // letting an invalid query turn into a database error.
    let terms = query
        .split(|character: char| !character.is_alphanumeric())
        .filter(|term| !term.is_empty())
        .take(12)
        .map(|term| format!("{term}*"))
        .collect::<Vec<_>>();
    (!terms.is_empty()).then(|| terms.join(" AND "))
}

fn string_field(record: &serde_json::Map<String, Value>, field: &str) -> Option<String> {
    record
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn record_title(record: &serde_json::Map<String, Value>, kind: &str, id: &str) -> String {
    for field in ["name", "title", "label", "body", "text"] {
        if let Some(value) = string_field(record, field) {
            let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
            if !compact.is_empty() {
                return compact.chars().take(110).collect();
            }
        }
    }
    format!("{kind} {id}")
}

fn record_content(record: &Value) -> String {
    // JSON preserves every user-entered string, including a note body, fact
    // value, task context, and household details. Metadata keys are harmless
    // here: this projection is local and encrypted by SQLCipher.
    serde_json::to_string(record).unwrap_or_default()
}

fn plain_text_snippet(content: &str, query: &str) -> String {
    let normalized = content.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = normalized.to_lowercase();
    let term = query
        .split_whitespace()
        .find(|term| !term.is_empty() && !term.eq_ignore_ascii_case("AND"))
        .unwrap_or_default()
        .to_lowercase();
    let start = lower.find(&term).unwrap_or(0).saturating_sub(90);
    let end = (start + 280).min(normalized.len());
    let mut snippet = normalized.get(start..end).unwrap_or(&normalized).to_owned();
    if start > 0 {
        snippet.insert_str(0, "…");
    }
    if end < normalized.len() {
        snippet.push('…');
    }
    snippet
}

fn query_terms(query: &str) -> Vec<String> {
    query
        .split(|character: char| !character.is_alphanumeric())
        .filter(|term| !term.is_empty() && !term.eq_ignore_ascii_case("AND"))
        .map(str::to_lowercase)
        .collect()
}

fn matches_terms(value: &Value, terms: &[String]) -> bool {
    let searchable = serde_json::to_string(value)
        .unwrap_or_default()
        .to_lowercase();
    !terms.is_empty() && terms.iter().all(|term| searchable.contains(term))
}

fn display_date(value: &str) -> &str {
    value
        .get(..10)
        .filter(|prefix| {
            prefix.as_bytes().get(4) == Some(&b'-') && prefix.as_bytes().get(7) == Some(&b'-')
        })
        .unwrap_or(value)
}

fn fact_snippet(fact: &serde_json::Map<String, Value>) -> String {
    let label = string_field(fact, "label")
        .or_else(|| string_field(fact, "name"))
        .unwrap_or_else(|| "Saved fact".to_string());
    let value = string_field(fact, "value")
        .or_else(|| string_field(fact, "text"))
        .unwrap_or_else(|| "No value saved".to_string());
    let mut parts = vec![format!("Fact: {label}: {value}")];
    let sources = fact
        .get("sources")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .filter_map(|source| string_field(source, "label").or_else(|| string_field(source, "name")))
        .collect::<Vec<_>>();
    if !sources.is_empty() {
        parts.push(format!("Source: {}", sources.join(", ")));
    }
    if let Some(as_of) = string_field(fact, "asOf")
        .or_else(|| string_field(fact, "learned"))
        .or_else(|| string_field(fact, "createdAt"))
    {
        parts.push(format!("As of {}", display_date(&as_of)));
    }
    parts.join(" · ")
}

fn note_snippet(note: &serde_json::Map<String, Value>) -> String {
    let body = string_field(note, "body")
        .or_else(|| string_field(note, "text"))
        .or_else(|| string_field(note, "title"))
        .unwrap_or_else(|| "Empty note".to_string());
    let mut parts = vec![format!("Note: {body}")];
    if let Some(audience) = string_field(note, "audience") {
        if audience == "internal" {
            parts.push("Internal only".to_string());
        }
        if audience == "client-facing" {
            parts.push("Client-facing".to_string());
        }
    }
    if let Some(saved) = string_field(note, "createdAt").or_else(|| string_field(note, "updatedAt"))
    {
        parts.push(format!("Saved {}", display_date(&saved)));
    }
    parts.join(" · ")
}

fn record_snippet(record: &serde_json::Map<String, Value>, query: &str) -> String {
    let kind = string_field(record, "kind").unwrap_or_else(|| "record".to_string());
    if kind == "fact" {
        return fact_snippet(record);
    }
    if kind == "note" {
        return note_snippet(record);
    }

    let terms = query_terms(query);
    if let Some(fact) = record
        .get("facts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|value| matches_terms(value, &terms))
        .and_then(Value::as_object)
    {
        return fact_snippet(fact);
    }
    if let Some(note) = record
        .get("notes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|value| matches_terms(value, &terms))
        .and_then(Value::as_object)
    {
        return note_snippet(note);
    }

    let label = match kind.as_str() {
        "household" => "Client",
        "person" => "Person",
        "account" => "Account",
        "task" => "Task",
        "workflowInstance" => "Workflow",
        "workflowTemplate" => "Workflow template",
        "opportunity" => "Opportunity",
        "activityEvent" => "Activity",
        "legacyProject" => "Project",
        _ => "Saved record",
    };
    let body = [
        "name",
        "title",
        "label",
        "body",
        "text",
        "value",
        "description",
    ]
    .into_iter()
    .find_map(|field| string_field(record, field))
    .unwrap_or_else(|| format!("Matching {label} record"));
    let mut parts = vec![format!("{label}: {body}")];
    if let Some(status) = string_field(record, "status")
        .or_else(|| string_field(record, "priority"))
        .or_else(|| string_field(record, "lifecycle"))
    {
        parts.push(format!("Status: {status}"));
    }
    parts.join(" · ")
}

fn make_snippet(content: &str, query: &str) -> String {
    serde_json::from_str::<Value>(content)
        .ok()
        .and_then(|value| {
            value
                .as_object()
                .map(|record| record_snippet(record, query))
        })
        .unwrap_or_else(|| plain_text_snippet(content, query))
}

fn rebuild_live_index(store: &CrmCoreStore) -> anyhow::Result<BTreeSet<String>> {
    let records = store.list_live_records()?;
    let mut matters = BTreeSet::new();
    for record in records {
        let Some(object) = record.as_object() else {
            continue;
        };
        let Some(id) = string_field(object, "id") else {
            continue;
        };
        let kind = string_field(object, "kind").unwrap_or_else(|| "record".to_string());
        let matter_id = string_field(object, "matterId").unwrap_or_else(|| "firm".to_string());
        store.index_fts(&id, &kind, &matter_id, &record_content(&record))?;
        matters.insert(matter_id);
    }
    Ok(matters)
}

/// Search only decrypted local CRM projection rows. `matter_id` is optional
/// for the firm-wide Clients directory; when supplied, no other client's rows
/// are returned.
#[tauri::command]
pub async fn crm_search(
    state: State<'_, CrmState>,
    query: String,
    matter_id: Option<String>,
) -> Result<Vec<CrmSearchHit>, String> {
    let query =
        fts_query(&query).ok_or_else(|| "Type a word or two to search CRM records.".to_string())?;
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Open a workspace before searching CRM records.".to_string())?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let matters = rebuild_live_index(&store)?;
        let scopes = match matter_id.filter(|scope| !scope.trim().is_empty()) {
            Some(scope) => vec![scope],
            None => matters.into_iter().collect(),
        };
        let mut hits = Vec::new();
        for scope in scopes {
            for hit in store.search_fts(&scope, &query)? {
                let record = serde_json::from_str::<Value>(&hit.content).unwrap_or(Value::Null);
                let object = record.as_object();
                let title = object
                    .map(|value| record_title(value, &hit.entity_kind, &hit.entity_id))
                    .unwrap_or_else(|| format!("{} {}", hit.entity_kind, hit.entity_id));
                hits.push(CrmSearchHit {
                    entity_id: hit.entity_id,
                    entity_kind: hit.entity_kind,
                    matter_id: hit.matter_id,
                    title,
                    snippet: make_snippet(&hit.content, &query.replace('*', "")),
                    content: hit.content,
                });
                if hits.len() >= 40 {
                    return Ok(hits);
                }
            }
        }
        Ok(hits)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error: anyhow::Error| error.to_string())
}

/// One CRM citation to verify against the live SQLCipher record. Mirrors the
/// RAG citation verifier's contract so the frontend can treat both identically.
/// `entity_id` + `entity_kind` are parsed from the `crm:<kind>:<id>` citation
/// path; `claimed_matter_id` is the client the answer says the record belongs
/// to; `quoted_text` is the span the answer attributes to it.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrmCitationToVerify {
    pub entity_id: String,
    pub entity_kind: String,
    pub claimed_matter_id: String,
    pub quoted_text: String,
}

/// The verdict for one CRM citation. Same vocabulary and IPC shape as the RAG
/// verifier's `Verdict`: only `verified` is safe to present as green.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "verdict", rename_all = "camelCase")]
pub enum CrmCitationVerdict {
    Verified,
    NotFound,
    TextMismatch,
    MatterMismatch {
        #[serde(rename = "actualMatter")]
        actual_matter: String,
    },
}

/// Canonicalized containment (same transform on both sides): Unicode-lowercase,
/// curly quotes straightened, whitespace runs collapsed. Mirrors the RAG
/// verifier's `text_contains_normalized` so a CRM quote that grounded also
/// verifies. An empty normalized quote never verifies (fail closed).
fn crm_text_contains_normalized(stored: &str, quoted: &str) -> bool {
    fn canon(s: &str) -> String {
        let lowered = s.to_lowercase();
        let straightened: String = lowered
            .chars()
            .map(|c| match c {
                '\u{2018}' | '\u{2019}' => '\'',
                '\u{201C}' | '\u{201D}' => '"',
                other => other,
            })
            .collect();
        straightened.split_whitespace().collect::<Vec<_>>().join(" ")
    }
    let q = canon(quoted);
    if q.is_empty() {
        return false;
    }
    canon(stored).contains(&q)
}

/// Classify one CRM citation against the current live records.
///
///   1. Look for a record matching the FULL identity — id AND entity kind AND
///      the claimed client. If found, rebuild the exact text the citation was
///      drawn from (`title \n record_content`) and assert it still CONTAINS the
///      quoted span → `Verified`; otherwise `TextMismatch` (the record changed).
///   2. If no such record exists in the claimed client, but a same id+kind
///      record exists under ANOTHER client, that is a scope lie →
///      `MatterMismatch { actual_matter }`.
///   3. Otherwise the record is gone → `NotFound`.
///
/// FAIL-CLOSED: anything short of an exact identity + text match is non-Verified.
fn classify_crm_citation(records: &[Value], c: &CrmCitationToVerify) -> CrmCitationVerdict {
    let mut other_matter: Option<String> = None;
    for record in records {
        let Some(object) = record.as_object() else {
            continue;
        };
        let Some(id) = string_field(object, "id") else {
            continue;
        };
        if id != c.entity_id {
            continue;
        }
        let kind = string_field(object, "kind").unwrap_or_else(|| "record".to_string());
        if kind != c.entity_kind {
            continue;
        }
        let matter = string_field(object, "matterId");
        match matter {
            Some(m) if m == c.claimed_matter_id => {
                let stored = format!(
                    "{}\n{}",
                    record_title(object, &c.entity_kind, &c.entity_id),
                    record_content(record)
                );
                return if crm_text_contains_normalized(&stored, &c.quoted_text) {
                    CrmCitationVerdict::Verified
                } else {
                    CrmCitationVerdict::TextMismatch
                };
            }
            Some(m) => {
                if other_matter.is_none() {
                    other_matter = Some(m);
                }
            }
            None => {}
        }
    }
    match other_matter {
        Some(actual_matter) => CrmCitationVerdict::MatterMismatch { actual_matter },
        None => CrmCitationVerdict::NotFound,
    }
}

/// Verify CRM citations against the decrypted live SQLCipher records on THIS
/// device. A search result proves "this row was retrieved once"; it does not
/// prove "this exact record still exists for this client." This command is that
/// second proof — the click-through equivalent for the trust badge, so a CRM
/// citation is only ever labelled verified after the live record is checked.
#[tauri::command]
pub async fn crm_verify_citations(
    state: State<'_, CrmState>,
    citations: Vec<CrmCitationToVerify>,
) -> Result<Vec<CrmCitationVerdict>, String> {
    if citations.is_empty() {
        return Ok(Vec::new());
    }
    let workspace = state
        .workspace
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Open a workspace before verifying CRM records.".to_string())?;
    tokio::task::spawn_blocking(move || {
        let store = CrmCoreStore::open(&workspace)?;
        let records = store.list_live_records()?;
        Ok::<Vec<CrmCitationVerdict>, anyhow::Error>(
            citations
                .iter()
                .map(|c| classify_crm_citation(&records, c))
                .collect(),
        )
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error: anyhow::Error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn makes_a_safe_prefix_query_without_fts_syntax() {
        assert_eq!(
            fts_query("retirement 401(k)"),
            Some("retirement* AND 401* AND k*".to_string())
        );
        assert_eq!(fts_query("***"), None);
    }

    #[test]
    fn snippet_stays_readable() {
        assert!(make_snippet(
            "A saved internal note about retirement income planning.",
            "retirement"
        )
        .contains("retirement"));
    }

    #[test]
    fn json_household_match_is_presented_as_a_fact_without_internal_fields() {
        let content = serde_json::json!({
            "id": "household:internal-id",
            "kind": "household",
            "name": "Exam Test Household",
            "facts": [{
                "id": "fact:internal-id",
                "label": "Exam probe fact",
                "value": "Garnet lighthouse 4471",
                "asOf": "2026-07-13",
                "sources": [{ "id": "source:internal-id", "label": "Advisor call" }]
            }]
        })
        .to_string();

        let snippet = make_snippet(&content, "Garnet lighthouse");

        assert!(snippet.contains("Fact: Exam probe fact"));
        assert!(snippet.contains("Garnet lighthouse 4471"));
        assert!(snippet.contains("Source: Advisor call"));
        assert!(snippet.contains("As of 2026-07-13"));
        assert!(!snippet.contains("\"label\""));
        assert!(!snippet.contains("internal-id"));
    }

    fn note(id: &str, matter: &str, body: &str) -> Value {
        serde_json::json!({ "id": id, "kind": "note", "matterId": matter, "body": body })
    }

    #[test]
    fn crm_verify_never_verifies_a_same_id_record_from_another_client() {
        // Two clients each own a `note-1`. A citation for client-a must NEVER
        // verify against client-b's row — it is a MatterMismatch (Ask-seam #5).
        let records = vec![
            note("note-1", "client-b", "Wrong client note"),
            note("note-1", "client-a", "Retire at 62"),
        ];
        let verdict = classify_crm_citation(
            &records,
            &CrmCitationToVerify {
                entity_id: "note-1".into(),
                entity_kind: "note".into(),
                claimed_matter_id: "client-a".into(),
                quoted_text: "Retire at 62".into(),
            },
        );
        assert_eq!(verdict, CrmCitationVerdict::Verified);

        // If ONLY the other client's row exists, the claim is a scope lie.
        let only_b = vec![note("note-1", "client-b", "Wrong client note")];
        assert_eq!(
            classify_crm_citation(
                &only_b,
                &CrmCitationToVerify {
                    entity_id: "note-1".into(),
                    entity_kind: "note".into(),
                    claimed_matter_id: "client-a".into(),
                    quoted_text: "Retire at 62".into(),
                },
            ),
            CrmCitationVerdict::MatterMismatch {
                actual_matter: "client-b".into()
            }
        );
    }

    #[test]
    fn crm_verify_reports_deleted_and_altered_records_honestly() {
        // Record deleted/moved → NotFound.
        assert_eq!(
            classify_crm_citation(
                &[],
                &CrmCitationToVerify {
                    entity_id: "note-1".into(),
                    entity_kind: "note".into(),
                    claimed_matter_id: "client-a".into(),
                    quoted_text: "Retire at 62".into(),
                },
            ),
            CrmCitationVerdict::NotFound
        );

        // Record still present for this client but its content changed → the
        // quote can no longer be found → TextMismatch, never Verified.
        let altered = vec![note("note-1", "client-a", "Retire at 70 now")];
        assert_eq!(
            classify_crm_citation(
                &altered,
                &CrmCitationToVerify {
                    entity_id: "note-1".into(),
                    entity_kind: "note".into(),
                    claimed_matter_id: "client-a".into(),
                    quoted_text: "Retire at 62".into(),
                },
            ),
            CrmCitationVerdict::TextMismatch
        );

        // Same id but different entity KIND (a task, not the cited note) →
        // never verified in the note's place.
        let task = vec![serde_json::json!({
            "id": "note-1", "kind": "task", "matterId": "client-a", "body": "Retire at 62"
        })];
        assert_eq!(
            classify_crm_citation(
                &task,
                &CrmCitationToVerify {
                    entity_id: "note-1".into(),
                    entity_kind: "note".into(),
                    claimed_matter_id: "client-a".into(),
                    quoted_text: "Retire at 62".into(),
                },
            ),
            CrmCitationVerdict::NotFound
        );
    }
}

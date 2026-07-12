//! Local-only CRM retrieval over the encrypted core's FTS projection.
//!
//! The projection is deliberately rebuilt from the current live collection
//! documents before each query. It never crosses the relay and only exists in
//! the SQLCipher database on this device.

use std::collections::BTreeSet;

use serde::Serialize;
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
    record.get(field).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(ToOwned::to_owned)
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

fn make_snippet(content: &str, query: &str) -> String {
    let normalized = content.split_whitespace().collect::<Vec<_>>().join(" ");
    let lower = normalized.to_lowercase();
    let term = query.split_whitespace().find(|term| !term.is_empty()).unwrap_or_default().to_lowercase();
    let start = lower.find(&term).unwrap_or(0).saturating_sub(90);
    let end = (start + 280).min(normalized.len());
    let mut snippet = normalized.get(start..end).unwrap_or(&normalized).to_owned();
    if start > 0 { snippet.insert_str(0, "…"); }
    if end < normalized.len() { snippet.push('…'); }
    snippet
}

fn rebuild_live_index(store: &CrmCoreStore) -> anyhow::Result<BTreeSet<String>> {
    let records = store.list_live_records()?;
    let mut matters = BTreeSet::new();
    for record in records {
        let Some(object) = record.as_object() else { continue };
        let Some(id) = string_field(object, "id") else { continue };
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
    let query = fts_query(&query).ok_or_else(|| "Type a word or two to search CRM records.".to_string())?;
    let workspace = state.workspace.lock().await.clone().ok_or_else(|| "Open a workspace before searching CRM records.".to_string())?;
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
                let title = object.map(|value| record_title(value, &hit.entity_kind, &hit.entity_id)).unwrap_or_else(|| format!("{} {}", hit.entity_kind, hit.entity_id));
                hits.push(CrmSearchHit {
                    entity_id: hit.entity_id,
                    entity_kind: hit.entity_kind,
                    matter_id: hit.matter_id,
                    title,
                    snippet: make_snippet(&hit.content, &query.replace('*', "")),
                    content: hit.content,
                });
                if hits.len() >= 40 { return Ok(hits); }
            }
        }
        Ok(hits)
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
        assert_eq!(fts_query("retirement 401(k)"), Some("retirement* AND 401* AND k*".to_string()));
        assert_eq!(fts_query("***"), None);
    }

    #[test]
    fn snippet_stays_readable() {
        assert!(make_snippet("A saved internal note about retirement income planning.", "retirement").contains("retirement"));
    }
}

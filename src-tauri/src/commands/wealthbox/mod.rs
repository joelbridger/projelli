use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tauri::State;

const KEYCHAIN_SERVICE: &str = "keepance-wealthbox";
const KEYCHAIN_ACCESS_TOKEN_KEY: &str = "access-token";
const WEALTHBOX_BASE_URL: &str = "https://api.crmworkspace.com/v1";
const PER_PAGE: u32 = 100;

#[derive(Debug, Clone)]
pub struct WealthboxClient {
    token: String,
    base: String,
    http: reqwest::Client,
    page_delay: Duration,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WealthboxConnectResult {
    pub connected: bool,
    pub account_name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WealthboxContactSummary {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub contact_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WealthboxSyncMapping {
    pub wealthbox_contact_id: String,
    pub matter_id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WealthboxSyncSummary {
    pub wealthbox_contact_id: String,
    pub matter_id: String,
    pub contacts_indexed: u32,
    pub notes_indexed: u32,
    pub tasks_indexed: u32,
    pub events_indexed: u32,
    pub chunks_indexed: u32,
    pub model_not_ready: bool,
    pub error: Option<String>,
}

impl WealthboxClient {
    pub fn new(token: String) -> Self {
        Self::new_with_base(token, WEALTHBOX_BASE_URL.to_string())
    }

    pub fn new_with_base(token: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self {
            token,
            base,
            http,
            page_delay: Duration::from_secs(1),
        }
    }

    #[cfg(test)]
    fn without_page_delay(mut self) -> Self {
        self.page_delay = Duration::ZERO;
        self
    }

    pub async fn me(&self) -> anyhow::Result<Value> {
        self.get_json("me", &[]).await
    }

    pub async fn list_contacts(&self) -> anyhow::Result<Vec<WealthboxContactSummary>> {
        let values = self.paginate_collection("contacts", &[]).await?;
        Ok(values
            .iter()
            .filter_map(contact_summary_from_value)
            .collect())
    }

    async fn get_contact(&self, contact_id: &str) -> anyhow::Result<Value> {
        self.get_json(&format!("contacts/{}", enc_path_segment(contact_id)), &[])
            .await
            .map(extract_single_object)
    }

    async fn contact_items(
        &self,
        collection: &str,
        contact_id: &str,
    ) -> anyhow::Result<Vec<Value>> {
        self.paginate_collection(collection, &[("contact_id", contact_id)])
            .await
    }

    pub async fn get_json(&self, path: &str, query: &[(&str, &str)]) -> anyhow::Result<Value> {
        let url = format!(
            "{}/{}",
            self.base.trim_end_matches('/'),
            path.trim_start_matches('/')
        );
        for attempt in 0..8u32 {
            let resp = self
                .http
                .get(&url)
                .header("ACCESS_TOKEN", &self.token)
                .query(query)
                .send()
                .await?;
            if resp.status().as_u16() == 429 {
                let retry_after = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                tokio::time::sleep(retry_delay(retry_after.as_deref(), attempt)).await;
                continue;
            }
            let status = resp.status();
            let body = resp.text().await?;
            if !status.is_success() {
                log::warn!("wealthbox request failed (HTTP {}): {}", status, body);
                anyhow::bail!("Wealthbox request failed (HTTP {})", status);
            }
            return Ok(serde_json::from_str(&body)?);
        }
        anyhow::bail!("Wealthbox throttled the request for too long")
    }

    async fn paginate_collection(
        &self,
        collection: &str,
        extra_query: &[(&str, &str)],
    ) -> anyhow::Result<Vec<Value>> {
        let mut page = 1u32;
        let mut out = Vec::new();
        loop {
            let page_s = page.to_string();
            let per_page_s = PER_PAGE.to_string();
            let mut query = vec![("page", page_s.as_str()), ("per_page", per_page_s.as_str())];
            query.extend(extra_query.iter().copied());
            let json = self.get_json(collection, &query).await?;
            out.extend(extract_collection(&json, collection));
            let total_pages = json
                .get("meta")
                .and_then(|m| m.get("total_pages").or_else(|| m.get("totalPages")))
                .and_then(|v| v.as_u64())
                .unwrap_or(page as u64);
            if page as u64 >= total_pages {
                break;
            }
            page += 1;
            if !self.page_delay.is_zero() {
                tokio::time::sleep(self.page_delay).await;
            }
        }
        Ok(out)
    }
}

#[tauri::command]
pub async fn wealthbox_connect(token: String) -> Result<WealthboxConnectResult, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Paste your Wealthbox access token first.".to_string());
    }
    let client = WealthboxClient::new(token.clone());
    let me = client
        .me()
        .await
        .map_err(|e| format!("Could not validate this Wealthbox token: {e}"))?;
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCESS_TOKEN_KEY)
        .map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())?;
    Ok(WealthboxConnectResult {
        connected: true,
        account_name: name_from_value(&extract_single_object(me)),
    })
}

#[tauri::command]
pub async fn wealthbox_is_connected() -> Result<bool, String> {
    Ok(load_token().is_ok())
}

#[tauri::command]
pub async fn wealthbox_disconnect() -> Result<(), String> {
    if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCESS_TOKEN_KEY) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

#[tauri::command]
pub async fn wealthbox_list_contacts() -> Result<Vec<WealthboxContactSummary>, String> {
    let token = load_token()?;
    WealthboxClient::new(token)
        .list_contacts()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn wealthbox_sync(
    state: State<'_, crate::commands::rag::RagState>,
    mappings: Vec<WealthboxSyncMapping>,
) -> Result<Vec<WealthboxSyncSummary>, String> {
    let token = load_token()?;
    let workspace = state
        .workspace_root
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Open a workspace before syncing Wealthbox.".to_string())?;
    let client = WealthboxClient::new(token);
    let mut summaries = Vec::with_capacity(mappings.len());
    for mapping in mappings {
        summaries.push(sync_one_mapping(&client, &workspace, mapping).await);
    }
    Ok(summaries)
}

async fn sync_one_mapping(
    client: &WealthboxClient,
    workspace: &std::path::Path,
    mapping: WealthboxSyncMapping,
) -> WealthboxSyncSummary {
    let mut summary = WealthboxSyncSummary {
        wealthbox_contact_id: mapping.wealthbox_contact_id.clone(),
        matter_id: mapping.matter_id.clone(),
        ..Default::default()
    };

    if let Err(e) = crate::commands::rag::store::validate_matter_id(&mapping.matter_id) {
        summary.error = Some(format!("Invalid matter id: {e}"));
        return summary;
    }

    let contact = match client.get_contact(&mapping.wealthbox_contact_id).await {
        Ok(contact) => contact,
        Err(e) => {
            summary.error = Some(format!("Could not fetch Wealthbox contact: {e}"));
            return summary;
        }
    };
    if index_wealthbox_value(
        workspace,
        &format!("wealthbox:contact:{}", mapping.wealthbox_contact_id),
        &render_contact(&contact),
        &mapping.matter_id,
        &mut summary,
    )
    .await
    {
        summary.contacts_indexed += 1;
    } else if summary.model_not_ready || summary.error.is_some() {
        return summary;
    }

    for (collection, count_field) in [("notes", "notes"), ("tasks", "tasks"), ("events", "events")]
    {
        let items = match client
            .contact_items(collection, &mapping.wealthbox_contact_id)
            .await
        {
            Ok(items) => items,
            Err(e) => {
                summary.error = Some(format!("Could not fetch Wealthbox {collection}: {e}"));
                return summary;
            }
        };
        for (idx, item) in items.iter().enumerate() {
            let id = value_id(item)
                .unwrap_or_else(|| format!("{}-{}", mapping.wealthbox_contact_id, idx));
            let source_id = format!("wealthbox:{}:{}", collection.trim_end_matches('s'), id);
            if !index_wealthbox_value(
                workspace,
                &source_id,
                &render_item(collection, item),
                &mapping.matter_id,
                &mut summary,
            )
            .await
            {
                if summary.model_not_ready || summary.error.is_some() {
                    return summary;
                }
            } else {
                match count_field {
                    "notes" => summary.notes_indexed += 1,
                    "tasks" => summary.tasks_indexed += 1,
                    "events" => summary.events_indexed += 1,
                    _ => {}
                }
            }
        }
    }

    summary
}

async fn index_wealthbox_value(
    workspace: &std::path::Path,
    source_id: &str,
    text: &str,
    matter_id: &str,
    summary: &mut WealthboxSyncSummary,
) -> bool {
    match crate::commands::rag::text_ingest::index_text(
        workspace,
        source_id,
        text,
        matter_id,
        crate::commands::rag::store::SourceType::Wealthbox,
    )
    .await
    {
        Ok(chunks) => {
            summary.chunks_indexed += chunks;
            chunks > 0
        }
        Err(e) if error_is_model_not_ready(&e) => {
            summary.model_not_ready = true;
            summary.error = Some(
                "The local search model is not downloaded yet. Wealthbox was not indexed. Try again after Memory finishes setup."
                    .to_string(),
            );
            false
        }
        Err(e) => {
            summary.error = Some(format!("Could not index Wealthbox data: {e:#}"));
            false
        }
    }
}

fn load_token() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCESS_TOKEN_KEY)
        .map_err(|e| e.to_string())?;
    entry
        .get_password()
        .map_err(|_| "Wealthbox is not connected.".to_string())
}

fn error_is_model_not_ready(err: &anyhow::Error) -> bool {
    format!("{err:#}").contains(crate::commands::rag::embedder::MODEL_NOT_READY)
}

pub fn retry_delay(retry_after_header: Option<&str>, attempt: u32) -> Duration {
    const MAX_HEADER_SECS: u64 = 120;
    if let Some(header) = retry_after_header {
        if let Ok(secs) = header.trim().parse::<u64>() {
            return Duration::from_secs(secs.min(MAX_HEADER_SECS));
        }
    }
    let secs = 1u64.checked_shl(attempt).unwrap_or(60).min(60);
    Duration::from_secs(secs)
}

fn extract_collection(json: &Value, collection: &str) -> Vec<Value> {
    if let Some(items) = json.get(collection).and_then(|v| v.as_array()) {
        return items.clone();
    }
    if let Some(items) = json.get("data").and_then(|v| v.as_array()) {
        return items.clone();
    }
    if let Some(items) = json.get("items").and_then(|v| v.as_array()) {
        return items.clone();
    }
    json.as_array().cloned().unwrap_or_default()
}

fn extract_single_object(json: Value) -> Value {
    if let Some(value) = json
        .get("contact")
        .or_else(|| json.get("user"))
        .or_else(|| json.get("data"))
    {
        return value.clone();
    }
    json
}

fn contact_summary_from_value(v: &Value) -> Option<WealthboxContactSummary> {
    let id = value_id(v)?;
    Some(WealthboxContactSummary {
        id,
        name: name_from_value(v).unwrap_or_else(|| "Unnamed contact".to_string()),
        contact_type: contact_type(v).to_string(),
    })
}

fn value_id(v: &Value) -> Option<String> {
    v.get("id").and_then(value_to_string)
}

fn value_to_string(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn name_from_value(v: &Value) -> Option<String> {
    for key in ["name", "full_name", "display_name", "company_name", "title"] {
        if let Some(name) = v.get(key).and_then(|x| x.as_str()).map(str::trim) {
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    let first = v
        .get("first_name")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim();
    let last = v
        .get("last_name")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim();
    let combined = format!("{first} {last}").trim().to_string();
    if combined.is_empty() {
        None
    } else {
        Some(combined)
    }
}

fn contact_type(v: &Value) -> &'static str {
    let haystack = [
        v.get("type"),
        v.get("contact_type"),
        v.get("kind"),
        v.get("object_type"),
    ]
    .into_iter()
    .flatten()
    .filter_map(|x| x.as_str())
    .collect::<Vec<_>>()
    .join(" ")
    .to_ascii_lowercase();
    if haystack.contains("household") {
        "household"
    } else {
        "person"
    }
}

fn render_contact(contact: &Value) -> String {
    let mut lines = vec!["Wealthbox contact".to_string()];
    push_field(&mut lines, "Name", name_from_value(contact));
    push_field(&mut lines, "Type", Some(contact_type(contact).to_string()));
    push_field(
        &mut lines,
        "Email",
        first_string(contact, &["email", "email_address"]),
    );
    push_field(
        &mut lines,
        "Phone",
        first_string(contact, &["phone", "phone_number"]),
    );
    push_field(
        &mut lines,
        "Status",
        first_string(contact, &["status", "stage"]),
    );
    push_field(
        &mut lines,
        "Summary",
        first_string(contact, &["description", "background", "notes"]),
    );
    if let Some(members) = contact.get("members").and_then(|v| v.as_array()) {
        let names = members
            .iter()
            .filter_map(name_from_value)
            .collect::<Vec<_>>();
        if !names.is_empty() {
            push_field(&mut lines, "Household members", Some(names.join(", ")));
        }
    }
    lines.push("Raw fields".to_string());
    lines.push(compact_json(contact));
    lines.join("\n")
}

fn render_item(collection: &str, item: &Value) -> String {
    let label = collection.trim_end_matches('s');
    let mut lines = vec![format!("Wealthbox {label}")];
    push_field(
        &mut lines,
        "Title",
        first_string(item, &["title", "subject", "name"]),
    );
    push_field(
        &mut lines,
        "Body",
        first_string(item, &["body", "content", "description", "note"]),
    );
    push_field(
        &mut lines,
        "Status",
        first_string(item, &["status", "state"]),
    );
    push_field(
        &mut lines,
        "Due date",
        first_string(item, &["due_date", "due_at", "date"]),
    );
    push_field(
        &mut lines,
        "Start",
        first_string(item, &["start_time", "starts_at", "start_at"]),
    );
    push_field(
        &mut lines,
        "End",
        first_string(item, &["end_time", "ends_at", "end_at"]),
    );
    lines.push("Raw fields".to_string());
    lines.push(compact_json(item));
    lines.join("\n")
}

fn push_field(lines: &mut Vec<String>, label: &str, value: Option<String>) {
    if let Some(value) = value {
        let value = value.trim();
        if !value.is_empty() {
            lines.push(format!("{label}: {value}"));
        }
    }
}

fn first_string(v: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = v.get(*key).and_then(|x| x.as_str()).map(str::trim) {
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

fn compact_json(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string())
}

fn enc_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[tokio::test]
    async fn paginates_contacts_from_meta_total_pages() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/contacts"))
            .and(header("ACCESS_TOKEN", "token-123"))
            .and(query_param("page", "1"))
            .and(query_param("per_page", "100"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "contacts": [{"id": 1, "name": "Avery Stone", "type": "Person"}],
                "meta": {"total_pages": 2}
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/contacts"))
            .and(header("ACCESS_TOKEN", "token-123"))
            .and(query_param("page", "2"))
            .and(query_param("per_page", "100"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "contacts": [{"id": "hh-2", "name": "Stone Household", "type": "Household"}],
                "meta": {"total_pages": 2}
            })))
            .mount(&server)
            .await;

        let client =
            WealthboxClient::new_with_base("token-123".into(), server.uri()).without_page_delay();
        let contacts = client.list_contacts().await.expect("contacts");
        assert_eq!(
            contacts,
            vec![
                WealthboxContactSummary {
                    id: "1".into(),
                    name: "Avery Stone".into(),
                    contact_type: "person".into(),
                },
                WealthboxContactSummary {
                    id: "hh-2".into(),
                    name: "Stone Household".into(),
                    contact_type: "household".into(),
                },
            ]
        );
    }

    #[tokio::test]
    async fn retries_after_429_before_returning_page() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/contacts"))
            .and(query_param("page", "1"))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "0"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/contacts"))
            .and(query_param("page", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "contacts": [{"id": 7, "first_name": "Mira", "last_name": "Lee"}],
                "meta": {"total_pages": 1}
            })))
            .mount(&server)
            .await;

        let client =
            WealthboxClient::new_with_base("token-123".into(), server.uri()).without_page_delay();
        let contacts = client.list_contacts().await.expect("contacts after retry");
        assert_eq!(contacts.len(), 1);
        assert_eq!(contacts[0].name, "Mira Lee");
    }

    #[tokio::test]
    #[ignore = "requires a real Wealthbox token in WEALTHBOX_TEST_TOKEN"]
    async fn wealthbox_live_smoke() {
        let token = std::env::var("WEALTHBOX_TEST_TOKEN")
            .expect("WEALTHBOX_TEST_TOKEN must be set for live smoke");
        let client = WealthboxClient::new(token);
        client.me().await.expect("validate token with /me");
        let _ = client.list_contacts().await.expect("list contacts");
    }
}

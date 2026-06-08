use std::time::Duration;

#[derive(Debug, PartialEq)]
pub enum Continuation { Next(String), Delta(String), End }

/// Sentinel error: the delta token has expired (HTTP 410). Callers can
/// downcast with `e.downcast_ref::<DeltaGone>()` instead of string-matching.
#[derive(Debug)]
pub struct DeltaGone;
impl std::fmt::Display for DeltaGone {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "delta token expired (410 Gone): full resync required")
    }
}
impl std::error::Error for DeltaGone {}

pub struct GraphClient { token: String, base: String, http: reqwest::Client }

impl GraphClient {
    pub fn new(token: String) -> Self { Self::new_with_base(token, "https://graph.microsoft.com".into()) }
    pub fn new_with_base(token: String, base: String) -> Self {
        // Bound every request so a hung connection can't stall a sync forever.
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self { token, base, http }
    }
    pub fn base(&self) -> &str { &self.base }

    /// GET an absolute Graph URL (used for nextLink/deltaLink which come back
    /// fully-formed), honoring 429/Retry-After with capped backoff. Up to 8 tries.
    pub async fn get_json(&self, url: &str) -> anyhow::Result<serde_json::Value> {
        for attempt in 0..8u32 {
            let resp = self.http.get(url)
                .bearer_auth(&self.token)
                .send().await?;
            if resp.status().as_u16() == 429 {
                let ra = resp.headers().get("Retry-After").and_then(|v| v.to_str().ok()).map(String::from);
                tokio::time::sleep(retry_delay(ra.as_deref(), attempt)).await;
                continue;
            }
            let status = resp.status();
            let body = resp.text().await?;
            if status.as_u16() == 410 { return Err(anyhow::Error::new(DeltaGone)); }
            if !status.is_success() {
                // Never surface the raw Graph body to the caller/UI: it can carry
                // mailbox addresses or other PII. Log locally; return status only.
                log::warn!("graph request failed (HTTP {}): {}", status, body);
                anyhow::bail!("Microsoft Graph request failed (HTTP {})", status);
            }
            return Ok(serde_json::from_str(&body)?);
        }
        anyhow::bail!("graph: throttled past retry budget")
    }

    /// Start a delta round for a folder (no cursor) or resume from a saved
    /// next/delta link. Returns the absolute URL to GET first.
    pub fn delta_start_url(&self, folder_id: &str) -> String {
        format!(
            "{}/v1.0/me/mailFolders/{}/messages/delta",
            self.base,
            enc_path_segment(folder_id)
        )
    }
}

/// Percent-encode a single URL path segment. Graph folder ids are normally
/// base64url (already safe), but we encode anything outside the unreserved set
/// so an odd/hostile id can never break out of the segment (via `/`, `?`, `#`,
/// or a `..` segment). `.` is encoded too, specifically to neutralize `..`.
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

/// Microsoft says: wait the Retry-After seconds and retry; if absent, back off
/// exponentially. Every delay is capped (header included) so a hostile or
/// misconfigured server can't park a sync for hours.
pub fn retry_delay(retry_after_header: Option<&str>, attempt: u32) -> Duration {
    const MAX_HEADER_SECS: u64 = 120;
    if let Some(h) = retry_after_header {
        if let Ok(secs) = h.trim().parse::<u64>() {
            return Duration::from_secs(secs.min(MAX_HEADER_SECS));
        }
    }
    let secs = 1u64.checked_shl(attempt).unwrap_or(60).min(60);
    Duration::from_secs(secs)
}

/// A delta page carries EITHER a nextLink (more pages this round) OR a
/// deltaLink (round complete) OR neither. Never both (per Graph docs).
pub fn page_continuation(page: &serde_json::Value) -> Continuation {
    if let Some(n) = page.get("@odata.nextLink").and_then(|v| v.as_str()) {
        return Continuation::Next(n.to_string());
    }
    if let Some(d) = page.get("@odata.deltaLink").and_then(|v| v.as_str()) {
        return Continuation::Delta(d.to_string());
    }
    Continuation::End
}

use crate::commands::mail::model::MailMessage;
use crate::commands::mail::provider::{ChangePage, Cursor, MailProvider, RemoteFolder};
use async_trait::async_trait;

/// Max consecutive 410 (delta-token-expired) resets within one fetch before giving up.
const PROVIDER_MAX_DELTA_RESETS: u32 = 3;

/// Microsoft 365 implementation of `MailProvider`, wrapping `GraphClient`.
pub struct GraphProvider { client: GraphClient }
impl GraphProvider {
    pub fn new(token: String) -> Self { Self { client: GraphClient::new(token) } }
    pub fn new_with_base(token: String, base: String) -> Self { Self { client: GraphClient::new_with_base(token, base) } }
}

#[async_trait]
impl MailProvider for GraphProvider {
    fn kind(&self) -> &'static str { "m365" }

    async fn list_folders(&self) -> anyhow::Result<Vec<RemoteFolder>> {
        let mut folders = Vec::new();
        let mut next = Some(format!("{}/v1.0/me/mailFolders?$top=200", self.client.base()));
        while let Some(url) = next {
            let page = self.client.get_json(&url).await?;
            if let Some(arr) = page.get("value").and_then(|v| v.as_array()) {
                for f in arr {
                    if let Some(id) = f.get("id").and_then(|s| s.as_str()) {
                        let name = f.get("displayName").and_then(|s| s.as_str()).unwrap_or(id).to_string();
                        folders.push(RemoteFolder { id: id.to_string(), display_name: name });
                    }
                }
            }
            next = page.get("@odata.nextLink").and_then(|v| v.as_str()).map(String::from);
        }
        Ok(folders)
    }

    async fn fetch_changes(&self, folder: &RemoteFolder, cursor: &Cursor) -> anyhow::Result<ChangePage> {
        let mut url = match cursor {
            Cursor::Backfill => self.client.delta_start_url(&folder.id),
            Cursor::Resume(t) => t.clone(),
        };
        let mut resets = 0u32;
        let page = loop {
            match self.client.get_json(&url).await {
                Ok(p) => break p,
                Err(e) if e.downcast_ref::<DeltaGone>().is_some() => {
                    resets += 1;
                    if resets > PROVIDER_MAX_DELTA_RESETS {
                        anyhow::bail!("folder {}: delta token expired {} times in a row; giving up", folder.id, resets);
                    }
                    url = self.client.delta_start_url(&folder.id);
                }
                Err(e) => return Err(e),
            }
        };
        let mut messages = Vec::new();
        let mut removed_ids = Vec::new();
        if let Some(arr) = page.get("value").and_then(|v| v.as_array()) {
            for item in arr {
                let id = item.get("id").and_then(|s| s.as_str()).unwrap_or("");
                if id.is_empty() { continue; }
                if MailMessage::is_removed(item) { removed_ids.push(id.to_string()); }
                else if let Some(m) = MailMessage::from_graph(item) { messages.push(m); }
            }
        }
        Ok(match page_continuation(&page) {
            Continuation::Next(n) => ChangePage { messages, removed_ids, next: Some(n), done: false },
            Continuation::Delta(d) => ChangePage { messages, removed_ids, next: Some(d), done: true },
            Continuation::End => ChangePage { messages, removed_ids, next: None, done: true },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn fetches_delta_page_and_retries_on_429() {
        use wiremock::{Mock, MockServer, ResponseTemplate};
        use wiremock::matchers::{method, path};
        let server = MockServer::start().await;
        // First call 429 with Retry-After: 0, second returns a page.
        Mock::given(method("GET")).and(path("/v1.0/me/mailFolders/inbox/messages/delta"))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "0"))
            .up_to_n_times(1).mount(&server).await;
        Mock::given(method("GET")).and(path("/v1.0/me/mailFolders/inbox/messages/delta"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "id": "m1", "subject": "Hi", "body": {"contentType":"text","content":"yo"} }],
                "@odata.deltaLink": "https://x/d?$deltatoken=tok"
            }))).mount(&server).await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let url = format!("{}/v1.0/me/mailFolders/inbox/messages/delta", server.uri());
        let page = client.get_json(&url).await.expect("page");
        assert_eq!(page_continuation(&page), Continuation::Delta("https://x/d?$deltatoken=tok".into()));
        assert_eq!(page["value"][0]["id"], "m1");
    }

    #[test]
    fn retry_after_header_wins() {
        assert_eq!(retry_delay(Some("10"), 0), Duration::from_secs(10));
        assert_eq!(retry_delay(Some("0"), 3), Duration::from_secs(0));
    }

    #[test]
    fn falls_back_to_capped_exponential_backoff() {
        // attempt 0 -> 1s, 1 -> 2s, 2 -> 4s, capped at 60s
        assert_eq!(retry_delay(None, 0), Duration::from_secs(1));
        assert_eq!(retry_delay(None, 2), Duration::from_secs(4));
        assert_eq!(retry_delay(None, 10), Duration::from_secs(60));
    }

    #[test]
    fn retry_after_header_is_capped() {
        // A hostile/misconfigured server cannot park the sync for hours.
        assert_eq!(retry_delay(Some("86400"), 0), Duration::from_secs(120));
        assert_eq!(retry_delay(Some("120"), 0), Duration::from_secs(120));
        assert_eq!(retry_delay(Some("30"), 0), Duration::from_secs(30));
    }

    #[test]
    fn delta_start_url_encodes_unsafe_folder_id() {
        let client = GraphClient::new_with_base("AT".into(), "https://g".into());
        // Normal base64url ids pass through unchanged.
        let safe = client.delta_start_url("AQMkAD-0_abc");
        assert!(safe.ends_with("/mailFolders/AQMkAD-0_abc/messages/delta"), "got {safe}");
        // A traversal/escape attempt is neutralized (no raw `/` or `..` survives).
        let evil = client.delta_start_url("../../etc");
        assert!(!evil.contains("/../../etc/"), "folder id must be encoded: {evil}");
        assert!(evil.contains("%2E%2E%2F%2E%2E%2Fetc"), "expected percent-encoding, got {evil}");
    }

    #[test]
    fn extracts_delta_and_next_links() {
        let next = serde_json::json!({ "value": [], "@odata.nextLink": "https://g/n?$skiptoken=s" });
        let delta = serde_json::json!({ "value": [], "@odata.deltaLink": "https://g/d?$deltatoken=d" });
        assert_eq!(page_continuation(&next), Continuation::Next("https://g/n?$skiptoken=s".into()));
        assert_eq!(page_continuation(&delta), Continuation::Delta("https://g/d?$deltatoken=d".into()));
        assert_eq!(page_continuation(&serde_json::json!({"value":[]})), Continuation::End);
    }

    #[tokio::test]
    async fn http_410_returns_delta_gone_sentinel() {
        use wiremock::{Mock, MockServer, ResponseTemplate};
        use wiremock::matchers::{method, path};
        let server = MockServer::start().await;
        Mock::given(method("GET")).and(path("/v1.0/me/mailFolders/inbox/messages/delta"))
            .respond_with(ResponseTemplate::new(410).set_body_string("Sync state not found"))
            .mount(&server).await;
        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let url = format!("{}/v1.0/me/mailFolders/inbox/messages/delta", server.uri());
        let err = client.get_json(&url).await.expect_err("should fail on 410");
        assert!(
            err.downcast_ref::<DeltaGone>().is_some(),
            "expected DeltaGone sentinel, got: {err}"
        );
    }

    #[tokio::test]
    async fn graph_provider_fetch_changes_backfill_returns_message_and_delta_done() {
        use crate::commands::mail::provider::{Cursor, RemoteFolder};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        use wiremock::matchers::{method, path};

        let server = MockServer::start().await;
        let delta_link = format!("{}/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=tok123", server.uri());
        Mock::given(method("GET")).and(path("/v1.0/me/mailFolders/inbox/messages/delta"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "id": "msg1", "subject": "Hello from Graph", "body": { "contentType": "text", "content": "Body text here." } }],
                "@odata.deltaLink": delta_link
            }))).mount(&server).await;

        let provider = GraphProvider::new_with_base("AT".into(), server.uri());
        let folder = RemoteFolder { id: "inbox".into(), display_name: "Inbox".into() };
        let page = provider.fetch_changes(&folder, &Cursor::Backfill).await.expect("fetch_changes");

        assert_eq!(page.messages.len(), 1, "expected exactly one message");
        assert_eq!(page.messages[0].id, "msg1");
        assert!(page.done, "Cursor::Backfill with deltaLink must be done=true");
        assert_eq!(page.next, Some(delta_link), "next must equal the deltaLink");
        assert!(page.removed_ids.is_empty(), "no tombstones expected");
    }
}

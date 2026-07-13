//! HTTP client for the Wealthbox CRM REST API.
//!
//! GETs for sync; POSTs and PUTs exist ONLY for the approval-gated write
//! path in `write.rs` (note/task creation and the field-update "blend") —
//! no delete anywhere.
//!
//! # Auth
//! The header **`ACCESS_TOKEN: <token>`** (not Bearer / Authorization) is
//! required on every request.
//!
//! # Rate limiting
//! Wealthbox enforces ~1 request/second averaged over 5 minutes.  Two layers:
//!  1. **~1 rps gate** — a `tokio::sync::Mutex<Option<Instant>>` records the
//!     last completed request; before each call we sleep until ≥1 s has elapsed.
//!  2. **429 / Retry-After backoff** — up to [`MAX_429_RETRIES`] retries with
//!     capped exponential delay, mirroring `commands/mail/graph.rs`.
//!
//! # Error policy
//! Non-success HTTP status codes produce a status-only error
//! (`"Wealthbox request failed (HTTP N)"`).  Only the HTTP status code and the
//! request endpoint path are logged — **the raw response body is never logged
//! or returned**.  Response bodies may contain advisor/client PII and must never
//! propagate to logs or the UI.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::Context;
use async_trait::async_trait;

use crate::commands::crm::model::{CrmContact, CrmEvent, CrmNote, CrmTask, DEFAULT_PER_PAGE};
use crate::commands::crm::importer::fetchers::{RawHttpResponse, RawWealthboxTransport};

/// Decode one Wealthbox contact while preserving the failing field path.
///
/// Raw contact JSON can contain client PII, so it must never be included in an
/// error or log. `serde_path_to_error` reports only a structural path (for
/// example `household.members[0].first_name`) plus the expected JSON type.
fn deserialize_crm_contact(value: serde_json::Value) -> anyhow::Result<CrmContact> {
    let encoded = serde_json::to_string(&value).context("encode CrmContact response")?;
    let mut deserializer = serde_json::Deserializer::from_str(&encoded);
    serde_path_to_error::deserialize(&mut deserializer).map_err(|error| {
        anyhow::anyhow!(
            "deserialize CrmContact at {}: {}",
            error.path(),
            error.inner()
        )
    })
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL: &str = "https://api.crmworkspace.com/v1";

/// Maximum seconds to honour a `Retry-After` header (or any single backoff
/// sleep).  Mirrors the cap in `commands/mail/graph.rs`.
const MAX_RETRY_AFTER_SECS: u64 = 120;

/// Maximum number of 429 retry attempts before giving up.
const MAX_429_RETRIES: u32 = 6;

// ---------------------------------------------------------------------------
// Internal label cache
// ---------------------------------------------------------------------------

/// In-memory cache for numeric id → label resolution (categories / users / teams).
/// Lazily populated on first use; never persisted across app restarts.
#[derive(Debug, Default)]
struct LabelCache {
    /// category_type → (id → label string).
    categories: HashMap<String, HashMap<i64, String>>,
    /// Set of category types whose full list has been fetched.
    categories_loaded: std::collections::HashSet<String>,
    users: HashMap<i64, String>,
    users_loaded: bool,
    teams: HashMap<i64, String>,
    teams_loaded: bool,
}

// ---------------------------------------------------------------------------
// WealthboxClient
// ---------------------------------------------------------------------------

/// Read-only Wealthbox API client.
///
/// Create with [`WealthboxClient::new`] for production or
/// [`WealthboxClient::new_with_base`] for tests (pointing at a local mock).
pub struct WealthboxClient {
    token: String,
    base: String,
    http: crate::commands::connector_network::GuardedHttpClient,
    /// Guards the ~1 rps rate gate.  Stores the `Instant` of the most recent
    /// completed (or started) request; `None` before any request.
    last_request: tokio::sync::Mutex<Option<Instant>>,
    /// Lazily-populated id → label resolver cache.
    label_cache: tokio::sync::Mutex<LabelCache>,
    network_policy: crate::network_policy::NetworkPolicy,
    network_operation: crate::network_policy::EgressOperation,
    configured_host: Option<String>,
}

impl WealthboxClient {
    /// Construct a production client pointing at `https://api.crmworkspace.com/v1`.
    pub fn new(
        token: String,
        network_policy: crate::network_policy::NetworkPolicy,
        network_operation: crate::network_policy::EgressOperation,
    ) -> Self {
        Self::new_guarded(token, BASE_URL.to_string(), network_policy, network_operation, None)
    }

    /// Construct a client with a custom base URL — intended for tests.
    #[cfg(test)]
    pub fn new_with_base(token: String, base: String) -> Self {
        let policy = crate::network_policy::NetworkPolicy::load_from_directory(
            &tempfile::tempdir().expect("test policy directory").keep(),
        );
        Self::new_guarded(
            token,
            base,
            policy,
            crate::network_policy::LOCAL_LLAMA,
            None,
        )
    }

    /// The sample migration accepts a person-entered simulator address. It is
    /// still a real network route, so its exact host is captured once here and
    /// checked again before every page request.
    pub fn new_migration(
        token: String,
        base: String,
        network_policy: crate::network_policy::NetworkPolicy,
    ) -> anyhow::Result<Self> {
        let configured_host = reqwest::Url::parse(&base)?
            .host_str()
            .ok_or_else(|| anyhow::anyhow!("The simulator address has no host."))?
            .to_string();
        Ok(Self::new_guarded(
            token,
            base,
            network_policy,
            crate::network_policy::CRM_MIGRATION_IMPORT,
            Some(configured_host),
        ))
    }

    fn new_guarded(
        token: String,
        base: String,
        network_policy: crate::network_policy::NetworkPolicy,
        network_operation: crate::network_policy::EgressOperation,
        configured_host: Option<String>,
    ) -> Self {
        let http = crate::commands::connector_network::guarded_http_client(
            Duration::from_secs(60),
            Duration::from_secs(15),
        );
        Self {
            token,
            base,
            http,
            last_request: tokio::sync::Mutex::new(None),
            label_cache: tokio::sync::Mutex::new(LabelCache::default()),
            network_policy,
            network_operation,
            configured_host,
        }
    }

    async fn send_guarded(
        &self,
        url: &str,
        request: crate::commands::connector_network::GuardedRequestBuilder,
    ) -> anyhow::Result<crate::commands::connector_network::GuardedResponse> {
        crate::commands::connector_network::send_guarded(
            &self.network_policy,
            &self.network_operation,
            url,
            self.configured_host.as_deref(),
            request,
        )
        .await
    }

    // -----------------------------------------------------------------------
    // ~1 rps gate
    // -----------------------------------------------------------------------

    /// Enforce the ~1 request-per-second rate gate.
    ///
    /// Acquires the mutex, inspects the last-request timestamp, sleeps if less
    /// than 1 second has elapsed, then records the new request time.  The lock
    /// is held for the duration so concurrent callers queue rather than burst.
    async fn rate_gate(&self) {
        let mut guard = self.last_request.lock().await;
        if let Some(last) = *guard {
            let elapsed = last.elapsed();
            if elapsed < Duration::from_secs(1) {
                tokio::time::sleep(Duration::from_secs(1) - elapsed).await;
            }
        }
        *guard = Some(Instant::now());
    }

    // -----------------------------------------------------------------------
    // Core HTTP helper
    // -----------------------------------------------------------------------

    /// GET `path` (relative to `self.base`, or an absolute URL) with `query`
    /// params, returning the parsed JSON body.
    ///
    /// Applies the ~1 rps gate and 429/Retry-After capped backoff.
    /// Non-success status codes surface a status-only error; only the HTTP
    /// status and endpoint path are logged — the raw body is **never logged
    /// or returned** (it may contain advisor/client PII).
    pub async fn get_json(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> anyhow::Result<serde_json::Value> {
        let query = query.iter().map(|(key, value)| ((*key).to_string(), value.clone())).collect::<Vec<_>>();
        let raw = self.get_raw_response(path, &query).await?;
        serde_json::from_slice(&raw.response_bytes).context("parse Wealthbox JSON response")
    }

    /// Returns verbatim response bytes for the importer before JSON parsing.
    /// The shared rate gate and status-only logging remain the sole transport
    /// path, so capture cannot create a second request limiter or leak PII.
    pub async fn get_raw_response(
        &self,
        path: &str,
        query: &[(String, String)],
    ) -> anyhow::Result<RawHttpResponse> {
        let url = if path.starts_with("http") { path.to_string() } else { format!("{}{}", self.base, path) };
        for attempt in 0..MAX_429_RETRIES {
            self.rate_gate().await;
            let mut req = self.http.get(&url).header("ACCESS_TOKEN", &self.token);
            for (key, value) in query { req = req.query(&[(key.as_str(), value.as_str())]); }
            let response = self
                .send_guarded(&url, req)
                .await
                .map_err(|error| crate::commands::connector_network::transport_error(error, "Wealthbox HTTP send"))?;
            if response.status().as_u16() == 429 {
                let retry_after = response.headers().get("Retry-After").and_then(|value| value.to_str().ok()).map(String::from);
                response
                    .wait_before_retry(retry_delay(retry_after.as_deref(), attempt))
                    .await
                    .map_err(|error| crate::commands::connector_network::transport_error(error, "Wealthbox retry wait"))?;
                continue;
            }
            let status = response.status();
            let response_bytes = response.bytes().await.context("read Wealthbox response body")?.to_vec();
            if !status.is_success() {
                // Raw bytes are intentionally neither logged nor returned on failure.
                log::warn!("Wealthbox request failed: HTTP {} at {}", status, path);
                anyhow::bail!("Wealthbox request failed (HTTP {})", status);
            }
            return Ok(RawHttpResponse { request_path: path.to_string(), response_bytes });
        }
        anyhow::bail!("Wealthbox: throttled past retry budget ({} attempts)", MAX_429_RETRIES)
    }

    /// POST `path` with a JSON `body`, returning the parsed JSON response.
    ///
    /// Same rate gate and PII discipline as [`Self::get_json`]. Retries ONLY
    /// on 429 (the request was rejected, so a retry cannot double-create).
    /// Any other failure returns immediately — the caller's idempotency
    /// ledger (see `write.rs`) decides whether a re-send is safe.
    pub async fn post_json(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        let url = if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.base, path)
        };
        for attempt in 0..MAX_429_RETRIES {
            self.rate_gate().await;
            let request = self
                .http
                .post(&url)
                .header("ACCESS_TOKEN", &self.token)
                .json(body);
            let resp = self
                .send_guarded(&url, request)
                .await
                .map_err(|error| crate::commands::connector_network::transport_error(error, "Wealthbox HTTP send"))?;
            if resp.status().as_u16() == 429 {
                let ra = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                resp.wait_before_retry(retry_delay(ra.as_deref(), attempt))
                    .await
                    .map_err(|error| crate::commands::connector_network::transport_error(error, "Wealthbox retry wait"))?;
                continue;
            }
            let status = resp.status();
            let text = resp.text().await.context("read Wealthbox response body")?;
            if !status.is_success() {
                // Status + endpoint only — body is NEVER logged (may contain advisor/client PII).
                log::warn!("Wealthbox write failed: HTTP {} at {}", status, path);
                anyhow::bail!("Wealthbox request failed (HTTP {})", status);
            }
            return serde_json::from_str(&text).context("parse Wealthbox JSON response");
        }
        anyhow::bail!("Wealthbox: throttled past retry budget ({} attempts)", MAX_429_RETRIES)
    }

    /// PUT `path` with a JSON `body`, returning the parsed JSON response.
    ///
    /// Same rate gate and PII discipline as [`Self::post_json`]/[`Self::get_json`].
    /// Retries ONLY on 429. Used for the field-update "blend" (Task 9c) —
    /// unlike `post_json`'s note/task CREATE (a duplicate POST creates a
    /// SECOND object), a PUT setting a field is idempotent by HTTP
    /// semantics, so the caller's stale-guard (`write.rs`) — not a
    /// duplicate-POST idempotency ledger — is what protects against writing
    /// a blend that's gone stale since it was proposed.
    pub async fn put_json(
        &self,
        path: &str,
        body: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        let url = if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.base, path)
        };
        for attempt in 0..MAX_429_RETRIES {
            self.rate_gate().await;
            let request = self
                .http
                .put(&url)
                .header("ACCESS_TOKEN", &self.token)
                .json(body);
            let resp = self
                .send_guarded(&url, request)
                .await
                .map_err(|error| crate::commands::connector_network::transport_error(error, "Wealthbox HTTP send"))?;
            if resp.status().as_u16() == 429 {
                let ra = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                resp.wait_before_retry(retry_delay(ra.as_deref(), attempt))
                    .await
                    .map_err(|error| crate::commands::connector_network::transport_error(error, "Wealthbox retry wait"))?;
                continue;
            }
            let status = resp.status();
            let text = resp.text().await.context("read Wealthbox response body")?;
            if !status.is_success() {
                // Status + endpoint only — body is NEVER logged (may contain advisor/client PII).
                log::warn!("Wealthbox write failed: HTTP {} at {}", status, path);
                anyhow::bail!("Wealthbox request failed (HTTP {})", status);
            }
            return serde_json::from_str(&text).context("parse Wealthbox JSON response");
        }
        anyhow::bail!("Wealthbox: throttled past retry budget ({} attempts)", MAX_429_RETRIES)
    }

    // -----------------------------------------------------------------------
    // /me — token validation
    // -----------------------------------------------------------------------

    /// `GET /me` — validates the stored token and returns workspace + plan metadata.
    ///
    /// Use this to confirm a pasted token is valid before starting a sync.
    #[allow(dead_code)]
    pub async fn me(&self) -> anyhow::Result<serde_json::Value> {
        self.get_json("/me", &[]).await
    }

    // -----------------------------------------------------------------------
    // Paged collection helper
    // -----------------------------------------------------------------------

    /// Fetch all pages from `path`, extracting the array under JSON key `key`.
    ///
    /// Loops `page = 1, 2, …` with `per_page = DEFAULT_PER_PAGE` until a page
    /// returns fewer items than the page size (indicating the last page).
    /// Each page call goes through the 1 rps gate.
    async fn list_all(
        &self,
        path: &str,
        key: &str,
        base_query: &[(&str, String)],
    ) -> anyhow::Result<Vec<serde_json::Value>> {
        let mut results = Vec::new();
        let mut page = 1usize;

        loop {
            let mut query: Vec<(&str, String)> = base_query.to_vec();
            query.push(("per_page", DEFAULT_PER_PAGE.to_string()));
            query.push(("page", page.to_string()));

            let body = self.get_json(path, &query).await?;

            let arr = body
                .get(key)
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let count = arr.len();
            results.extend(arr);

            if count < DEFAULT_PER_PAGE {
                break; // final page (possibly empty)
            }
            page += 1;
        }
        Ok(results)
    }

    // -----------------------------------------------------------------------
    // Typed list helpers
    // -----------------------------------------------------------------------

    /// List all contacts, optionally filtered by `updated_since` (ISO-8601 UTC)
    /// and/or `contact_type` (the Wealthbox `type` param: person / household /
    /// organization / trust).
    ///
    /// TODO(live-probe): confirm updated_since format + max per_page against a real token.
    #[allow(dead_code)]
    pub async fn list_contacts(
        &self,
        updated_since: Option<&str>,
        contact_type: Option<&str>,
    ) -> anyhow::Result<Vec<CrmContact>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(ts) = updated_since {
            query.push(("updated_since", ts.to_string()));
        }
        if let Some(ct) = contact_type {
            query.push(("type", ct.to_string()));
        }
        let items = self.list_all("/contacts", "contacts", &query).await?;
        items.into_iter().map(deserialize_crm_contact).collect()
    }

    /// List all household contacts (`type=household`).
    #[allow(dead_code)]
    pub async fn list_households(&self) -> anyhow::Result<Vec<CrmContact>> {
        self.list_contacts(None, Some("household")).await
    }

    /// List all notes.
    ///
    /// **Important:** the Wealthbox API returns notes under the JSON key
    /// `"status_updates"`, not `"notes"`.
    ///
    /// TODO(live-probe): confirm updated_since format + max per_page against a real token.
    #[allow(dead_code)]
    pub async fn list_notes(&self, updated_since: Option<&str>) -> anyhow::Result<Vec<CrmNote>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(ts) = updated_since {
            query.push(("updated_since", ts.to_string()));
        }
        // Key is "status_updates" — this is a known Wealthbox API quirk.
        let items = self.list_all("/notes", "status_updates", &query).await?;
        items
            .into_iter()
            .map(|v| serde_json::from_value(v).context("deserialize CrmNote"))
            .collect()
    }

    /// List all tasks.
    ///
    /// TODO(live-probe): confirm updated_since format + max per_page against a real token.
    #[allow(dead_code)]
    pub async fn list_tasks(&self, updated_since: Option<&str>) -> anyhow::Result<Vec<CrmTask>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(ts) = updated_since {
            query.push(("updated_since", ts.to_string()));
        }
        let items = self.list_all("/tasks", "tasks", &query).await?;
        items
            .into_iter()
            .map(|v| serde_json::from_value(v).context("deserialize CrmTask"))
            .collect()
    }

    /// List all events.
    ///
    /// TODO(live-probe): confirm updated_since format + max per_page against a real token.
    #[allow(dead_code)]
    pub async fn list_events(&self, updated_since: Option<&str>) -> anyhow::Result<Vec<CrmEvent>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(ts) = updated_since {
            query.push(("updated_since", ts.to_string()));
        }
        let items = self.list_all("/events", "events", &query).await?;
        items
            .into_iter()
            .map(|v| serde_json::from_value(v).context("deserialize CrmEvent"))
            .collect()
    }

    /// Return the string ids of contacts that have been soft-deleted since
    /// `deleted_since` (ISO-8601 UTC), or all deleted contacts if `None`.
    ///
    /// Wealthbox contacts support a real tombstone (`deleted=true`);
    /// other object types require store-diff detection (see design §5.4).
    ///
    /// TODO(live-probe): confirm updated_since format + max per_page against a real token.
    #[allow(dead_code)]
    pub async fn deleted_contact_ids(
        &self,
        deleted_since: Option<&str>,
    ) -> anyhow::Result<Vec<String>> {
        let mut query: Vec<(&str, String)> = vec![("deleted", "true".to_string())];
        if let Some(ts) = deleted_since {
            query.push(("deleted_since", ts.to_string()));
        }
        let items = self.list_all("/contacts", "contacts", &query).await?;
        Ok(items
            .into_iter()
            .filter_map(|v| {
                v.get("id").and_then(|id| {
                    if let Some(n) = id.as_i64() {
                        Some(n.to_string())
                    } else {
                        id.as_str().map(String::from)
                    }
                })
            })
            .collect())
    }

    // -----------------------------------------------------------------------
    // Label resolver (categories / users / teams)
    // -----------------------------------------------------------------------
    //
    // Wealthbox returns numeric ids for categories (pipeline stage, contact
    // source, etc.), assigned users, and teams.  These helpers resolve an id
    // to a human-readable label, lazily fetching and caching the full list on
    // first use.  Cache is in-memory only (reset on app restart).

    /// Resolve a numeric `id` for `category_type` (e.g. `"contact_stage"`) to a
    /// human-readable label.  Lazily fetches and caches `/categories/{type}`.
    #[allow(dead_code)]
    pub async fn resolve_category_label(
        &self,
        category_type: &str,
        id: i64,
    ) -> anyhow::Result<Option<String>> {
        // Fast path: already cached (no network call).
        {
            let cache = self.label_cache.lock().await;
            if cache.categories_loaded.contains(category_type) {
                return Ok(cache
                    .categories
                    .get(category_type)
                    .and_then(|m| m.get(&id))
                    .cloned());
            }
        }
        // Slow path: fetch (lock released across the await).
        let path = format!("/categories/{}", category_type);
        let items = self.get_json(&path, &[]).await?;
        let mut cache = self.label_cache.lock().await;
        let map = cache
            .categories
            .entry(category_type.to_string())
            .or_default();
        // Wealthbox wraps the array: {"categories":[...]}
        for item in wb_array_from(&items, "categories") {
            if let (Some(cid), Some(name)) = (
                item.get("id").and_then(|v| v.as_i64()),
                item.get("name").and_then(|v| v.as_str()),
            ) {
                map.insert(cid, name.to_string());
            }
        }
        cache.categories_loaded.insert(category_type.to_string());
        Ok(cache
            .categories
            .get(category_type)
            .and_then(|m| m.get(&id))
            .cloned())
    }

    /// Resolve a Wealthbox user id to a display name.
    /// Lazily fetches and caches `GET /users`.
    #[allow(dead_code)]
    pub async fn resolve_user_name(&self, id: i64) -> anyhow::Result<Option<String>> {
        // Fast path.
        {
            let cache = self.label_cache.lock().await;
            if cache.users_loaded {
                return Ok(cache.users.get(&id).cloned());
            }
        }
        // Slow path: fetch (lock released across the await).
        let items = self.get_json("/users", &[]).await?;
        let mut cache = self.label_cache.lock().await;
        // Wealthbox wraps the array: {"users":[...]}
        for item in wb_array_from(&items, "users") {
            if let (Some(uid), Some(name)) = (
                item.get("id").and_then(|v| v.as_i64()),
                item.get("name").and_then(|v| v.as_str()),
            ) {
                cache.users.insert(uid, name.to_string());
            }
        }
        cache.users_loaded = true;
        Ok(cache.users.get(&id).cloned())
    }

    /// Resolve a Wealthbox team id to a display name.
    /// Lazily fetches and caches `GET /teams`.
    #[allow(dead_code)]
    pub async fn resolve_team_name(&self, id: i64) -> anyhow::Result<Option<String>> {
        // Fast path.
        {
            let cache = self.label_cache.lock().await;
            if cache.teams_loaded {
                return Ok(cache.teams.get(&id).cloned());
            }
        }
        // Slow path: fetch (lock released across the await).
        let items = self.get_json("/teams", &[]).await?;
        let mut cache = self.label_cache.lock().await;
        // Wealthbox wraps the array: {"teams":[...]}
        for item in wb_array_from(&items, "teams") {
            if let (Some(tid), Some(name)) = (
                item.get("id").and_then(|v| v.as_i64()),
                item.get("name").and_then(|v| v.as_str()),
            ) {
                cache.teams.insert(tid, name.to_string());
            }
        }
        cache.teams_loaded = true;
        Ok(cache.teams.get(&id).cloned())
    }
}

/// The importer receives the original response bytes, never a re-serialized
/// JSON value. Capture persistence happens in its append-only encrypted store.
#[async_trait]
impl RawWealthboxTransport for WealthboxClient {
    async fn get_raw(&self, path: &str, query: &[(String, String)]) -> anyhow::Result<RawHttpResponse> {
        self.get_raw_response(path, query).await
    }
}

// ---------------------------------------------------------------------------
// Array extraction helper
// ---------------------------------------------------------------------------

/// Extract the items array from a Wealthbox collection response.
///
/// Every Wealthbox list endpoint wraps its array in a named object:
/// `{"users":[...]}`, `{"teams":[...]}`, `{"categories":[...]}`.
/// Treating the response as a top-level array would silently produce an empty
/// list; this helper pulls the named key out and returns an owned `Vec`.
/// Returns an empty `Vec` when the key is absent so callers never see stale
/// data from a shape mismatch.
fn wb_array_from(body: &serde_json::Value, key: &str) -> Vec<serde_json::Value> {
    body.get(key)
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Retry delay helper
// ---------------------------------------------------------------------------

/// Compute the delay before the next 429-retry attempt.
///
/// Respects a `Retry-After` header value (in seconds), capped at
/// [`MAX_RETRY_AFTER_SECS`].  Falls back to capped exponential backoff
/// (1 s → 2 s → 4 s → … → 64 s), mirroring `commands/mail/graph.rs`.
pub fn retry_delay(retry_after_header: Option<&str>, attempt: u32) -> Duration {
    if let Some(h) = retry_after_header {
        if let Ok(secs) = h.trim().parse::<u64>() {
            return Duration::from_secs(secs.min(MAX_RETRY_AFTER_SECS));
        }
    }
    let secs = 1u64.checked_shl(attempt).unwrap_or(64).min(64);
    Duration::from_secs(secs)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retry_delay_respects_retry_after_header() {
        assert_eq!(retry_delay(Some("30"), 0), Duration::from_secs(30));
        assert_eq!(retry_delay(Some("0"), 2), Duration::from_secs(0));
    }

    #[test]
    fn retry_delay_caps_large_header_value() {
        // A hostile server cannot park the sync for hours.
        assert_eq!(
            retry_delay(Some("86400"), 0),
            Duration::from_secs(MAX_RETRY_AFTER_SECS)
        );
        assert_eq!(
            retry_delay(Some("120"), 0),
            Duration::from_secs(MAX_RETRY_AFTER_SECS)
        );
    }

    #[test]
    fn retry_delay_exponential_backoff_without_header() {
        assert_eq!(retry_delay(None, 0), Duration::from_secs(1));
        assert_eq!(retry_delay(None, 1), Duration::from_secs(2));
        assert_eq!(retry_delay(None, 2), Duration::from_secs(4));
        // Capped at 64 s.
        assert_eq!(retry_delay(None, 10), Duration::from_secs(64));
        assert_eq!(retry_delay(None, 30), Duration::from_secs(64));
    }

    #[test]
    fn retry_delay_header_wins_over_attempt_count() {
        // Explicit header beats the fallback formula at any attempt index.
        assert_eq!(retry_delay(Some("10"), 5), Duration::from_secs(10));
    }

    // ── wb_array_from: Fix 3 regression tests ────────────────────────────────

    /// Parsing a `{"users":[{"id":1,"name":"Jane Advisor"}]}` response extracts
    /// the array under the "users" key — the id-to-name mapping a resolver
    /// would then store as 1 → "Jane Advisor".
    #[test]
    fn wb_array_from_extracts_named_key() {
        let body = serde_json::json!({"users": [{"id": 1, "name": "Jane Advisor"}]});
        let arr = wb_array_from(&body, "users");
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["id"].as_i64(), Some(1));
        assert_eq!(arr[0]["name"].as_str(), Some("Jane Advisor"));
    }

    /// A flat top-level array (wrong shape — the old bug) and a missing key
    /// both return empty; the cache stays clean instead of permanently empty.
    #[test]
    fn wb_array_from_returns_empty_for_absent_or_flat_shape() {
        // Flat array — old code tried items.as_array() on the full response,
        // which only works when the response IS a top-level array.  Wealthbox
        // wraps, so this shape never appears in production, but the helper must
        // not panic on it.
        let flat = serde_json::json!([{"id": 1}]);
        assert!(
            wb_array_from(&flat, "users").is_empty(),
            "flat array → empty"
        );

        // Wrong key — e.g. asking for "users" on a {"teams":[...]} body.
        let body = serde_json::json!({"teams": [{"id": 2, "name": "Team A"}]});
        assert!(
            wb_array_from(&body, "users").is_empty(),
            "absent key → empty"
        );
    }

    #[tokio::test]
    async fn contact_page_keeps_real_households_when_one_contact_is_unassigned() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/contacts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "contacts": [
                    {
                        "id": 20001,
                        "type": "household",
                        "name": "Avery Household"
                    },
                    {
                        "id": 20002,
                        "type": "person",
                        "first_name": "Unassigned",
                        "household": {
                            "id": null,
                            "external_id": null,
                            "name": null,
                            "title": null,
                            "members": null
                        }
                    }
                ]
            })))
            .mount(&server)
            .await;

        let client = WealthboxClient::new_with_base("test-token".into(), server.uri());
        let contacts = client
            .list_contacts(None, None)
            .await
            .expect("one unassigned contact must not discard the complete contact page");

        assert_eq!(contacts.len(), 2, "no contact should disappear silently");
        assert_eq!(contacts[0].household_key().as_deref(), Some("20001"));
        assert_eq!(contacts[1].household_key(), None);
    }

    #[tokio::test]
    async fn post_json_sends_token_header_and_parses_response() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/notes"))
            .and(matchers::header("ACCESS_TOKEN", "tok-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 777})))
            .mount(&server)
            .await;
        let client = WealthboxClient::new_with_base("tok-1".into(), server.uri());
        let out = client
            .post_json("/notes", &serde_json::json!({"content": "hi"}))
            .await
            .unwrap();
        assert_eq!(out["id"].as_i64(), Some(777));
    }

    #[tokio::test]
    async fn put_json_sends_token_header_and_parses_response() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("PUT"))
            .and(matchers::path("/contacts/12345"))
            .and(matchers::header("ACCESS_TOKEN", "tok-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 12345})))
            .mount(&server)
            .await;
        let client = WealthboxClient::new_with_base("tok-1".into(), server.uri());
        let out = client
            .put_json("/contacts/12345", &serde_json::json!({"background_information": "x"}))
            .await
            .unwrap();
        assert_eq!(out["id"].as_i64(), Some(12345));
    }

    #[tokio::test]
    async fn put_json_error_carries_status_but_never_body() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("PUT"))
            .respond_with(ResponseTemplate::new(422).set_body_string("SSN 123-45-6789"))
            .mount(&server)
            .await;
        let client = WealthboxClient::new_with_base("t".into(), server.uri());
        let err = client
            .put_json("/contacts/1", &serde_json::json!({}))
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("422"), "status surfaced: {err}");
        assert!(!err.contains("6789"), "body must never leak into errors");
    }

    #[tokio::test]
    async fn put_json_does_not_retry_non_429_failures() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use wiremock::{matchers, Mock, MockServer, Respond, ResponseTemplate};
        static HITS: AtomicUsize = AtomicUsize::new(0);
        struct Count;
        impl Respond for Count {
            fn respond(&self, _: &wiremock::Request) -> ResponseTemplate {
                HITS.fetch_add(1, Ordering::SeqCst);
                ResponseTemplate::new(500)
            }
        }
        let server = MockServer::start().await;
        Mock::given(matchers::method("PUT")).respond_with(Count).mount(&server).await;
        let client = WealthboxClient::new_with_base("t".into(), server.uri());
        let _ = client.put_json("/contacts/1", &serde_json::json!({})).await;
        assert_eq!(HITS.load(Ordering::SeqCst), 1, "a PUT must never blind-retry on 5xx — the caller's stale-guard decides whether a re-send is safe");
    }

    #[tokio::test]
    async fn lockdown_flip_during_a_429_response_prevents_the_retry() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        use wiremock::{matchers, Mock, MockServer, Respond, ResponseTemplate};

        struct LockOnFirstResponse {
            hits: Arc<AtomicUsize>,
            policy: crate::network_policy::NetworkPolicy,
        }
        impl Respond for LockOnFirstResponse {
            fn respond(&self, _: &wiremock::Request) -> ResponseTemplate {
                self.hits.fetch_add(1, Ordering::SeqCst);
                self.policy.set_offline_mode(true).unwrap();
                ResponseTemplate::new(429).insert_header("Retry-After", "0")
            }
        }

        let server = MockServer::start().await;
        let policy = crate::network_policy::NetworkPolicy::load_from_directory(
            &tempfile::tempdir().unwrap().keep(),
        );
        let hits = Arc::new(AtomicUsize::new(0));
        Mock::given(matchers::method("GET"))
            .respond_with(LockOnFirstResponse {
                hits: hits.clone(),
                policy: policy.clone(),
            })
            .mount(&server)
            .await;
        let client = WealthboxClient::new_migration(
            "fabricated-token".into(),
            server.uri(),
            policy,
        )
        .unwrap();

        let error = client.get_json("/contacts", &[]).await.unwrap_err();
        assert!(error.to_string().contains("Network lockdown is on"));
        assert_eq!(
            hits.load(Ordering::SeqCst),
            1,
            "the next retry must be stopped before another request opens",
        );
    }

    #[tokio::test]
    async fn post_json_error_carries_status_but_never_body() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .respond_with(ResponseTemplate::new(422).set_body_string("SSN 123-45-6789"))
            .mount(&server)
            .await;
        let client = WealthboxClient::new_with_base("t".into(), server.uri());
        let err = client
            .post_json("/notes", &serde_json::json!({}))
            .await
            .unwrap_err()
            .to_string();
        assert!(err.contains("422"), "status surfaced: {err}");
        assert!(!err.contains("6789"), "body must never leak into errors");
    }

    #[tokio::test]
    async fn post_json_does_not_retry_non_429_failures() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use wiremock::{matchers, Mock, MockServer, Respond, ResponseTemplate};
        static HITS: AtomicUsize = AtomicUsize::new(0);
        struct Count;
        impl Respond for Count {
            fn respond(&self, _: &wiremock::Request) -> ResponseTemplate {
                HITS.fetch_add(1, Ordering::SeqCst);
                ResponseTemplate::new(500)
            }
        }
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST")).respond_with(Count).mount(&server).await;
        let client = WealthboxClient::new_with_base("t".into(), server.uri());
        let _ = client.post_json("/notes", &serde_json::json!({})).await;
        assert_eq!(HITS.load(Ordering::SeqCst), 1, "a POST must never blind-retry on 5xx — double-post risk");
    }
}

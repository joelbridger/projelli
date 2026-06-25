//! HTTP client for the Wealthbox CRM REST API.
//!
//! **Read-only: GET requests only.** This module never creates, updates, or
//! deletes any Wealthbox record.
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
//! (`"Wealthbox request failed (HTTP N)"`) — the raw response body is
//! `log::warn!`'d locally but **never returned to the caller**.  Response bodies
//! may contain advisor PII and must not propagate to the UI or logs visible to
//! third parties.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::Context;

use crate::commands::crm::model::{
    WbContact, WbEvent, WbNote, WbTask, DEFAULT_PER_PAGE,
};

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
    http: reqwest::Client,
    /// Guards the ~1 rps rate gate.  Stores the `Instant` of the most recent
    /// completed (or started) request; `None` before any request.
    last_request: tokio::sync::Mutex<Option<Instant>>,
    /// Lazily-populated id → label resolver cache.
    label_cache: tokio::sync::Mutex<LabelCache>,
}

impl WealthboxClient {
    /// Construct a production client pointing at `https://api.crmworkspace.com/v1`.
    pub fn new(token: String) -> Self {
        Self::new_with_base(token, BASE_URL.to_string())
    }

    /// Construct a client with a custom base URL — intended for tests.
    pub fn new_with_base(token: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("build reqwest client for WealthboxClient");
        Self {
            token,
            base,
            http,
            last_request: tokio::sync::Mutex::new(None),
            label_cache: tokio::sync::Mutex::new(LabelCache::default()),
        }
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
    /// Non-success status codes are logged locally and surfaced as a
    /// status-only error — the raw body is **never returned**.
    pub async fn get_json(
        &self,
        path: &str,
        query: &[(&str, String)],
    ) -> anyhow::Result<serde_json::Value> {
        let url = if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.base, path)
        };

        for attempt in 0..MAX_429_RETRIES {
            self.rate_gate().await;

            let mut req = self.http.get(&url).header("ACCESS_TOKEN", &self.token);
            for (k, v) in query {
                req = req.query(&[(*k, v.as_str())]);
            }
            let resp = req.send().await.context("Wealthbox HTTP send")?;

            if resp.status().as_u16() == 429 {
                let ra = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                tokio::time::sleep(retry_delay(ra.as_deref(), attempt)).await;
                continue;
            }

            let status = resp.status();
            let body = resp.text().await.context("read Wealthbox response body")?;
            if !status.is_success() {
                // Log body locally (may contain PII) but never return it.
                log::warn!("Wealthbox request failed (HTTP {}): {}", status, body);
                anyhow::bail!("Wealthbox request failed (HTTP {})", status);
            }
            return serde_json::from_str(&body).context("parse Wealthbox JSON response");
        }
        anyhow::bail!(
            "Wealthbox: throttled past retry budget ({} attempts)",
            MAX_429_RETRIES
        )
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
    ) -> anyhow::Result<Vec<WbContact>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(ts) = updated_since {
            query.push(("updated_since", ts.to_string()));
        }
        if let Some(ct) = contact_type {
            query.push(("type", ct.to_string()));
        }
        let items = self.list_all("/contacts", "contacts", &query).await?;
        items
            .into_iter()
            .map(|v| serde_json::from_value(v).context("deserialize WbContact"))
            .collect()
    }

    /// List all household contacts (`type=household`).
    #[allow(dead_code)]
    pub async fn list_households(&self) -> anyhow::Result<Vec<WbContact>> {
        self.list_contacts(None, Some("household")).await
    }

    /// List all notes.
    ///
    /// **Important:** the Wealthbox API returns notes under the JSON key
    /// `"status_updates"`, not `"notes"`.
    ///
    /// TODO(live-probe): confirm updated_since format + max per_page against a real token.
    #[allow(dead_code)]
    pub async fn list_notes(
        &self,
        updated_since: Option<&str>,
    ) -> anyhow::Result<Vec<WbNote>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(ts) = updated_since {
            query.push(("updated_since", ts.to_string()));
        }
        // Key is "status_updates" — this is a known Wealthbox API quirk.
        let items = self
            .list_all("/notes", "status_updates", &query)
            .await?;
        items
            .into_iter()
            .map(|v| serde_json::from_value(v).context("deserialize WbNote"))
            .collect()
    }

    /// List all tasks.
    ///
    /// TODO(live-probe): confirm updated_since format + max per_page against a real token.
    #[allow(dead_code)]
    pub async fn list_tasks(
        &self,
        updated_since: Option<&str>,
    ) -> anyhow::Result<Vec<WbTask>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(ts) = updated_since {
            query.push(("updated_since", ts.to_string()));
        }
        let items = self.list_all("/tasks", "tasks", &query).await?;
        items
            .into_iter()
            .map(|v| serde_json::from_value(v).context("deserialize WbTask"))
            .collect()
    }

    /// List all events.
    ///
    /// TODO(live-probe): confirm updated_since format + max per_page against a real token.
    #[allow(dead_code)]
    pub async fn list_events(
        &self,
        updated_since: Option<&str>,
    ) -> anyhow::Result<Vec<WbEvent>> {
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(ts) = updated_since {
            query.push(("updated_since", ts.to_string()));
        }
        let items = self.list_all("/events", "events", &query).await?;
        items
            .into_iter()
            .map(|v| serde_json::from_value(v).context("deserialize WbEvent"))
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
        if let Some(arr) = items.as_array() {
            for item in arr {
                if let (Some(cid), Some(name)) = (
                    item.get("id").and_then(|v| v.as_i64()),
                    item.get("name").and_then(|v| v.as_str()),
                ) {
                    map.insert(cid, name.to_string());
                }
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
        if let Some(arr) = items.as_array() {
            for item in arr {
                if let (Some(uid), Some(name)) = (
                    item.get("id").and_then(|v| v.as_i64()),
                    item.get("name").and_then(|v| v.as_str()),
                ) {
                    cache.users.insert(uid, name.to_string());
                }
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
        if let Some(arr) = items.as_array() {
            for item in arr {
                if let (Some(tid), Some(name)) = (
                    item.get("id").and_then(|v| v.as_i64()),
                    item.get("name").and_then(|v| v.as_str()),
                ) {
                    cache.teams.insert(tid, name.to_string());
                }
            }
        }
        cache.teams_loaded = true;
        Ok(cache.teams.get(&id).cloned())
    }
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
}

//! CRM write path — approval-gated note/task creation.
//!
//! Same PII discipline as `client.rs`: response bodies and user content are
//! never logged; errors carry status codes and endpoint paths only.

use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrmWriteKind {
    Note,
    Task,
}

impl CrmWriteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Note => "note",
            Self::Task => "task",
        }
    }
}

/// One proposed write. `household_key` is the provider-side contact/household
/// id (Wealthbox: numeric string; other providers use their prefixed crm_key).
/// `source_ref` is provenance for the audit log (document path or transcript
/// timestamp) — it is never sent to the CRM.
#[derive(Debug, Clone)]
pub struct CrmWriteRequest {
    pub kind: CrmWriteKind,
    pub matter_id: String,
    pub household_key: String,
    pub title: String,
    pub body: String,
    pub due_date: Option<String>,
    pub source_ref: String,
}

/// Receipt for a completed (or deduplicated) write.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteReceipt {
    /// Provider-side id of the created record.
    pub remote_id: String,
    /// True when the ledger suppressed a duplicate instead of re-posting.
    pub deduped: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum CrmWriteError {
    #[error("{0} is not connected")]
    NotConnected(&'static str),
    #[error("this client is not linked to a CRM household")]
    NoHouseholdLink,
    #[error("this client is linked to more than one CRM household — pick one in the review card")]
    AmbiguousHousehold,
    #[error("CRM write failed (HTTP {0})")]
    Http(u16),
    #[error("CRM write throttled past retry budget")]
    Throttled,
    #[error("a previous identical write may have been delivered — verification pending, retry shortly")]
    VerifyPending,
    #[error("this exact write is already being sent — wait a moment before retrying")]
    InProgress,
    #[error("writes are not yet supported for {0}")]
    NotSupported(&'static str),
    #[error("invalid write request: {0}")]
    InvalidInput(&'static str),
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Stable content-addressed key: identical (provider-visible) writes collide,
/// any change to target or content produces a fresh key.
pub fn dedup_key(req: &CrmWriteRequest) -> String {
    let mut h = Sha256::new();
    for part in [
        req.kind.as_str(),
        &req.household_key,
        &norm(&req.title),
        &norm(&req.body),
        req.due_date.as_deref().unwrap_or(""),
    ] {
        h.update(part.as_bytes());
        h.update([0u8]); // field separator so "a","bc" != "ab","c"
    }
    hex::encode(h.finalize())
}

/// Provider-agnostic CRM write surface. Wealthbox is the first implementation;
/// Redtail/Salesforce adopt the same trait once vendor creds land.
#[async_trait::async_trait]
pub trait CrmWriteSource: Send + Sync {
    fn provider_id(&self) -> &'static str;
    /// Creates a note, returning the provider-side remote id.
    async fn create_note(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError>;
    /// Creates a task, returning the provider-side remote id.
    async fn create_task(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError>;
    /// Look for an already-delivered identical write (recovery after an
    /// ambiguous transport failure). Returns the remote id if found.
    async fn find_recent_matching(
        &self,
        req: &CrmWriteRequest,
    ) -> Result<Option<String>, CrmWriteError>;
}

#[async_trait::async_trait]
impl CrmWriteSource for crate::commands::crm::client::WealthboxClient {
    fn provider_id(&self) -> &'static str {
        "wealthbox"
    }

    async fn create_note(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError> {
        let contact_id = wealthbox_contact_id(&req.household_key)?;
        // Wealthbox notes have no title field: title becomes the first line.
        // VERIFY-LIVE: linked_to "type" casing ("Contact").
        let body = serde_json::json!({
            "content": format!("{}\n\n{}", req.title.trim(), req.body.trim()),
            "linked_to": [{"id": contact_id, "type": "Contact"}],
        });
        let resp = self.post_json("/notes", &body).await.map_err(map_http_err)?;
        remote_id_from(&resp)
    }

    async fn create_task(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError> {
        let contact_id = wealthbox_contact_id(&req.household_key)?;
        // VERIFY-LIVE: due_date format (plain date vs "YYYY-MM-DD hh:mm AM -0400").
        let mut body = serde_json::json!({
            "name": req.title.trim(),
            "description": req.body.trim(),
            "linked_to": [{"id": contact_id, "type": "Contact"}],
        });
        if let Some(d) = &req.due_date {
            body["due_date"] = serde_json::Value::String(d.clone());
        }
        let resp = self.post_json("/tasks", &body).await.map_err(map_http_err)?;
        remote_id_from(&resp)
    }

    async fn find_recent_matching(
        &self,
        req: &CrmWriteRequest,
    ) -> Result<Option<String>, CrmWriteError> {
        // Recovery path: list recent objects and match on normalized content
        // AND target household. Matching content alone is not proof this write
        // landed — a different household could hold an identical note/task, or
        // one could have existed before this attempt ever ran. Full-list is
        // acceptable at solo scale; the 1 rps gate bounds cost.
        let contact_id = wealthbox_contact_id(&req.household_key)?;
        match req.kind {
            CrmWriteKind::Note => {
                let notes = self.list_notes(None).await.map_err(map_http_err)?;
                let want = norm(&format!("{}\n\n{}", req.title.trim(), req.body.trim()));
                Ok(notes
                    .iter()
                    .find(|n| {
                        norm(&n.content) == want
                            && n.linked_to.iter().any(|l| l.id == contact_id)
                    })
                    .map(|n| n.id.to_string()))
            }
            CrmWriteKind::Task => {
                let tasks = self.list_tasks(None).await.map_err(map_http_err)?;
                Ok(tasks
                    .iter()
                    .find(|t| {
                        norm(&t.name) == norm(req.title.trim())
                            && norm(&t.description) == norm(req.body.trim())
                            && t.linked_to.iter().any(|l| l.id == contact_id)
                    })
                    .map(|t| t.id.to_string()))
            }
        }
    }
}

fn wealthbox_contact_id(household_key: &str) -> Result<i64, CrmWriteError> {
    household_key
        .trim()
        .parse::<i64>()
        .map_err(|_| CrmWriteError::InvalidInput("household key is not a Wealthbox numeric id"))
}

fn map_http_err(e: anyhow::Error) -> CrmWriteError {
    let msg = e.to_string();
    if msg.contains("throttled past retry budget") {
        return CrmWriteError::Throttled;
    }
    if let Some(code) = msg
        .strip_prefix("Wealthbox request failed (HTTP ")
        .and_then(|s| s.strip_suffix(')'))
        .and_then(|s| s.parse::<u16>().ok())
    {
        return CrmWriteError::Http(code);
    }
    // Transport-level failure (send error / body read error): the request MAY
    // have been delivered. Callers must go through the pending_verify path.
    CrmWriteError::VerifyPending
}

/// RAII claim on a dedup key, scoped to one `CrmStore` (see
/// `CrmStore::claim_in_flight_write`) — releases it on drop so an early
/// return (via `?`) can never leave a key stuck claimed.
struct InFlightClaim<'a> {
    store: &'a crate::commands::crm::store::CrmStore,
    key: String,
}
impl Drop for InFlightClaim<'_> {
    fn drop(&mut self) {
        self.store.release_in_flight_write(&self.key);
    }
}

/// Idempotent, verify-before-resend orchestration around a `CrmWriteSource`.
///
/// Semantics:
/// 0. Claim an in-process in-flight slot for `dedup_key(req)` on `store`; a
///    concurrent call for the identical write (e.g. a rapid double-approve)
///    is rejected immediately (`InProgress`) rather than racing the ledger —
///    without this, two overlapping calls could both see no-row-yet/
///    `pending` and both post, defeating the ledger's idempotency guarantee.
/// 1. `key = dedup_key(req)`; look up the ledger.
/// 2. `sent` → return the recorded receipt (never re-post).
/// 3. `pending_verify` → call `find_recent_matching`; found → mark `sent`,
///    return a deduped receipt; not found → the earlier attempt provably
///    didn't land, proceed to send.
/// 4. none / `pending` / `failed` → mark `pending`, call `create_note`/`create_task`.
/// 5. success → mark `sent` + remote_id, return a fresh receipt.
/// 6. `CrmWriteError::VerifyPending` from the source → mark `pending_verify`,
///    propagate (the UI shows "will verify on retry").
/// 7. any other error → mark `failed`, propagate.
pub async fn push_crm_write(
    source: &dyn CrmWriteSource,
    store: &crate::commands::crm::store::CrmStore,
    req: &CrmWriteRequest,
) -> Result<WriteReceipt, CrmWriteError> {
    let key = dedup_key(req);

    if !store.claim_in_flight_write(&key) {
        return Err(CrmWriteError::InProgress);
    }
    let _claim = InFlightClaim { store, key: key.clone() };

    let existing = store.outbound_get(&key).map_err(|_| CrmWriteError::InvalidInput("ledger read failed"))?;

    if let Some(row) = &existing {
        if row.status == "sent" {
            if let Some(remote_id) = &row.remote_id {
                return Ok(WriteReceipt { remote_id: remote_id.clone(), deduped: true });
            }
        }
        if row.status == "pending_verify" {
            match source.find_recent_matching(req).await? {
                Some(remote_id) => {
                    upsert_ledger(store, &key, source, req, "sent", Some(&remote_id));
                    return Ok(WriteReceipt { remote_id, deduped: true });
                }
                None => {
                    // Provably didn't land — fall through to (re)send below.
                }
            }
        }
    }

    upsert_ledger(store, &key, source, req, "pending", None);

    let create_result = match req.kind {
        CrmWriteKind::Note => source.create_note(req).await,
        CrmWriteKind::Task => source.create_task(req).await,
    };

    match create_result {
        Ok(remote_id) => {
            upsert_ledger(store, &key, source, req, "sent", Some(&remote_id));
            Ok(WriteReceipt { remote_id, deduped: false })
        }
        Err(CrmWriteError::VerifyPending) => {
            upsert_ledger(store, &key, source, req, "pending_verify", None);
            Err(CrmWriteError::VerifyPending)
        }
        Err(e) => {
            upsert_ledger(store, &key, source, req, "failed", None);
            Err(e)
        }
    }
}

fn upsert_ledger(
    store: &crate::commands::crm::store::CrmStore,
    key: &str,
    source: &dyn CrmWriteSource,
    req: &CrmWriteRequest,
    status: &str,
    remote_id: Option<&str>,
) {
    if let Err(e) = store.outbound_upsert(
        key,
        source.provider_id(),
        req.kind.as_str(),
        &req.household_key,
        &req.matter_id,
        &req.source_ref,
        status,
        remote_id,
    ) {
        log::warn!("crm outbound ledger write failed (non-fatal): {e:#}");
    }
}

/// Reject empty titles and oversize content before any network call.
pub fn validate_write_inputs(title: &str, body: &str) -> Result<(), CrmWriteError> {
    if title.trim().is_empty() {
        return Err(CrmWriteError::InvalidInput("title must not be empty"));
    }
    if title.len() > 500 {
        return Err(CrmWriteError::InvalidInput("title is too long (max 500 characters)"));
    }
    if body.len() > 20_000 {
        return Err(CrmWriteError::InvalidInput("body is too long (max 20,000 characters)"));
    }
    Ok(())
}

fn remote_id_from(resp: &serde_json::Value) -> Result<String, CrmWriteError> {
    // VERIFY-LIVE: create responses echo the created object with top-level id.
    resp.get("id")
        .and_then(|v| v.as_i64().map(|n| n.to_string()).or_else(|| v.as_str().map(String::from)))
        .ok_or(CrmWriteError::InvalidInput("create response had no id"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::store::CrmStore;

    /// Open a CrmStore with a deterministic test key — bypasses the OS keychain.
    fn test_store() -> (tempfile::TempDir, CrmStore) {
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x44u8; 32];
        let s = CrmStore::open_with_key(dir.path(), &key).expect("crm store open");
        (dir, s)
    }

    struct FakeWriteSource {
        create_results: std::sync::Mutex<Vec<Result<String, CrmWriteError>>>,
        find_result: Option<String>,
        create_calls: std::sync::atomic::AtomicUsize,
    }
    #[async_trait::async_trait]
    impl CrmWriteSource for FakeWriteSource {
        fn provider_id(&self) -> &'static str {
            "wealthbox"
        }
        async fn create_note(&self, _r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
            self.create_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.create_results.lock().unwrap().remove(0)
        }
        async fn create_task(&self, r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
            self.create_note(r).await
        }
        async fn find_recent_matching(
            &self,
            _r: &CrmWriteRequest,
        ) -> Result<Option<String>, CrmWriteError> {
            Ok(self.find_result.clone())
        }
    }

    #[tokio::test]
    async fn second_identical_push_is_deduped_without_network() {
        let (_dir, store) = test_store();
        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![Ok("555".into())]),
            find_result: None,
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let req = note_req();
        let first = push_crm_write(&source, &store, &req).await.unwrap();
        assert_eq!(first.remote_id, "555");
        assert!(!first.deduped);
        let second = push_crm_write(&source, &store, &req).await.unwrap();
        assert_eq!(second.remote_id, "555");
        assert!(second.deduped);
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn ambiguous_failure_then_verify_found_never_reposts() {
        let (_dir, store) = test_store();
        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![Err(CrmWriteError::VerifyPending)]),
            find_result: Some("555".into()),
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let req = note_req();
        let first = push_crm_write(&source, &store, &req).await;
        assert!(matches!(first, Err(CrmWriteError::VerifyPending)));
        let second = push_crm_write(&source, &store, &req).await.unwrap();
        assert_eq!(second.remote_id, "555");
        assert!(second.deduped);
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn ambiguous_failure_then_verify_missing_resends() {
        let (_dir, store) = test_store();
        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![
                Err(CrmWriteError::VerifyPending),
                Ok("556".into()),
            ]),
            find_result: None,
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let req = note_req();
        let first = push_crm_write(&source, &store, &req).await;
        assert!(matches!(first, Err(CrmWriteError::VerifyPending)));
        let second = push_crm_write(&source, &store, &req).await.unwrap();
        assert_eq!(second.remote_id, "556");
        assert!(!second.deduped);
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn concurrent_identical_pushes_second_is_rejected_as_in_progress() {
        let (_dir, store) = test_store();

        struct SlowSource {
            started: std::sync::Arc<tokio::sync::Notify>,
            proceed: std::sync::Arc<tokio::sync::Notify>,
            calls: std::sync::atomic::AtomicUsize,
        }
        #[async_trait::async_trait]
        impl CrmWriteSource for SlowSource {
            fn provider_id(&self) -> &'static str {
                "wealthbox"
            }
            async fn create_note(&self, _r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
                self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                self.started.notify_one();
                self.proceed.notified().await;
                Ok("555".into())
            }
            async fn create_task(&self, r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
                self.create_note(r).await
            }
            async fn find_recent_matching(
                &self,
                _r: &CrmWriteRequest,
            ) -> Result<Option<String>, CrmWriteError> {
                Ok(None)
            }
        }

        let source = SlowSource {
            started: std::sync::Arc::new(tokio::sync::Notify::new()),
            proceed: std::sync::Arc::new(tokio::sync::Notify::new()),
            calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let req = note_req();

        // First call claims the in-flight slot and blocks inside create_note
        // until signaled. The second call, released only once the first has
        // provably already claimed the slot, must be rejected immediately
        // instead of racing the ledger and posting a duplicate.
        let (first, second) = tokio::join!(
            push_crm_write(&source, &store, &req),
            async {
                source.started.notified().await;
                let result = push_crm_write(&source, &store, &req).await;
                source.proceed.notify_one();
                result
            }
        );

        assert!(matches!(second, Err(CrmWriteError::InProgress)));
        assert_eq!(first.unwrap().remote_id, "555");
        assert_eq!(source.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    fn note_req() -> CrmWriteRequest {
        CrmWriteRequest {
            kind: CrmWriteKind::Note,
            matter_id: "matter-1".into(),
            household_key: "12345".into(),
            title: "Q3 review follow-up".into(),
            body: "Discussed 529 rollover.".into(),
            due_date: None,
            source_ref: "doc:Clients/Henderson/notes.docx".into(),
        }
    }

    fn task_req() -> CrmWriteRequest {
        CrmWriteRequest {
            kind: CrmWriteKind::Task,
            due_date: Some("2026-07-15".into()),
            ..note_req()
        }
    }

    #[tokio::test]
    async fn wealthbox_create_note_posts_exact_shape() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/notes"))
            .and(matchers::body_json(serde_json::json!({
                "content": "Q3 review follow-up\n\nDiscussed 529 rollover.",
                "linked_to": [{"id": 12345, "type": "Contact"}]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 555})))
            .expect(1)
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let id = client.create_note(&note_req()).await.unwrap();
        assert_eq!(id, "555");
    }

    #[tokio::test]
    async fn wealthbox_create_task_posts_exact_shape() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/tasks"))
            .and(matchers::body_json(serde_json::json!({
                "name": "Q3 review follow-up",
                "description": "Discussed 529 rollover.",
                "due_date": "2026-07-15",
                "linked_to": [{"id": 12345, "type": "Contact"}]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 556})))
            .expect(1)
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let id = client.create_task(&task_req()).await.unwrap();
        assert_eq!(id, "556");
    }

    #[tokio::test]
    async fn non_numeric_household_key_is_rejected_for_wealthbox() {
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), "http://127.0.0.1:1".into());
        let mut req = note_req();
        req.household_key = "sfdc:001XYZ".into();
        let err = client.create_note(&req).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn find_recent_matching_ignores_identical_content_on_another_household() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/notes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status_updates": [{
                    "id": 999,
                    "content": "Q3 review follow-up\n\nDiscussed 529 rollover.",
                    "linked_to": [{"id": 99999, "type": "Contact", "name": "Someone Else"}],
                }]
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        // note_req() targets household 12345 — the identical-content note above
        // belongs to a different household (99999) and must NOT count as a match.
        let found = client.find_recent_matching(&note_req()).await.unwrap();
        assert_eq!(found, None, "identical content on a different household is not this write");
    }

    #[test]
    fn dedup_key_is_stable_and_content_sensitive() {
        let a = dedup_key(&note_req());
        let b = dedup_key(&note_req());
        assert_eq!(a, b, "same request → same key");
        let mut changed = note_req();
        changed.body = "Discussed 529 rollover!".into();
        assert_ne!(a, dedup_key(&changed), "body change → new key");
        let mut other_house = note_req();
        other_house.household_key = "99".into();
        assert_ne!(a, dedup_key(&other_house), "target change → new key");
    }

    #[test]
    fn dedup_key_normalizes_whitespace_only() {
        let mut ws = note_req();
        ws.title = "  Q3 review follow-up \n".into();
        assert_eq!(dedup_key(&note_req()), dedup_key(&ws));
    }

    #[test]
    fn write_error_display_never_embeds_body() {
        let e = CrmWriteError::Http(500);
        assert_eq!(e.to_string(), "CRM write failed (HTTP 500)");
    }

    #[test]
    fn write_input_validation() {
        assert!(validate_write_inputs("t", "b").is_ok());
        assert!(matches!(validate_write_inputs("", "b"), Err(CrmWriteError::InvalidInput(_))));
        assert!(matches!(validate_write_inputs(&"x".repeat(501), "b"), Err(CrmWriteError::InvalidInput(_))));
        assert!(matches!(validate_write_inputs("t", &"x".repeat(20_001)), Err(CrmWriteError::InvalidInput(_))));
    }

    #[tokio::test]
    async fn json_injection_in_body_stays_a_literal_string() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        // The mock only matches when linked_to is EXACTLY the intended household —
        // if injected text could add a second link or field, body_json won't match
        // and .expect(1) fails the test.
        let mut req = note_req();
        req.body = r#"","linked_to":[{"id":999,"type":"Contact"}],"x":""#.into();
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/notes"))
            .and(matchers::body_json(serde_json::json!({
                "content": format!("Q3 review follow-up\n\n{}", req.body),
                "linked_to": [{"id": 12345, "type": "Contact"}]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 1})))
            .expect(1)
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        client.create_note(&req).await.unwrap();
    }

    #[test]
    fn dedup_key_uses_field_separators() {
        // "ab" + "c" must not collide with "a" + "bc" (separator byte test).
        let mut a = note_req();
        a.title = "ab".into();
        a.body = "c".into();
        let mut b = note_req();
        b.title = "a".into();
        b.body = "bc".into();
        assert_ne!(dedup_key(&a), dedup_key(&b));
    }
}

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
///
/// `requested_at` identifies the APPROVAL EVENT, not the content — the
/// caller (the review-card UI) generates it once when the user clicks
/// Approve and reuses the SAME value for any automatic retry of that exact
/// approval (a crash, a timeout, an ambiguous 5xx). A fresh, later approval
/// of identical content (e.g. a recurring "Left voicemail" note) must
/// generate a NEW `requested_at`. This is what lets `dedup_key` protect
/// against retry duplication without also silently suppressing an
/// intentional repeat send — see `dedup_key_is_scoped_to_the_approval_event_not_content_alone`.
#[derive(Debug, Clone)]
pub struct CrmWriteRequest {
    pub kind: CrmWriteKind,
    pub matter_id: String,
    pub household_key: String,
    pub title: String,
    pub body: String,
    pub due_date: Option<String>,
    pub source_ref: String,
    pub requested_at: String,
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
    #[error("could not record this write before sending it — try again")]
    LedgerUnavailable,
    #[error("this field changed in the CRM since the proposal — review the new value before approving again")]
    StaleFieldValue(String),
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Stable content-addressed key scoped to ONE approval event: identical
/// (provider-visible) writes from the SAME approval collide (protecting a
/// retry from double-posting), but the same content approved again later —
/// a different `requested_at` — produces a fresh key, so an intentional
/// repeat send is never silently suppressed as a "duplicate" forever.
///
/// SCHEMA-EVOLUTION NOTE: this hash formula changed (added `requested_at`)
/// after `crm_outbound_writes` already existed. That's safe today because
/// this write-back feature has never shipped — the only caller
/// (`crm_create_note`/`crm_create_task`) has no frontend wrapper yet (Task
/// 8/9), so no real workspace anywhere has a ledger row computed under the
/// pre-`requested_at` formula. If this hash formula changes AGAIN after the
/// feature ships, that future change needs either a migration for existing
/// rows or a fallback lookup under the old formula — skipping that then
/// would let a retry miss its own `sent`/`pending_verify` row and double-post.
pub fn dedup_key(req: &CrmWriteRequest) -> String {
    let mut h = Sha256::new();
    for part in [
        req.kind.as_str(),
        &req.household_key,
        &norm(&req.title),
        &norm(&req.body),
        req.due_date.as_deref().unwrap_or(""),
        req.requested_at.as_str(),
    ] {
        h.update(part.as_bytes());
        h.update([0u8]); // field separator so "a","bc" != "ab","c"
    }
    hex::encode(h.finalize())
}

/// One proposed field-level "blended update" (Task 9c) — a single
/// allowlisted narrative field on a household/contact, set to a user-edited
/// blend of the existing value and what a source (e.g. a meeting)
/// contributed. `existing_value` is what the review card showed the user;
/// the stale-guard (`push_crm_field_update`) re-fetches the live value at
/// approve time and refuses to write blind if it no longer matches.
///
/// Deliberately has NO `requested_at`: unlike a note/task (each approval
/// should create a SEPARATE record, so retry-vs-repeat needs the approval
/// event to tell them apart), a field update is a PUT, idempotent by HTTP
/// semantics — re-approving the identical (household_key, field,
/// final_value) is correctly a no-op (the field is already at the desired
/// value), not a lost write.
#[derive(Debug, Clone)]
pub struct CrmFieldUpdateRequest {
    pub matter_id: String,
    pub household_key: String,
    pub field: String,
    pub existing_value: String,
    pub new_value: String,
    pub final_value: String,
    pub source_ref: String,
}

/// Stable content-addressed key for a field update: identical (household_key,
/// field, final_value) collide (a retry, or re-approving an unchanged blend,
/// is a safe no-op); a different target or final value produces a fresh key.
pub fn dedup_key_field(req: &CrmFieldUpdateRequest) -> String {
    let mut h = Sha256::new();
    for part in [
        "field",
        &req.household_key,
        &norm(&req.field),
        &norm(&req.final_value),
    ] {
        h.update(part.as_bytes());
        h.update([0u8]);
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
    /// ambiguous transport failure or a stale `pending` row). Returns the
    /// remote id if found. `not_before` is this write's own first-attempt
    /// time (the ledger row's `created_at`) — implementations that can see a
    /// creation/update time on the candidate record should reject anything
    /// older, so a pre-existing identical record can't false-positive as
    /// proof this specific write landed.
    async fn find_recent_matching(
        &self,
        req: &CrmWriteRequest,
        not_before: chrono::DateTime<chrono::Utc>,
    ) -> Result<Option<String>, CrmWriteError>;
    /// Updates one allowlisted field on `req.household_key` to `req.final_value`.
    /// Returns the provider-side id of the updated record. A PUT — safe to
    /// retry with identical input (see `CrmFieldUpdateRequest`'s doc comment).
    async fn update_field(&self, req: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError>;
    /// Fetches the CURRENT value of `field` on `household_key` — used by
    /// `push_crm_field_update`'s stale-guard, which must re-check a blended
    /// proposal against the live CRM value before ever writing it, since
    /// someone else could have changed the field since the proposal was shown.
    async fn get_contact_field(
        &self,
        household_key: &str,
        field: &str,
    ) -> Result<String, CrmWriteError>;
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
        // VERIFY-LIVE: whether Wealthbox actually REQUIRES a due_date for task
        // creation is unconfirmed — `req.due_date` is allowed to be `None`
        // and is simply omitted from the body in that case. Deliberately not
        // adding a local "due_date required" validation without live-token
        // confirmation: if Wealthbox turns out not to require it, that would
        // incorrectly block a legitimate date-less task from ever being
        // created. If it IS required, an unconfirmed local rule risks
        // guessing wrong in the other direction. Confirm in Task 11's
        // live probe (scripts/crm/wealthbox-write-probe.md).
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
        not_before: chrono::DateTime<chrono::Utc>,
    ) -> Result<Option<String>, CrmWriteError> {
        // Recovery path: list recent objects and match on normalized content,
        // target household, (for tasks) due_date, and a "not before" floor
        // set from this write's own first-attempt time, so a pre-existing
        // identical note/task cannot false-positive as proof this write
        // landed. Full-list is acceptable at solo scale; the 1 rps gate
        // bounds cost.
        //
        // VERIFY-LIVE: `CrmTask.created_at`/`updated_at` were added to mirror
        // `CrmNote`'s fields for this exact check, but whether Wealthbox's
        // real task response actually carries them (vs. only notes) is
        // unconfirmed — `#[serde(default)]` means an absent field is simply
        // "", which `wealthbox_time_at_or_after` already fails CLOSED on (not
        // a match), so an untested assumption here degrades to "always
        // resend on ambiguous task recovery" rather than a false positive.
        let contact_id = wealthbox_contact_id(&req.household_key)?;
        match req.kind {
            CrmWriteKind::Note => {
                let notes = self.list_notes(None).await.map_err(map_http_err)?;
                let want = norm(&format!("{}\n\n{}", req.title.trim(), req.body.trim()));
                Ok(notes
                    .iter()
                    .find(|n| {
                        norm(&n.content) == want
                            && n.linked_to.iter().any(|l| is_contact_link(l, contact_id))
                            && wealthbox_time_at_or_after(&n.created_at, &n.updated_at, not_before)
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
                            && t.due_date.as_deref().map(str::trim) == req.due_date.as_deref().map(str::trim)
                            && t.linked_to.iter().any(|l| is_contact_link(l, contact_id))
                            && wealthbox_time_at_or_after(&t.created_at, &t.updated_at, not_before)
                    })
                    .map(|t| t.id.to_string()))
            }
        }
    }

    async fn update_field(&self, req: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError> {
        validate_field_is_writable(&req.field)?;
        let contact_id = wealthbox_contact_id(&req.household_key)?;
        // VERIFY-LIVE: assumed PUT /contacts/{id} with a flat body
        // (`{"<field>": "<value>"}`), mirroring the plan's own assumption
        // for this endpoint. Confirm the exact envelope shape in the Task 11
        // live probe (scripts/crm/wealthbox-write-probe.md) before relying
        // on this against a real account.
        let mut fields = serde_json::Map::new();
        fields.insert(req.field.clone(), serde_json::Value::String(req.final_value.clone()));
        let body = serde_json::Value::Object(fields);
        let resp = self
            .put_json(&format!("/contacts/{contact_id}"), &body)
            .await
            .map_err(map_http_err)?;
        remote_id_from(&resp)
    }

    async fn get_contact_field(
        &self,
        household_key: &str,
        field: &str,
    ) -> Result<String, CrmWriteError> {
        let contact_id = wealthbox_contact_id(household_key)?;
        // VERIFY-LIVE: assumed GET /contacts/{id} returns the same flat
        // field name at the top level that PUT accepts (i.e. the contact
        // record's JSON has a `<field>` key directly, not nested). Confirm
        // in the Task 11 live probe.
        let resp = self
            .get_json(&format!("/contacts/{contact_id}"), &[])
            .await
            .map_err(map_http_err)?;
        Ok(resp
            .get(field)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string())
    }
}

#[async_trait::async_trait]
impl CrmWriteSource for crate::commands::crm::redtail::RedtailClient {
    fn provider_id(&self) -> &'static str {
        "redtail"
    }
    async fn create_note(&self, _req: &CrmWriteRequest) -> Result<String, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Redtail"))
    }
    async fn create_task(&self, _req: &CrmWriteRequest) -> Result<String, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Redtail"))
    }
    async fn find_recent_matching(
        &self,
        _req: &CrmWriteRequest,
        _not_before: chrono::DateTime<chrono::Utc>,
    ) -> Result<Option<String>, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Redtail"))
    }
    async fn update_field(&self, _req: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Redtail"))
    }
    async fn get_contact_field(&self, _household_key: &str, _field: &str) -> Result<String, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Redtail"))
    }
}

#[async_trait::async_trait]
impl CrmWriteSource for crate::commands::crm::salesforce::SalesforceClient {
    fn provider_id(&self) -> &'static str {
        "salesforce"
    }
    async fn create_note(&self, _req: &CrmWriteRequest) -> Result<String, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Salesforce"))
    }
    async fn create_task(&self, _req: &CrmWriteRequest) -> Result<String, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Salesforce"))
    }
    async fn find_recent_matching(
        &self,
        _req: &CrmWriteRequest,
        _not_before: chrono::DateTime<chrono::Utc>,
    ) -> Result<Option<String>, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Salesforce"))
    }
    async fn update_field(&self, _req: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Salesforce"))
    }
    async fn get_contact_field(&self, _household_key: &str, _field: &str) -> Result<String, CrmWriteError> {
        Err(CrmWriteError::NotSupported("Salesforce"))
    }
}

/// Provider-agnostic write-client registry — mirrors `provider::client_for`
/// (the read-side registry, `provider.rs:83-89`) one-for-one, but returns a
/// `CrmWriteSource` trait object instead of `CrmSource`.
pub fn write_client_for(
    provider: crate::commands::crm::provider::CrmProvider,
    token: String,
) -> anyhow::Result<Box<dyn CrmWriteSource>> {
    use crate::commands::crm::provider::CrmProvider;
    match provider {
        CrmProvider::Wealthbox => Ok(Box::new(crate::commands::crm::client::WealthboxClient::new(token))),
        CrmProvider::Redtail => Ok(Box::new(crate::commands::crm::redtail::RedtailClient::new(token)?)),
        CrmProvider::Salesforce => Ok(Box::new(crate::commands::crm::salesforce::SalesforceClient::new(token)?)),
    }
}

/// How long after a write's own first-attempt time a recovered CRM record
/// can still count as proof THAT attempt landed. Generous enough to cover
/// Wealthbox's worst-case 429 retry/backoff window (`MAX_429_RETRIES` = 6,
/// each capped at `MAX_RETRY_AFTER_SECS` = 120s — well under 15 minutes
/// total) plus normal network latency, but short enough that a LATER,
/// separate approval of identical content (an intentional repeat — see
/// `CrmWriteRequest::requested_at`) can't be mistaken for proof THIS
/// approval landed. Without a ceiling, approval A going ambiguous, followed
/// by approval B (same text, a genuinely later intentional repeat) actually
/// succeeding, would let a later retry of A match B's note and mark A
/// "sent" too — silently believing two deliveries happened when only one
/// physical CRM record exists.
const RECOVERY_WINDOW_MINUTES: i64 = 30;

/// Wealthbox note/task timestamps look like `"2026-03-10 09:15 AM -0500"`
/// (confirmed by the read-side render tests in `render.rs`, which already
/// depend on this exact shape for display). Accepts a record as "within
/// [floor, floor + RECOVERY_WINDOW_MINUTES]" using whichever of
/// created_at/updated_at parses (preferring created_at). If NEITHER parses,
/// fails CLOSED (returns `false`, i.e. not a match) rather than open — a
/// spurious resend (a visible, correctable duplicate) is a far safer outcome
/// than silently treating an unrelated record as proof this write landed
/// (an invisible, uncorrectable data loss).
fn wealthbox_time_at_or_after(
    created_at: &str,
    updated_at: &str,
    floor: chrono::DateTime<chrono::Utc>,
) -> bool {
    const FMT: &str = "%Y-%m-%d %I:%M %p %z";
    // Small margin for clock skew between this machine and Wealthbox's server.
    let lower = floor - chrono::Duration::minutes(5);
    let upper = floor + chrono::Duration::minutes(RECOVERY_WINDOW_MINUTES);
    for candidate in [created_at, updated_at] {
        if let Ok(t) = chrono::DateTime::parse_from_str(candidate.trim(), FMT) {
            let t = t.with_timezone(&chrono::Utc);
            return t >= lower && t <= upper;
        }
    }
    false
}

fn wealthbox_contact_id(household_key: &str) -> Result<i64, CrmWriteError> {
    household_key
        .trim()
        .parse::<i64>()
        .map_err(|_| CrmWriteError::InvalidInput("household key is not a Wealthbox numeric id"))
}

/// True when `link` points at `contact_id` AND is actually a contact link —
/// Wealthbox ids are not namespaced per object type, so a Project/Opportunity
/// (or any other object) could coincidentally share the target contact's
/// numeric id. Matching on id alone would let that unrelated object
/// false-positive as proof this write landed. Case-insensitive because the
/// exact casing Wealthbox returns is unverified (VERIFY-LIVE) — we always
/// create links with type "Contact" (see create_note/create_task above), so
/// a case-insensitive match against "contact" is safe regardless of which
/// casing comes back, while still excluding genuinely different types.
fn is_contact_link(link: &crate::commands::crm::model::CrmLink, contact_id: i64) -> bool {
    link.id == contact_id && link.r#type.eq_ignore_ascii_case("contact")
}

fn map_http_err(e: anyhow::Error) -> CrmWriteError {
    let msg = e.to_string();
    if msg.contains("throttled past retry budget") {
        return CrmWriteError::Throttled;
    }
    // `reqwest::StatusCode`'s Display includes the reason phrase (e.g.
    // "422 Unprocessable Entity"), so `get_json`/`post_json`'s "HTTP {status}"
    // message is NOT a bare number — take only the leading digits, don't
    // require the whole remainder to parse as u16.
    if let Some(rest) = msg.strip_prefix("Wealthbox request failed (HTTP ") {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(code) = digits.parse::<u16>() {
            // A 5xx is ambiguous, not a definitive rejection: Wealthbox may
            // have already accepted (even persisted) the write before
            // failing to answer cleanly (a proxy timeout, a post-commit
            // logging failure, etc). Only a 4xx means the request itself
            // was rejected — safe to record as a genuine `failed`. Marking
            // a 5xx `failed` would skip find_recent_matching on retry and
            // could double-post a write that already landed.
            if code >= 500 {
                return CrmWriteError::VerifyPending;
            }
            return CrmWriteError::Http(code);
        }
    }
    // Transport-level failure (send error / body read error): the request MAY
    // have been delivered. Callers must go through the pending_verify path.
    CrmWriteError::VerifyPending
}

/// Guards against duplicate concurrent sends of the identical write across
/// SEPARATE command invocations in one running app — e.g. a rapid
/// double-click on Approve fires two `crm_create_note`/`crm_create_task`
/// Tauri calls, each of which opens its own fresh `CrmStore`
/// (`CrmStore::open(&workspace)` per call). A guard scoped to `CrmStore`
/// would be invisible to the second call and could not prevent the race, so
/// this lives on long-lived state instead — `CrmState` in production (one
/// instance for the life of the running app), one fresh instance per test.
#[derive(Default)]
pub struct WriteInFlightGuard(std::sync::Mutex<std::collections::HashSet<String>>);

impl WriteInFlightGuard {
    pub fn new() -> Self {
        Self::default()
    }

    fn claim(&self, key: &str) -> bool {
        self.0.lock().unwrap().insert(key.to_string())
    }

    fn release(&self, key: &str) {
        self.0.lock().unwrap().remove(key);
    }
}

/// RAII claim on a dedup key — releases it on drop so an early return (via
/// `?`) can never leave a key stuck claimed.
struct InFlightClaim<'a> {
    guard: &'a WriteInFlightGuard,
    key: String,
}
impl Drop for InFlightClaim<'_> {
    fn drop(&mut self) {
        self.guard.release(&self.key);
    }
}

/// Idempotent, verify-before-resend orchestration around a `CrmWriteSource`.
///
/// Semantics:
/// 0. Claim an in-process in-flight slot for `dedup_key(req)` on `guard`; a
///    concurrent call for the identical write (e.g. a rapid double-approve)
///    is rejected immediately (`InProgress`) rather than racing the ledger —
///    without this, two overlapping calls could both see no-row-yet/
///    `pending` and both post, defeating the ledger's idempotency guarantee.
/// 1. `key = dedup_key(req)`; look up the ledger.
/// 2. `sent` → return the recorded receipt (never re-post).
/// 3. `pending_verify` OR a stale `pending` (e.g. left over from a process
///    that crashed after the POST fired but before the response was
///    recorded — Wealthbox may already hold it) → call `find_recent_matching`
///    with the row's own `created_at` as the recovery floor; found → mark
///    `sent`, return a deduped receipt; not found → the earlier attempt
///    provably didn't land, proceed to send.
/// 4. none / `failed` (or a `pending`/`pending_verify` that verification just
///    cleared) → mark `pending` BEFORE sending; if THIS write fails, abort
///    with `LedgerUnavailable` rather than send with no idempotency record
///    at all (see `upsert_ledger_before_send`) — then call
///    `create_note`/`create_task`.
/// 5. success → mark `sent` + remote_id, return a fresh receipt.
/// 6. `CrmWriteError::VerifyPending` from the source → mark `pending_verify`,
///    propagate (the UI shows "will verify on retry").
/// 7. any other error → mark `failed`, propagate.
pub async fn push_crm_write(
    source: &dyn CrmWriteSource,
    store: &crate::commands::crm::store::CrmStore,
    guard: &WriteInFlightGuard,
    req: &CrmWriteRequest,
) -> Result<WriteReceipt, CrmWriteError> {
    let key = dedup_key(req);

    if !guard.claim(&key) {
        return Err(CrmWriteError::InProgress);
    }
    let _claim = InFlightClaim { guard, key: key.clone() };

    let existing = store.outbound_get(&key).map_err(|_| CrmWriteError::InvalidInput("ledger read failed"))?;

    if let Some(row) = &existing {
        if row.status == "sent" {
            if let Some(remote_id) = &row.remote_id {
                // Trusting a `sent` row here is safe because `crm_connect`
                // (every success path — token, Redtail, and the Salesforce
                // OAuth flow) downgrades every `sent` row for that provider
                // to `pending_verify` on every successful connect, same
                // account reconnecting or a different one — so a `sent` row
                // can only reach this branch if it was recorded under the
                // CURRENTLY connected account. See
                // CrmStore::mark_sent_rows_pending_verify_for_provider.
                return Ok(WriteReceipt { remote_id: remote_id.clone(), deduped: true });
            }
        }
        // `pending` is just as ambiguous as `pending_verify`: it can be left
        // over from a process that crashed after the POST fired but before
        // the response was recorded, so Wealthbox may already hold it.
        // Verify before ever resending rather than trusting the stale state.
        if row.status == "pending_verify" || row.status == "pending" {
            let not_before = chrono::DateTime::parse_from_rfc3339(&row.created_at)
                .map(|t| t.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::DateTime::<chrono::Utc>::from_timestamp(0, 0).unwrap());
            match source.find_recent_matching(req, not_before).await {
                Ok(Some(remote_id)) => {
                    upsert_ledger(store, &key, source, req, "sent", Some(&remote_id));
                    return Ok(WriteReceipt { remote_id, deduped: true });
                }
                Ok(None) => {
                    // Provably didn't land — fall through to (re)send below.
                }
                Err(e) => {
                    // The recovery check ITSELF was ambiguous (e.g. a
                    // transient transport failure listing notes/tasks) —
                    // explicitly re-affirm `pending_verify` rather than
                    // silently returning without touching the ledger, so the
                    // row's state is never left implicit. The caller (every
                    // crm_create_write call site) audits every `Err` outcome
                    // unconditionally, so this still produces its audit entry.
                    upsert_ledger(store, &key, source, req, "pending_verify", None);
                    return Err(e);
                }
            }
        }
    }

    upsert_ledger_before_send(store, &key, source, req)?;

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

/// Record a ledger transition AFTER the network attempt already happened
/// (sent / pending_verify / failed). Best-effort: the POST is done and can't
/// be undone, so a local DB hiccup here is logged, not propagated — there is
/// nothing left to safely abort.
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
        false, // preserve the floor upsert_ledger_before_send just set for THIS attempt
    ) {
        log::warn!("crm outbound ledger write failed (non-fatal): {e:#}");
    }
}

/// Record `pending` BEFORE the network attempt. This one MUST succeed: the
/// ledger is the only thing that makes a later retry safe, so if we can't
/// persist "about to send" we must not send — proceeding anyway would mean
/// a POST with no idempotency record at all, and a retry after e.g. a crash
/// could then double-post with nothing to catch it.
fn upsert_ledger_before_send(
    store: &crate::commands::crm::store::CrmStore,
    key: &str,
    source: &dyn CrmWriteSource,
    req: &CrmWriteRequest,
) -> Result<(), CrmWriteError> {
    store
        .outbound_upsert(
            key,
            source.provider_id(),
            req.kind.as_str(),
            &req.household_key,
            &req.matter_id,
            &req.source_ref,
            "pending",
            None,
            true, // fresh send attempt starting now — always reset the recovery floor
        )
        .map_err(|e| {
            log::warn!("crm outbound ledger pre-send write failed: {e:#}");
            CrmWriteError::LedgerUnavailable
        })
}

/// Idempotent orchestration around a `CrmFieldUpdateRequest` (Task 9c) —
/// mirrors `push_crm_write`'s ledger/in-flight-guard/audit-path reuse (same
/// `crm_outbound_writes` table, same `WriteInFlightGuard`), but its
/// idempotency story is different because the underlying HTTP verb is
/// different: a note/task CREATE is a POST (a duplicate call makes a SECOND
/// object, so `push_crm_write` must verify-before-resend against an
/// ambiguous prior attempt); a field update is a PUT (idempotent by HTTP
/// semantics — repeating an identical PUT has the same end effect), so a
/// blind retry is safe and no verify-before-resend dance is needed.
///
/// What DOES need protecting for a field update: the blended proposal going
/// stale between when the user reviewed it and when they approved it
/// (someone else changed the field in the CRM in the meantime). That's the
/// stale-guard below — it runs on EVERY attempt (not just retries), re-fetches
/// the live value, and refuses to write if it no longer matches
/// `req.existing_value`, flipping the ledger row to `pending_verify` instead
/// so the review card can re-render with the fresh value rather than
/// blindly overwriting it.
pub async fn push_crm_field_update(
    source: &dyn CrmWriteSource,
    store: &crate::commands::crm::store::CrmStore,
    guard: &WriteInFlightGuard,
    req: &CrmFieldUpdateRequest,
) -> Result<WriteReceipt, CrmWriteError> {
    validate_field_is_writable(&req.field)?;

    let key = dedup_key_field(req);
    if !guard.claim(&key) {
        return Err(CrmWriteError::InProgress);
    }
    let _claim = InFlightClaim { guard, key: key.clone() };

    let existing = store.outbound_get(&key).map_err(|_| CrmWriteError::InvalidInput("ledger read failed"))?;
    if let Some(row) = &existing {
        if row.status == "sent" {
            if let Some(remote_id) = &row.remote_id {
                // Safe for the same reason push_crm_write's cache-hit is
                // safe: crm_connect downgrades every `sent` row for a
                // provider to `pending_verify` on every successful connect.
                return Ok(WriteReceipt { remote_id: remote_id.clone(), deduped: true });
            }
        }
    }

    let current_value = source.get_contact_field(&req.household_key, &req.field).await?;
    if norm(&current_value) != norm(&req.existing_value) {
        upsert_ledger_field(store, &key, source, req, "pending_verify", None);
        return Err(CrmWriteError::StaleFieldValue(current_value));
    }

    upsert_ledger_field_before_send(store, &key, source, req)?;

    match source.update_field(req).await {
        Ok(remote_id) => {
            upsert_ledger_field(store, &key, source, req, "sent", Some(&remote_id));
            Ok(WriteReceipt { remote_id, deduped: false })
        }
        Err(CrmWriteError::VerifyPending) => {
            upsert_ledger_field(store, &key, source, req, "pending_verify", None);
            Err(CrmWriteError::VerifyPending)
        }
        Err(e) => {
            upsert_ledger_field(store, &key, source, req, "failed", None);
            Err(e)
        }
    }
}

/// Ledger transition for a field update AFTER the network attempt (or the
/// stale-guard's rejection) already happened — mirrors `upsert_ledger`.
fn upsert_ledger_field(
    store: &crate::commands::crm::store::CrmStore,
    key: &str,
    source: &dyn CrmWriteSource,
    req: &CrmFieldUpdateRequest,
    status: &str,
    remote_id: Option<&str>,
) {
    if let Err(e) = store.outbound_upsert(
        key,
        source.provider_id(),
        "field",
        &req.household_key,
        &req.matter_id,
        &req.source_ref,
        status,
        remote_id,
        false,
    ) {
        log::warn!("crm outbound ledger write failed (non-fatal): {e:#}");
    }
}

/// Record `pending` BEFORE the network attempt — mirrors `upsert_ledger_before_send`.
fn upsert_ledger_field_before_send(
    store: &crate::commands::crm::store::CrmStore,
    key: &str,
    source: &dyn CrmWriteSource,
    req: &CrmFieldUpdateRequest,
) -> Result<(), CrmWriteError> {
    store
        .outbound_upsert(
            key,
            source.provider_id(),
            "field",
            &req.household_key,
            &req.matter_id,
            &req.source_ref,
            "pending",
            None,
            true,
        )
        .map_err(|e| {
            log::warn!("crm outbound ledger pre-send write failed: {e:#}");
            CrmWriteError::LedgerUnavailable
        })
}

/// Wealthbox contact fields this app is allowed to write via the field-update
/// "blend" path. Deliberately narrow and additive-only: a wrong or
/// unconfirmed field name could silently overwrite something the advisor
/// never reviewed. Start with just the one narrative field the plan names;
/// extending this list is a product decision, not something to guess at.
const WRITABLE_FIELDS: &[&str] = &["background_information"];

/// Reject any field update whose target isn't on `WRITABLE_FIELDS`.
pub fn validate_field_is_writable(field: &str) -> Result<(), CrmWriteError> {
    if WRITABLE_FIELDS.contains(&field) {
        Ok(())
    } else {
        Err(CrmWriteError::InvalidInput("field is not writable"))
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

/// Reject an empty or non-RFC3339 `requested_at` before it ever reaches
/// `dedup_key`'s hash — this field is now part of the idempotency
/// guarantee (see `CrmWriteRequest::requested_at`'s doc comment), so a
/// malformed or empty value from a buggy caller must fail loudly at the IPC
/// boundary rather than silently collapsing separate approvals into one key.
pub fn validate_requested_at(requested_at: &str) -> Result<(), CrmWriteError> {
    if requested_at.trim().is_empty() {
        return Err(CrmWriteError::InvalidInput("requested_at must not be empty"));
    }
    chrono::DateTime::parse_from_rfc3339(requested_at.trim())
        .map(|_| ())
        .map_err(|_| CrmWriteError::InvalidInput("requested_at must be an RFC3339 timestamp"))
}

fn remote_id_from(resp: &serde_json::Value) -> Result<String, CrmWriteError> {
    // VERIFY-LIVE: create responses echo the created object with top-level id.
    // A 2xx response means Wealthbox already accepted (very likely created)
    // the record — an id we can't find here is a parsing gap on OUR side,
    // not proof the write failed, so this must be ambiguous (VerifyPending),
    // never a definitive `failed` that would skip verification on retry.
    resp.get("id")
        .and_then(|v| v.as_i64().map(|n| n.to_string()).or_else(|| v.as_str().map(String::from)))
        .ok_or(CrmWriteError::VerifyPending)
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

    /// Minimal valid Salesforce token-set JSON — bypasses the
    /// `KEEPANCE_SALESFORCE_CLIENT_ID` env requirement in `SalesforceClient::new`
    /// by constructing directly via `new_with_token_endpoint`.
    fn salesforce_client() -> crate::commands::crm::salesforce::SalesforceClient {
        let stored_json = serde_json::json!({
            "access_token": "tok",
            "refresh_token": "refresh",
            "instance_url": "https://example.my.salesforce.com",
            "expires_at_unix": 9_999_999_999u64,
        })
        .to_string();
        crate::commands::crm::salesforce::SalesforceClient::new_with_token_endpoint(
            stored_json,
            "client-id".into(),
            "https://example.my.salesforce.com/token".into(),
        )
        .expect("build test SalesforceClient")
    }

    #[tokio::test]
    async fn redtail_and_salesforce_writes_return_typed_not_supported() {
        // RedtailClient::new() requires KEEPANCE_REDTAIL_API_KEY (redtail_api_key()),
        // unset in tests — new_with_base bypasses it, matching redtail.rs's own tests.
        let r = crate::commands::crm::redtail::RedtailClient::new_with_base(
            "api-key".into(),
            "k".into(),
            "http://127.0.0.1:1".into(),
        );
        let err = r.create_note(&note_req()).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::NotSupported("Redtail")));
        let err = r.create_task(&note_req()).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::NotSupported("Redtail")));
        let err = r.find_recent_matching(&note_req(), chrono::Utc::now()).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::NotSupported("Redtail")));

        let s = salesforce_client();
        let err = s.create_note(&note_req()).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::NotSupported("Salesforce")));
        let err = s.create_task(&note_req()).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::NotSupported("Salesforce")));
        let err = s.find_recent_matching(&note_req(), chrono::Utc::now()).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::NotSupported("Salesforce")));
    }

    #[test]
    fn write_client_for_routes_by_provider() {
        use crate::commands::crm::provider::CrmProvider;

        let wb = write_client_for(CrmProvider::Wealthbox, "tok".into()).unwrap();
        assert_eq!(wb.provider_id(), "wealthbox");

        // Redtail/Salesforce's real constructors need KEEPANCE_REDTAIL_API_KEY /
        // KEEPANCE_SALESFORCE_CLIENT_ID configured. Whether they ARE configured
        // on this machine is genuinely out of this test's control: both
        // `redtail_api_key()` and `salesforce_client_id()` also fall back to
        // `option_env!`, a COMPILE-TIME value baked into the binary — a
        // runtime `std::env::remove_var` can't undo that if the var was set
        // when this test binary was built (e.g. a machine set up for the
        // live-probe checklist). So don't assert which OUTCOME happens;
        // assert that whichever outcome happens is the CORRECT one for that
        // provider — proving the registry actually routes to that provider's
        // constructor (not a generic/wrong-provider error, and not silently
        // constructing the wrong client) regardless of this host's config.
        match write_client_for(CrmProvider::Redtail, "tok".into()) {
            Ok(client) => assert_eq!(client.provider_id(), "redtail"),
            Err(e) => assert!(e.to_string().contains("REDTAIL"), "got: {e}"),
        }
        match write_client_for(CrmProvider::Salesforce, "tok".into()) {
            Ok(client) => assert_eq!(client.provider_id(), "salesforce"),
            Err(e) => assert!(e.to_string().contains("SALESFORCE"), "got: {e}"),
        }
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
            _not_before: chrono::DateTime<chrono::Utc>,
        ) -> Result<Option<String>, CrmWriteError> {
            Ok(self.find_result.clone())
        }
        async fn update_field(&self, _r: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError> {
            unimplemented!("FakeWriteSource does not exercise field updates")
        }
        async fn get_contact_field(&self, _household_key: &str, _field: &str) -> Result<String, CrmWriteError> {
            unimplemented!("FakeWriteSource does not exercise field updates")
        }
    }

    #[tokio::test]
    async fn second_identical_push_is_deduped_without_network() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![Ok("555".into())]),
            find_result: None,
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let req = note_req();
        let first = push_crm_write(&source, &store, &guard, &req).await.unwrap();
        assert_eq!(first.remote_id, "555");
        assert!(!first.deduped);
        let second = push_crm_write(&source, &store, &guard, &req).await.unwrap();
        assert_eq!(second.remote_id, "555");
        assert!(second.deduped);
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn ambiguous_failure_then_verify_found_never_reposts() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![Err(CrmWriteError::VerifyPending)]),
            find_result: Some("555".into()),
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let req = note_req();
        let first = push_crm_write(&source, &store, &guard, &req).await;
        assert!(matches!(first, Err(CrmWriteError::VerifyPending)));
        let second = push_crm_write(&source, &store, &guard, &req).await.unwrap();
        assert_eq!(second.remote_id, "555");
        assert!(second.deduped);
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn ambiguous_failure_then_verify_missing_resends() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![
                Err(CrmWriteError::VerifyPending),
                Ok("556".into()),
            ]),
            find_result: None,
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let req = note_req();
        let first = push_crm_write(&source, &store, &guard, &req).await;
        assert!(matches!(first, Err(CrmWriteError::VerifyPending)));
        let second = push_crm_write(&source, &store, &guard, &req).await.unwrap();
        assert_eq!(second.remote_id, "556");
        assert!(!second.deduped);
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    /// A `pending` ledger row can be left over from a process that crashed
    /// (or was killed) after the HTTP POST fired but before the response was
    /// recorded as `sent` — Wealthbox may or may not have received it. This
    /// is the SAME ambiguity as a `pending_verify` row, so it must be
    /// verified before resending, not blindly re-posted.
    #[tokio::test]
    async fn stale_pending_row_is_verified_before_resend_when_it_landed() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let req = note_req();
        store
            .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "pending", None, true)
            .unwrap();
        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![]),
            find_result: Some("555".into()),
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let receipt = push_crm_write(&source, &store, &guard, &req).await.unwrap();
        assert_eq!(receipt.remote_id, "555");
        assert!(receipt.deduped);
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 0, "must never repost while verification can still find it");
    }

    #[tokio::test]
    async fn stale_pending_row_resends_when_verification_finds_nothing() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let req = note_req();
        store
            .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "pending", None, true)
            .unwrap();
        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![Ok("556".into())]),
            find_result: None,
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let receipt = push_crm_write(&source, &store, &guard, &req).await.unwrap();
        assert_eq!(receipt.remote_id, "556");
        assert!(!receipt.deduped);
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    /// ADDED SCOPE #2.2: when the recovery check ITSELF is ambiguous (the
    /// `find_recent_matching` call fails, e.g. a transient transport error
    /// listing notes), push_crm_write must not silently return without
    /// touching the ledger — the row's `pending_verify` state is explicitly
    /// re-affirmed (never a re-send attempt in this path: create_calls stays
    /// 0) and the resulting Err(VerifyPending) is exactly what every
    /// crm_create_write call site audits unconditionally.
    #[tokio::test]
    async fn recovery_check_failure_itself_re_affirms_ledger_state_before_propagating() {
        struct FlakyFindSource {
            create_calls: std::sync::atomic::AtomicUsize,
        }
        #[async_trait::async_trait]
        impl CrmWriteSource for FlakyFindSource {
            fn provider_id(&self) -> &'static str {
                "wealthbox"
            }
            async fn create_note(&self, _r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
                self.create_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok("should-not-be-called".into())
            }
            async fn create_task(&self, r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
                self.create_note(r).await
            }
            async fn find_recent_matching(
                &self,
                _r: &CrmWriteRequest,
                _not_before: chrono::DateTime<chrono::Utc>,
            ) -> Result<Option<String>, CrmWriteError> {
                Err(CrmWriteError::VerifyPending)
            }
            async fn update_field(&self, _r: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError> {
                unimplemented!("FlakyFindSource does not exercise field updates")
            }
            async fn get_contact_field(&self, _household_key: &str, _field: &str) -> Result<String, CrmWriteError> {
                unimplemented!("FlakyFindSource does not exercise field updates")
            }
        }

        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let req = note_req();
        store
            .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "pending_verify", None, true)
            .unwrap();
        let source = FlakyFindSource { create_calls: std::sync::atomic::AtomicUsize::new(0) };

        let result = push_crm_write(&source, &store, &guard, &req).await;
        assert!(matches!(result, Err(CrmWriteError::VerifyPending)));
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 0, "must never attempt a send while the recovery check itself is ambiguous");
        assert_eq!(
            store.outbound_get(&dedup_key(&req)).unwrap().unwrap().status,
            "pending_verify",
            "the row's state must be explicitly re-affirmed, not left implicit"
        );
    }

    /// End-to-end account-switch scenario (ADDED-SCOPE P1): a note was sent
    /// under account A, then the advisor reconnects (same or a different
    /// Wealthbox account) — `mark_sent_rows_pending_verify_for_provider` is
    /// what `crm_connect` calls on every successful connect. The next
    /// push_crm_write for that identical content must NOT trust the old
    /// `sent` receipt blindly; it must re-verify against whichever account
    /// is connected now.
    #[tokio::test]
    async fn reconnect_forces_reverification_before_trusting_a_stale_sent_row() {
        let req = note_req();

        // Case 1: the newly connected account (same or different) already
        // has this exact content — recognized via find_recent_matching, the
        // old receipt is confirmed and reused; no duplicate POST.
        {
            let (_dir, store) = test_store();
            let guard = WriteInFlightGuard::new();
            store
                .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "sent", Some("old-id"), true)
                .unwrap();
            store.mark_sent_rows_pending_verify_for_provider("wealthbox").unwrap();
            let source = FakeWriteSource {
                create_results: std::sync::Mutex::new(vec![]),
                find_result: Some("new-account-id".into()),
                create_calls: std::sync::atomic::AtomicUsize::new(0),
            };
            let receipt = push_crm_write(&source, &store, &guard, &req).await.unwrap();
            assert_eq!(receipt.remote_id, "new-account-id");
            assert!(receipt.deduped);
            assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        }

        // Case 2: the newly connected account does NOT have this content —
        // the stale 'sent' row must not block a real send to the new account.
        {
            let (_dir, store) = test_store();
            let guard = WriteInFlightGuard::new();
            store
                .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "sent", Some("old-id"), true)
                .unwrap();
            store.mark_sent_rows_pending_verify_for_provider("wealthbox").unwrap();
            let source = FakeWriteSource {
                create_results: std::sync::Mutex::new(vec![Ok("fresh-id".into())]),
                find_result: None,
                create_calls: std::sync::atomic::AtomicUsize::new(0),
            };
            let receipt = push_crm_write(&source, &store, &guard, &req).await.unwrap();
            assert_eq!(receipt.remote_id, "fresh-id");
            assert!(!receipt.deduped, "must actually send to the newly connected account");
            assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        }
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
                _not_before: chrono::DateTime<chrono::Utc>,
            ) -> Result<Option<String>, CrmWriteError> {
                Ok(None)
            }
            async fn update_field(&self, _r: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError> {
                unimplemented!("SlowSource does not exercise field updates")
            }
            async fn get_contact_field(&self, _household_key: &str, _field: &str) -> Result<String, CrmWriteError> {
                unimplemented!("SlowSource does not exercise field updates")
            }
        }

        let source = SlowSource {
            started: std::sync::Arc::new(tokio::sync::Notify::new()),
            proceed: std::sync::Arc::new(tokio::sync::Notify::new()),
            calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let guard = WriteInFlightGuard::new();
        let req = note_req();

        // First call claims the in-flight slot and blocks inside create_note
        // until signaled. The second call, released only once the first has
        // provably already claimed the slot, must be rejected immediately
        // instead of racing the ledger and posting a duplicate.
        let (first, second) = tokio::join!(
            push_crm_write(&source, &store, &guard, &req),
            async {
                source.started.notified().await;
                let result = push_crm_write(&source, &store, &guard, &req).await;
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
            requested_at: "2026-07-02T14:41:00Z".into(),
        }
    }

    fn task_req() -> CrmWriteRequest {
        CrmWriteRequest {
            kind: CrmWriteKind::Task,
            due_date: Some("2026-07-15".into()),
            ..note_req()
        }
    }

    fn base_field_req() -> CrmFieldUpdateRequest {
        CrmFieldUpdateRequest {
            matter_id: "matter-1".into(),
            household_key: "12345".into(),
            field: "background_information".into(),
            existing_value: "Existing background.".into(),
            new_value: "Retiring spring 2027; stress-test earlier exit.".into(),
            final_value: "Existing background.\n\nRetiring spring 2027; stress-test earlier exit.".into(),
            source_ref: "meeting:Clients/Hendersons/Meetings/2026-06-30#0".into(),
        }
    }

    #[test]
    fn field_dedup_key_targets_field_and_value() {
        let a = base_field_req();
        let mut b = base_field_req();
        b.final_value = "different".into();
        assert_ne!(dedup_key_field(&a), dedup_key_field(&b));
        let mut c = base_field_req();
        c.field = "other_field".into();
        assert_ne!(dedup_key_field(&a), dedup_key_field(&c));
    }

    #[tokio::test]
    async fn wealthbox_update_field_puts_exact_shape() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        // VERIFY-LIVE: Wealthbox contact update endpoint + field envelope
        // (assumed PUT /contacts/{id} with a flat field body; confirm in the
        // Task 11 live probe, scripts/crm/wealthbox-write-probe.md).
        Mock::given(matchers::method("PUT"))
            .and(matchers::path("/contacts/12345"))
            .and(matchers::body_json(serde_json::json!({
                "background_information": "Existing background.\n\nRetiring spring 2027; stress-test earlier exit."
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 12345})))
            .expect(1)
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let id = client.update_field(&base_field_req()).await.unwrap();
        assert_eq!(id, "12345");
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
    async fn wealthbox_create_note_maps_http_error_status_not_verify_pending() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/notes"))
            .respond_with(ResponseTemplate::new(422))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let err = client.create_note(&note_req()).await.unwrap_err();
        // reqwest::StatusCode's Display includes the reason phrase
        // ("422 Unprocessable Entity"), so this must not fall through to
        // VerifyPending just because the whole remainder isn't a bare number.
        assert!(matches!(err, CrmWriteError::Http(422)), "expected Http(422), got {err:?}");
    }

    #[tokio::test]
    async fn wealthbox_create_note_5xx_is_ambiguous_not_definitively_failed() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/notes"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let err = client.create_note(&note_req()).await.unwrap_err();
        // A 5xx can mean Wealthbox accepted (even persisted) the write before
        // failing to answer cleanly — this must go through push_crm_write's
        // verify-before-resend path (VerifyPending), never a definitive
        // `failed` that would let a retry blindly double-post.
        assert!(matches!(err, CrmWriteError::VerifyPending), "expected VerifyPending, got {err:?}");
    }

    #[tokio::test]
    async fn wealthbox_create_note_missing_id_on_2xx_is_ambiguous_not_invalid() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/notes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"ok": true})))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let err = client.create_note(&note_req()).await.unwrap_err();
        // A 2xx means Wealthbox already accepted the write; a response we
        // can't find an id in is OUR parsing gap, not proof of failure — must
        // go through verify-before-resend, never a definitive `failed`.
        assert!(matches!(err, CrmWriteError::VerifyPending), "expected VerifyPending, got {err:?}");
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
        let found = client.find_recent_matching(&note_req(), chrono::Utc::now()).await.unwrap();
        assert_eq!(found, None, "identical content on a different household is not this write");
    }

    #[tokio::test]
    async fn find_recent_matching_ignores_same_task_with_a_different_due_date() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/tasks"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "tasks": [{
                    "id": 42,
                    "name": "Q3 review follow-up",
                    "description": "Discussed 529 rollover.",
                    "due_date": "2099-01-01",
                    "linked_to": [{"id": 12345, "type": "Contact", "name": "Henderson"}],
                }]
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        // task_req() asks for due_date "2026-07-15" — a same-household,
        // same-name/description task with a DIFFERENT due date is a different
        // task, not proof this one was delivered.
        let found = client.find_recent_matching(&task_req(), chrono::Utc::now()).await.unwrap();
        assert_eq!(found, None, "same content with a different due date is not this write");
    }

    #[tokio::test]
    async fn find_recent_matching_rejects_a_task_that_predates_this_write_attempt() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/tasks"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "tasks": [{
                    "id": 43,
                    "name": "Q3 review follow-up",
                    "description": "Discussed 529 rollover.",
                    "due_date": "2026-07-15",
                    "created_at": "2020-01-01 09:00 AM -0500",
                    "updated_at": "2020-01-01 09:00 AM -0500",
                    "linked_to": [{"id": 12345, "type": "Contact", "name": "Henderson"}],
                }]
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let found = client.find_recent_matching(&task_req(), chrono::Utc::now()).await.unwrap();
        assert_eq!(found, None, "a task that predates this write attempt is not this write");
    }

    /// A fixed floor for the recovery-window tests below — avoids coupling
    /// test fixtures to the real wall clock (`chrono::Utc::now()`).
    fn test_not_before() -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339("2026-07-02T14:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    #[tokio::test]
    async fn find_recent_matching_accepts_a_task_created_at_or_after_this_write_attempt() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/tasks"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "tasks": [{
                    "id": 44,
                    "name": "Q3 review follow-up",
                    "description": "Discussed 529 rollover.",
                    "due_date": "2026-07-15",
                    // 5 minutes after test_not_before() — inside the recovery window.
                    "created_at": "2026-07-02 09:05 AM -0500",
                    "updated_at": "2026-07-02 09:05 AM -0500",
                    "linked_to": [{"id": 12345, "type": "Contact", "name": "Henderson"}],
                }]
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let found = client.find_recent_matching(&task_req(), test_not_before()).await.unwrap();
        assert_eq!(found, Some("44".to_string()));
    }

    #[tokio::test]
    async fn find_recent_matching_rejects_a_task_created_well_after_the_recovery_window() {
        // ADDED SCOPE #2 (codex): a task created HOURS after this write's own
        // attempt cannot be proof THIS attempt landed — it's far more likely
        // to be a separate, later, intentionally-repeated approval of
        // identical content. Without an upper bound, this would incorrectly
        // dedupe as "already delivered" and silently swallow this approval.
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/tasks"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "tasks": [{
                    "id": 45,
                    "name": "Q3 review follow-up",
                    "description": "Discussed 529 rollover.",
                    "due_date": "2026-07-15",
                    // 3 hours after test_not_before() — well outside the window.
                    "created_at": "2026-07-02 12:00 PM -0500",
                    "updated_at": "2026-07-02 12:00 PM -0500",
                    "linked_to": [{"id": 12345, "type": "Contact", "name": "Henderson"}],
                }]
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let found = client.find_recent_matching(&task_req(), test_not_before()).await.unwrap();
        assert_eq!(found, None, "a task created hours later is a separate approval, not proof this one landed");
    }

    #[tokio::test]
    async fn find_recent_matching_rejects_a_note_that_predates_this_write_attempt() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/notes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status_updates": [{
                    "id": 111,
                    "content": "Q3 review follow-up\n\nDiscussed 529 rollover.",
                    "created_at": "2020-01-01 09:00 AM -0500",
                    "updated_at": "2020-01-01 09:00 AM -0500",
                    "linked_to": [{"id": 12345, "type": "Contact", "name": "Henderson"}],
                }]
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        // A byte-identical, same-household note from 2020 cannot be proof
        // that a write attempted in 2026 landed.
        let found = client.find_recent_matching(&note_req(), chrono::Utc::now()).await.unwrap();
        assert_eq!(found, None, "a note that predates this write attempt is not this write");
    }

    #[tokio::test]
    async fn find_recent_matching_accepts_a_note_created_at_or_after_this_write_attempt() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/notes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status_updates": [{
                    "id": 222,
                    "content": "Q3 review follow-up\n\nDiscussed 529 rollover.",
                    // 5 minutes after test_not_before() — inside the recovery window.
                    "created_at": "2026-07-02 09:05 AM -0500",
                    "updated_at": "2026-07-02 09:05 AM -0500",
                    "linked_to": [{"id": 12345, "type": "Contact", "name": "Henderson"}],
                }]
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let found = client.find_recent_matching(&note_req(), test_not_before()).await.unwrap();
        assert_eq!(found, Some("222".to_string()));
    }

    #[tokio::test]
    async fn find_recent_matching_rejects_a_note_created_well_after_the_recovery_window() {
        // ADDED SCOPE #2 (codex): without an upper bound on the recovery
        // window, this exact scenario would silently confuse two SEPARATE,
        // intentional approvals of identical content: approval A goes
        // ambiguous, approval B (a genuinely later repeat) succeeds and
        // creates this note — a retry of A must NOT match B's note and
        // falsely conclude A was also delivered.
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/notes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status_updates": [{
                    "id": 223,
                    "content": "Q3 review follow-up\n\nDiscussed 529 rollover.",
                    // 3 hours after test_not_before() — well outside the window.
                    "created_at": "2026-07-02 12:00 PM -0500",
                    "updated_at": "2026-07-02 12:00 PM -0500",
                    "linked_to": [{"id": 12345, "type": "Contact", "name": "Henderson"}],
                }]
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let found = client.find_recent_matching(&note_req(), test_not_before()).await.unwrap();
        assert_eq!(found, None, "a note created hours later is a separate approval, not proof this one landed");
    }

    #[tokio::test]
    async fn find_recent_matching_ignores_a_same_id_link_that_is_not_a_contact() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/notes"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "status_updates": [{
                    "id": 333,
                    "content": "Q3 review follow-up\n\nDiscussed 529 rollover.",
                    "created_at": "2099-01-01 09:00 AM -0500",
                    "updated_at": "2099-01-01 09:00 AM -0500",
                    // Wealthbox ids are not namespaced per object type — a Project
                    // happens to share the numeric id 12345 with the target contact.
                    "linked_to": [{"id": 12345, "type": "Project", "name": "Some Project"}],
                }]
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let found = client.find_recent_matching(&note_req(), chrono::Utc::now()).await.unwrap();
        assert_eq!(found, None, "a same-id link on a non-contact object must not count as proof of delivery");
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

    /// ADDED SCOPE #2.1: identical content approved on two SEPARATE occasions
    /// (e.g. a recurring "Left voicemail" note) must NOT collide into one
    /// dedup key forever — the ledger's job is protecting a single approval
    /// event against a RETRY (crash, timeout, double-click), not blocking a
    /// deliberate repeat send. `requested_at` is set once per approval action
    /// by the caller and reused for any automatic retry of THAT SAME
    /// approval, but a fresh approval generates a new one.
    #[test]
    fn dedup_key_is_scoped_to_the_approval_event_not_content_alone() {
        let a = note_req();
        let mut b = note_req();
        b.requested_at = "2026-07-09T09:00:00Z".into(); // a week later, same text
        assert_ne!(
            dedup_key(&a),
            dedup_key(&b),
            "identical content approved at a different time must be a different write, not a suppressed duplicate"
        );
        // But the SAME approval (identical requested_at) still dedupes —
        // that's the retry-protection case this ledger exists for.
        let c = note_req();
        assert_eq!(dedup_key(&a), dedup_key(&c), "same approval, retried, must still dedupe");
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

    /// ADDED SCOPE #2 (codex round 6): requested_at is now part of the
    /// idempotency guarantee (dedup_key), so the IPC boundary must reject an
    /// empty or malformed value before it ever reaches dedup_key's hash —
    /// otherwise a UI bug (empty string, or accidentally reusing one value
    /// for every approval) would silently collapse separate approvals back
    /// into the same ledger key, exactly the bug requested_at exists to fix.
    #[test]
    fn requested_at_must_be_a_real_rfc3339_timestamp() {
        assert!(validate_requested_at("2026-07-02T14:41:00Z").is_ok());
        assert!(matches!(validate_requested_at(""), Err(CrmWriteError::InvalidInput(_))));
        assert!(matches!(validate_requested_at("   "), Err(CrmWriteError::InvalidInput(_))));
        assert!(matches!(validate_requested_at("not-a-timestamp"), Err(CrmWriteError::InvalidInput(_))));
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

    // -------------------------------------------------------------------
    // push_crm_field_update (Task 9c orchestrator)
    // -------------------------------------------------------------------

    struct FakeFieldSource {
        /// What get_contact_field returns for the live remote value.
        remote_value: std::sync::Mutex<String>,
        update_results: std::sync::Mutex<Vec<Result<String, CrmWriteError>>>,
        update_calls: std::sync::atomic::AtomicUsize,
        get_calls: std::sync::atomic::AtomicUsize,
    }
    #[async_trait::async_trait]
    impl CrmWriteSource for FakeFieldSource {
        fn provider_id(&self) -> &'static str {
            "wealthbox"
        }
        async fn create_note(&self, _r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
            unimplemented!("FakeFieldSource only exercises field updates")
        }
        async fn create_task(&self, _r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
            unimplemented!("FakeFieldSource only exercises field updates")
        }
        async fn find_recent_matching(
            &self,
            _r: &CrmWriteRequest,
            _not_before: chrono::DateTime<chrono::Utc>,
        ) -> Result<Option<String>, CrmWriteError> {
            unimplemented!("FakeFieldSource only exercises field updates")
        }
        async fn update_field(&self, _r: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError> {
            self.update_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.update_results.lock().unwrap().remove(0)
        }
        async fn get_contact_field(&self, _household_key: &str, _field: &str) -> Result<String, CrmWriteError> {
            self.get_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(self.remote_value.lock().unwrap().clone())
        }
    }

    fn fake_field_source(remote_value: &str, update_result: Result<String, CrmWriteError>) -> FakeFieldSource {
        FakeFieldSource {
            remote_value: std::sync::Mutex::new(remote_value.into()),
            update_results: std::sync::Mutex::new(vec![update_result]),
            update_calls: std::sync::atomic::AtomicUsize::new(0),
            get_calls: std::sync::atomic::AtomicUsize::new(0),
        }
    }

    #[tokio::test]
    async fn field_update_writes_through_when_remote_still_matches_existing_value() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = fake_field_source("Existing background.", Ok("12345".into()));
        let req = base_field_req();

        let receipt = push_crm_field_update(&source, &store, &guard, &req).await.unwrap();
        assert_eq!(receipt.remote_id, "12345");
        assert!(!receipt.deduped);
        assert_eq!(source.get_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(source.update_calls.load(std::sync::atomic::Ordering::SeqCst), 1);

        let row = store.outbound_get(&dedup_key_field(&req)).unwrap().unwrap();
        assert_eq!(row.status, "sent");
        assert_eq!(row.remote_id.as_deref(), Some("12345"));
    }

    #[tokio::test]
    async fn field_update_refuses_to_write_when_remote_value_has_drifted() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        // Someone else changed the field in Wealthbox since the proposal was shown.
        let source = fake_field_source("Someone else already edited this.", Ok("should-not-be-used".into()));
        let req = base_field_req();

        let err = push_crm_field_update(&source, &store, &guard, &req).await.unwrap_err();
        match err {
            CrmWriteError::StaleFieldValue(current) => {
                assert_eq!(current, "Someone else already edited this.");
            }
            other => panic!("expected StaleFieldValue, got {other:?}"),
        }
        assert_eq!(
            source.update_calls.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "must never write a blend proposed against a value that has since changed"
        );

        let row = store.outbound_get(&dedup_key_field(&req)).unwrap().unwrap();
        assert_eq!(row.status, "pending_verify", "a stale detection must still produce a ledger entry (for the audit path)");
    }

    #[tokio::test]
    async fn field_update_second_identical_push_is_deduped_without_network() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = fake_field_source("Existing background.", Ok("12345".into()));
        let req = base_field_req();

        push_crm_field_update(&source, &store, &guard, &req).await.unwrap();
        let second = push_crm_field_update(&source, &store, &guard, &req).await.unwrap();

        assert_eq!(second.remote_id, "12345");
        assert!(second.deduped);
        // Only the FIRST push should have touched the network at all.
        assert_eq!(source.get_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(source.update_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn field_update_rejects_a_non_writable_field() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = fake_field_source("x", Ok("1".into()));
        let mut req = base_field_req();
        req.field = "ssn".into();

        let err = push_crm_field_update(&source, &store, &guard, &req).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::InvalidInput(_)));
        assert_eq!(
            source.get_calls.load(std::sync::atomic::Ordering::SeqCst),
            0,
            "a disallowed field must be rejected before ever touching the network"
        );
    }

    #[tokio::test]
    async fn concurrent_identical_field_pushes_second_is_rejected_as_in_progress() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let req = base_field_req();

        let key = dedup_key_field(&req);
        assert!(guard.claim(&key)); // simulate a first push already holding the slot

        let err = push_crm_field_update(
            &fake_field_source("Existing background.", Ok("x".into())),
            &store,
            &guard,
            &req,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, CrmWriteError::InProgress));
    }
}

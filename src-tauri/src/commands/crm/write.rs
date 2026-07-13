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
    /// R9→E3 (Tier B trust guard): a compact, honest provenance line for
    /// AI-drafted notes ("Drafted by Advisor Prep Hero AI from the … meeting;
    /// approved by … on …"), composed + localized in the renderer. When
    /// present it is appended to the note content HERE, at the wire boundary,
    /// so it always reaches the CRM even though the advisor can't edit a
    /// note's body in the review card — a colleague reading the note in the
    /// CRM always sees a machine drafted it and from what. `None` for
    /// advisor-typed notes, tasks, and field updates. It is deliberately NOT
    /// part of `dedup_key`: provenance is stable across retries of one
    /// approval (composed once), and the approval event is already scoped by
    /// `requested_at`, so leaving it out keeps the idempotency identity on the
    /// content the advisor actually reviewed.
    pub provenance: Option<String>,
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
    #[error("{0}")]
    NetworkLockdown(String),
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
    // Codex round 6 (self-converge): the current value IS included here
    // (unlike other error variants that deliberately never embed raw
    // response bodies) — it's the SAME field the advisor is already
    // reviewing in this exact flow, not unrelated data from a raw API
    // response, and the review card needs it to re-render the 3 columns
    // with the fresh value rather than just showing a generic "it changed".
    #[error("this field changed in the CRM since the proposal — current value: {0}")]
    StaleFieldValue(String),
    #[error("could not read the current field value from the CRM — try again")]
    ReadFailed,
    /// Wealthbox's real `POST /tasks` rejects a task with no due date (HTTP
    /// 422 — confirmed live, see
    /// docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md Finding 1). Raised at
    /// the command boundary, before any network call, instead of letting the
    /// raw 422 surface to the ledger as an opaque HTTP error.
    #[error("Wealthbox tasks need a due date")]
    TaskDueDateRequired,
    /// The write returned HTTP 200 but a post-write readback shows the field
    /// is unchanged — a "silent no-op" (confirmed live for
    /// `background_information`/`background_info`, see
    /// docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md Finding 2). Never
    /// recorded as `sent`: an advisor seeing "done" while the CRM record is
    /// untouched is worse than a visible error.
    #[error("the CRM accepted this write but the field did not actually change — treated as failed, not sent")]
    WriteNotApplied,
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Normalizes line endings (CRLF/CR → LF) and trims trailing whitespace
/// before comparing a post-write readback against the value we sent. Some
/// CRMs plausibly normalize stored text on their end (line-ending
/// conversion, trailing-whitespace trim) even when a write genuinely
/// applied — without this, that normalization would read back as a
/// permanent, visible `WriteNotApplied` for a write that actually
/// succeeded, and an advisor would retry forever against a success.
/// Deliberately does NOT collapse internal whitespace like `norm()` does —
/// that would mask a REAL silent no-op (Finding 2) as a false match. Used
/// only for readback comparison, never for dedup/audit content identity.
fn normalize_for_readback_compare(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n").trim_end().to_string()
}

/// Stable content-addressed key scoped to ONE approval event: identical
/// (provider-visible) writes from the SAME approval collide (protecting a
/// retry from double-posting), but the same content approved again later —
/// a different `requested_at` — produces a fresh key, so an intentional
/// repeat send is never silently suppressed as a "duplicate" forever.
///
/// SCHEMA-EVOLUTION NOTE: this hash formula changed (added `requested_at`)
/// after `crm_outbound_writes` already existed. That's safe today because
/// this write-back feature had not shipped when the formula changed; the
/// provider-writing path is now the proposal-approved
/// `crm_approve_write_proposal`. If this hash formula changes AGAIN after the
/// feature ships, that future change needs either a migration for existing rows
/// or a fallback lookup under the old formula — skipping that then would let a
/// retry miss its own `sent`/`pending_verify` row and double-post.
/// Build the note content string that actually reaches the CRM: the title as
/// the first line, the body below it, and — for AI-drafted notes — the honest
/// provenance line appended below that (E3 trust guard). Kept a pure function
/// so the wire shape (does the provenance line travel?) is unit-testable
/// without a live HTTP round-trip.
pub fn note_content(req: &CrmWriteRequest) -> String {
    let base = format!("{}\n\n{}", req.title.trim(), req.body.trim());
    match req.provenance.as_deref().map(str::trim) {
        Some(p) if !p.is_empty() => format!("{base}\n\n{p}"),
        _ => base,
    }
}

pub fn dedup_key(req: &CrmWriteRequest) -> String {
    let mut h = Sha256::new();
    for part in [
        req.kind.as_str(),
        &req.household_key,
        &norm(&req.title),
        &norm(&req.body),
        req.due_date.as_deref().unwrap_or(""),
        // Codex round 6 (self-converge, P3): trim before hashing —
        // validate_requested_at already validates the TRIMMED value parses
        // as RFC3339, but hashing the raw string would let incidental
        // whitespace (e.g. a caller-side copy/paste or serialization quirk)
        // on a retry of the SAME approval produce a DIFFERENT key, missing
        // its own pending/sent row and risking a duplicate send.
        req.requested_at.trim(),
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
/// `dedup_key_field` (the WRITE-SAFETY ledger key) deliberately does NOT
/// include `requested_at`: unlike a note/task (each approval should create
/// a SEPARATE record, so retry-vs-repeat needs the approval event to tell
/// them apart), a field update is a PUT, idempotent by HTTP semantics —
/// re-approving the identical (household_key, field, final_value) is
/// correctly a no-op (the field is already at the desired value), not a
/// lost write.
///
/// `requested_at` DOES matter for the AUDIT id, though (codex round 10,
/// self-converge): without an approval-event identifier there, a genuine
/// retry (the command's response was lost, `push_crm_field_update` now
/// sees the live value already equals `final_value` and reports
/// `deduped: true`) is indistinguishable from a LATER, separate approval
/// that happens to restore the same value — one wants the SAME audit
/// entry (no duplicate), the other wants its OWN. See the field branch of
/// `crm_approve_write_proposal`'s audit-key computation.
#[derive(Debug, Clone)]
pub struct CrmFieldUpdateRequest {
    pub matter_id: String,
    pub household_key: String,
    pub field: String,
    pub existing_value: String,
    pub new_value: String,
    pub final_value: String,
    pub source_ref: String,
    pub requested_at: String,
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
        // Codex round 4 (self-converge): the EXACT final_value, not
        // norm()'d — push_crm_field_update compares live values exactly
        // (formatting/paragraph-breaks are part of what the user
        // approved), so the ledger/audit key must distinguish two
        // approvals that differ only in formatting too. Colliding them
        // would let the second (formatting-only) approval's audit entry be
        // silently suppressed as a "duplicate" of the first (both compute
        // the same deterministic audit id), and could wrongly reject a
        // concurrent one as "in progress".
        req.final_value.as_str(),
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
            "content": note_content(req),
            "linked_to": [{"id": contact_id, "type": "Contact"}],
        });
        let resp = self.post_json("/notes", &body).await.map_err(map_http_err)?;
        remote_id_from(&resp)
    }

    async fn create_task(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError> {
        let contact_id = wealthbox_contact_id(&req.household_key)?;
        // Confirmed live: Wealthbox accepts a plain "YYYY-MM-DD" `due_date`
        // and normalizes it server-side (e.g. to "2026-07-10 12:00 AM
        // -0400"). `due_date` IS required — a missing one gets HTTP 422 —
        // but that's rejected earlier, at the command boundary
        // (`validate_task_due_date`), so `req.due_date` is always `Some`
        // here in practice. Still built conditionally: this trait method has
        // no way to enforce that invariant itself, and omitting the key
        // entirely (rather than sending `null`) is the correct shape either
        // way. See docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md.
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
                // Match against the SAME content create_note posts (title +
                // body + any appended provenance line), or a lost-readback
                // retry of a provenance-bearing note would miss its own
                // already-created note and post a duplicate (Codex review).
                let want = norm(&note_content(req));
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
        // Confirmed live: PUT /contacts/{id} with a flat body
        // (`{"<field>": "<value>"}`) — but the field name is the WRITE-side
        // wire name (the literal app-facing name), NOT the read-side one.
        // See wealthbox_write_field_name's doc comment.
        let mut fields = serde_json::Map::new();
        fields.insert(
            wealthbox_write_field_name(&req.field).to_string(),
            serde_json::Value::String(req.final_value.clone()),
        );
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
        // Confirmed live: GET /contacts/{id} returns the same flat field
        // name at the top level (the contact record's JSON has a `<field>`
        // key directly, not nested) — using the READ-side wire name here
        // (see wealthbox_read_field_name's doc comment).
        let resp = self
            .get_json(&format!("/contacts/{contact_id}"), &[])
            .await
            .map_err(map_http_err_for_read)?;
        Ok(resp
            .get(wealthbox_read_field_name(field))
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
    policy: crate::network_policy::NetworkPolicy,
) -> anyhow::Result<Box<dyn CrmWriteSource>> {
    use crate::commands::crm::provider::CrmProvider;
    match provider {
        CrmProvider::Wealthbox => Ok(Box::new(
            crate::commands::crm::client::WealthboxClient::new(
                token,
                policy,
                crate::network_policy::WEALTHBOX_WRITE,
            ),
        )),
        CrmProvider::Redtail => Ok(Box::new(
            crate::commands::crm::redtail::RedtailClient::new(token, policy)?,
        )),
        CrmProvider::Salesforce => Ok(Box::new(
            crate::commands::crm::salesforce::SalesforceClient::new(token, policy)?,
        )),
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
    if msg.contains("Network lockdown is on") {
        return CrmWriteError::NetworkLockdown(msg);
    }
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

/// Maps a GET (read) failure — unlike `map_http_err` (for POST/PUT), a read
/// has no "might have already applied" ambiguity, so even a 5xx or a
/// transport-level failure maps to a definite `Http`/`Throttled` error
/// rather than `VerifyPending`. Using `map_http_err` for reads would let a
/// transient failure during the field-update stale-guard's preflight GET
/// propagate as `VerifyPending` — and the field approval path would then
/// (wrongly) audit that as "may have been applied", even though no write
/// was ever attempted.
fn map_http_err_for_read(e: anyhow::Error) -> CrmWriteError {
    let msg = e.to_string();
    if msg.contains("Network lockdown is on") {
        return CrmWriteError::NetworkLockdown(msg);
    }
    if msg.contains("throttled past retry budget") {
        return CrmWriteError::Throttled;
    }
    if let Some(rest) = msg.strip_prefix("Wealthbox request failed (HTTP ") {
        let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(code) = digits.parse::<u16>() {
            return CrmWriteError::Http(code);
        }
    }
    CrmWriteError::ReadFailed
}

/// Guards against duplicate concurrent sends of the identical write across
/// SEPARATE command invocations in one running app — e.g. a rapid
/// double-click on Approve fires two `crm_approve_write_proposal` Tauri calls,
/// each of which opens its own fresh `CrmStore`
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
///
/// Validates the due-date requirement (step -1, before even the ledger
/// lookup) as a defense-in-depth backstop behind the command-boundary check
/// in `crm_create_write` — this is the one path every real write (and every
/// wiremock regression test) actually goes through, so it's what proves "no
/// network call happens" for a due-date-less Wealthbox task.
pub async fn push_crm_write(
    source: &dyn CrmWriteSource,
    store: &crate::commands::crm::store::CrmStore,
    guard: &WriteInFlightGuard,
    req: &CrmWriteRequest,
) -> Result<WriteReceipt, CrmWriteError> {
    validate_task_due_date(req.kind, source.provider_id(), req.due_date.as_deref())?;

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
    } else {
        // REVIEW FINDING 3 (self-converge): no row under the requested_at-
        // scoped key, but a crash before the response was recorded,
        // followed by a restart, can leave an orphaned pending/
        // pending_verify row under a DIFFERENT key for the SAME logical
        // write — the write queue is session-only, so a re-approval after
        // restart mints a brand new `requested_at`. Without this recovery
        // step, `dedup_key` alone could never find that orphaned row, and
        // this would fall straight through to a blind resend — exactly the
        // double-post risk the pending/pending_verify verification exists
        // to close, just reopened by the new requested_at breaking the
        // exact-key lookup. Deliberately does NOT match `sent` rows (see
        // `outbound_find_recovery_candidate`'s doc comment): an intentional
        // repeat of already-delivered content must still send under its
        // own new key, not be silently matched against a past delivery.
        let recovery = store
            .outbound_find_recovery_candidate(source.provider_id(), &content_shape_key(req))
            .map_err(|_| CrmWriteError::InvalidInput("ledger read failed"))?;
        // Codex round 3 (self-converge): only trust a recovery candidate
        // that's RECENT in real wall-clock time — bounded by the same
        // RECOVERY_WINDOW_MINUTES used elsewhere for "how long after a
        // write attempt can its CRM record legitimately appear". Without
        // this bound, an old orphaned pending/pending_verify row (left
        // behind by a PAST ambiguous send that was simply never resolved,
        // not a recent crash) could match a much-later INTENTIONAL repeat
        // of the same content (e.g. a weekly "left voicemail" note) — the
        // exact scenario ADDED SCOPE #2.1's requested_at was added to
        // protect. Outside the window, treat this as if no candidate
        // existed at all, so the intentional repeat sends fresh. Anchored
        // to real time (not req.requested_at, a caller-supplied value) —
        // this is a "was this a recent crash" check, not a
        // content/approval-identity check.
        let recovery = recovery.filter(|row| {
            chrono::DateTime::parse_from_rfc3339(&row.created_at)
                .map(|t| {
                    let age = chrono::Utc::now().signed_duration_since(t.with_timezone(&chrono::Utc));
                    age >= chrono::Duration::zero()
                        && age <= chrono::Duration::minutes(RECOVERY_WINDOW_MINUTES)
                })
                .unwrap_or(false)
        });
        if let Some(row) = recovery {
            let not_before = chrono::DateTime::parse_from_rfc3339(&row.created_at)
                .map(|t| t.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::DateTime::<chrono::Utc>::from_timestamp(0, 0).unwrap());
            match source.find_recent_matching(req, not_before).await {
                Ok(Some(remote_id)) => {
                    // Landed under the interrupted attempt — record it under
                    // THIS (new) key too, so a future retry under the same
                    // requested_at hits the ordinary sent-row fast path.
                    upsert_ledger(store, &key, source, req, "sent", Some(&remote_id));
                    return Ok(WriteReceipt { remote_id, deduped: true });
                }
                Ok(None) => {
                    // Provably didn't land under the interrupted attempt —
                    // retire the OLD candidate row (mark it `failed`, a
                    // terminal state excluded from future content-key
                    // lookups) before falling through to a fresh send.
                    // Codex round 4 (self-converge): without this, the row
                    // stays `pending`/`pending_verify` and, if a LATER
                    // intentional repeat lands within the recovery window,
                    // it could match the record THIS send is about to
                    // create — incorrectly deduping the later repeat
                    // against a delivery it had nothing to do with.
                    upsert_ledger(store, &row.dedup_key, source, req, "failed", None);
                }
                Err(e) => {
                    // Codex round 3: re-affirm the ORIGINAL candidate row
                    // (its own dedup_key), not a new row under `key` — a
                    // fresh insert under `key` would get created_at = now,
                    // losing the original attempt's floor. A future retry
                    // (same requested_at) would then use `now` as the
                    // not_before floor and could miss the actual CRM record
                    // (created before `now`), causing a duplicate resend.
                    // Re-affirming the existing row instead preserves its
                    // original created_at (reset_created_at=false).
                    upsert_ledger(store, &row.dedup_key, source, req, "pending_verify", None);
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

/// Stable, `requested_at`-INDEPENDENT identity for a write's CONTENT (not
/// the approval event) — used ONLY for crash-recovery lookups (see
/// `push_crm_write`'s content-key recovery step). Unlike `dedup_key`, which
/// purposely changes with each new `requested_at` (so an intentional
/// repeat isn't silently suppressed), this stays constant across a
/// crash-and-re-approve of the SAME logical write. The write queue is
/// session-only, so after a restart a re-approval mints a brand new
/// `requested_at` — `dedup_key` alone can then no longer find the
/// interrupted attempt's `pending`/`pending_verify` row, which would
/// otherwise mean a blind resend with no idempotency protection at all.
fn content_shape_key(req: &CrmWriteRequest) -> String {
    let mut h = Sha256::new();
    for part in [
        req.kind.as_str(),
        &req.household_key,
        &norm(&req.title),
        &norm(&req.body),
        req.due_date.as_deref().unwrap_or(""),
        // Include the provenance line (Codex review): it's part of the actual
        // CRM-visible note content now, so two approvals with identical
        // title/body but different provenance are DIFFERENT content and must
        // not share a recovery group — otherwise recovering one could mark the
        // other failed and let a later retry post a duplicate.
        req.provenance.as_deref().unwrap_or(""),
    ] {
        h.update(part.as_bytes());
        h.update([0u8]);
    }
    hex::encode(h.finalize())
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
        &content_shape_key(req),
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
            &content_shape_key(req),
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
///
/// The OTHER thing that needs protecting: an HTTP 200 from `update_field` is
/// not proof the write actually applied (Finding 2,
/// docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md — Wealthbox returned 200
/// while silently leaving a field unchanged under the wrong wire key). After
/// a successful `update_field`, this re-reads the field and only marks
/// `sent` if the live value now matches `final_value`; a mismatch is a real,
/// typed [`CrmWriteError::WriteNotApplied`], never a silent success.
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

    // Codex round 1 (self-converge): a field update is a PUT — cheap and
    // idempotent to check/repeat — so EVERY attempt (fresh, retry, or a
    // re-approval of an unchanged blend) re-checks the LIVE value first,
    // rather than trusting a local ledger `sent` row blind. Without this, a
    // `sent` row whose value was later changed OUTSIDE the app (or by
    // someone else) would make a re-approval of the identical final_value
    // report success while leaving the CRM unchanged.
    // Codex round 2 (self-converge): EXACT comparison here, not `norm()` —
    // `norm()` collapses whitespace/paragraph breaks, which is right for
    // dedup/search matching but wrong for a narrative field's actual
    // content. Formatting (blank lines between paragraphs, etc.) is part of
    // what the user approved; `norm()`-equal-but-not-identical would either
    // silently skip sending the user's approved formatting (the success
    // check) or fail to notice a genuine drift (the stale-guard).
    let current_value = source.get_contact_field(&req.household_key, &req.field).await?;
    if current_value == req.final_value {
        // Already applied — whether this exact write already landed (a
        // prior attempt whose response was ambiguous, or a genuine retry),
        // or nothing needs to change. Confirm success rather than
        // re-issuing the PUT or (wrongly) rejecting this as stale just
        // because it no longer matches existing_value.
        upsert_ledger_field(store, &key, source, req, "sent", Some(&req.household_key));
        return Ok(WriteReceipt { remote_id: req.household_key.clone(), deduped: true });
    }
    if current_value != req.existing_value {
        upsert_ledger_field(store, &key, source, req, "pending_verify", None);
        return Err(CrmWriteError::StaleFieldValue(current_value));
    }

    upsert_ledger_field_before_send(store, &key, source, req)?;

    match source.update_field(req).await {
        Ok(remote_id) => {
            // Readback verification (Finding 2, docs/evidence/windows-smoke-2/
            // WEALTHBOX-PROBE.md): an HTTP 200 from `update_field` is NOT
            // proof the CRM actually applied the write — Wealthbox's real API
            // returned 200 while silently leaving `background_information`
            // unchanged when the wrong wire key was used. Re-fetch the field
            // and confirm it now matches `final_value` before ever marking
            // this `sent`. This is deliberately generic (not
            // background_information-specific): it catches the entire
            // "200-but-ignored" bug class for ANY writable field, on this
            // provider or a future one, not just the one bug this probe found.
            match source.get_contact_field(&req.household_key, &req.field).await {
                Ok(applied)
                    if normalize_for_readback_compare(&applied)
                        == normalize_for_readback_compare(&req.final_value) =>
                {
                    upsert_ledger_field(store, &key, source, req, "sent", Some(&remote_id));
                    Ok(WriteReceipt { remote_id, deduped: false })
                }
                Ok(_) => {
                    // The CRM accepted the write and returned success, but
                    // the field genuinely did not change — a real, silent
                    // no-op. Never recorded as `sent`: an advisor seeing
                    // "done" while the CRM record is untouched is worse than
                    // a visible, actionable error.
                    upsert_ledger_field(store, &key, source, req, "failed", None);
                    Err(CrmWriteError::WriteNotApplied)
                }
                Err(_) => {
                    // The write itself may well have landed — only the
                    // CONFIRMATION read failed (a transient GET failure right
                    // after a successful PUT). Ambiguous, not a definite
                    // failure: re-affirm pending_verify AND surface it as
                    // `VerifyPending` specifically (codex-review catch,
                    // round 1) — the command wrapper's audit trail only
                    // special-cases `VerifyPending` to record a "may have
                    // been applied, unconfirmed" entry; propagating the raw
                    // read error here would fall through its catch-all and
                    // silently skip that audit for a write that may have
                    // genuinely landed.
                    upsert_ledger_field(store, &key, source, req, "pending_verify", None);
                    Err(CrmWriteError::VerifyPending)
                }
            }
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
        // A field update's dedup_key IS its content shape (no requested_at
        // in the formula — see CrmFieldUpdateRequest's doc comment), so
        // there's no separate crash-recovery identity needed here.
        key,
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
            key,
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

/// Maps the app-facing field name (the allowlist/review-UI name) to the WIRE
/// field name Wealthbox's REST API uses when READING a contact record (`GET
/// /contacts/{id}`). Codex round 6 (self-converge): the live API returns
/// `background_information` as `background_info` — already confirmed and
/// handled on the READ side via `CrmContact`'s serde alias (see
/// `model.rs`'s `background_info_alias_populates_background_information`
/// test) — but `get_contact_field` talks to the raw JSON directly (no serde
/// struct), so without this mapping the stale-guard's GET would read an
/// empty string for every real contact (the key literally isn't present
/// under the app-facing name).
///
/// DELIBERATELY SEPARATE from [`wealthbox_write_field_name`] — see that
/// function's doc comment for why reusing one mapping for both directions
/// was a live, confirmed bug (docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md
/// Finding 2).
fn wealthbox_read_field_name(app_field: &str) -> &str {
    match app_field {
        "background_information" => "background_info",
        other => other,
    }
}

/// Maps the app-facing field name to the WIRE field name Wealthbox's REST
/// API wants when WRITING a contact record (`PUT /contacts/{id}`).
///
/// Confirmed live (docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md Finding
/// 2) that this is NOT the same mapping as the read side: `PUT
/// /contacts/{id}` with `{"background_info": ...}` returns HTTP 200 but
/// silently leaves the field unchanged (`updated_at` doesn't move either —
/// not a caching artifact, confirmed on both a Household and its underlying
/// Person record). Only the LITERAL app-facing name
/// (`background_information`) actually applies the write. The original bug
/// was reusing `wealthbox_read_field_name`'s translation for writes too — a
/// 200-but-ignored response that looked like success. For every currently
/// writable field this happens to be the identity mapping, but it's kept as
/// its own function (not just an alias for the read one) so this exact
/// direction-conflation bug can't silently come back if a future writable
/// field genuinely does need read/write translation.
fn wealthbox_write_field_name(app_field: &str) -> &str {
    app_field
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

/// Reject a Wealthbox task with no due date before any network call — the
/// real API returns HTTP 422 for `POST /tasks` with no `due_date` (confirmed
/// live, see docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md Finding 1).
/// Scoped to (Task, Wealthbox) specifically via `provider_id` (matches
/// `CrmWriteSource::provider_id`/`CrmProvider::id`, e.g. `"wealthbox"`):
/// notes have no due date, and other providers aren't live yet and may have
/// different real constraints. Deliberately never defaults a date — that
/// would invent advisor data the user never provided; the caller must ask
/// for one instead.
pub fn validate_task_due_date(
    kind: CrmWriteKind,
    provider_id: &str,
    due_date: Option<&str>,
) -> Result<(), CrmWriteError> {
    if kind != CrmWriteKind::Task || provider_id != "wealthbox" {
        return Ok(());
    }
    match due_date.map(str::trim) {
        Some(d) if !d.is_empty() => Ok(()),
        _ => Err(CrmWriteError::TaskDueDateRequired),
    }
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

    fn test_network_policy() -> crate::network_policy::NetworkPolicy {
        crate::network_policy::NetworkPolicy::load_from_directory(
            &tempfile::tempdir().unwrap().keep(),
        )
    }

    /// Minimal valid Salesforce token-set JSON — bypasses the
    /// `LANTERN_SALESFORCE_CLIENT_ID` env requirement in `SalesforceClient::new`
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
            test_network_policy(),
        )
        .expect("build test SalesforceClient")
    }

    #[tokio::test]
    async fn redtail_and_salesforce_writes_return_typed_not_supported() {
        // RedtailClient::new() requires LANTERN_REDTAIL_API_KEY (redtail_api_key()),
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

        let policy = test_network_policy();
        let wb = write_client_for(CrmProvider::Wealthbox, "tok".into(), policy.clone()).unwrap();
        assert_eq!(wb.provider_id(), "wealthbox");

        // Redtail/Salesforce's real constructors need LANTERN_REDTAIL_API_KEY /
        // LANTERN_SALESFORCE_CLIENT_ID configured. Whether they ARE configured
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
        match write_client_for(CrmProvider::Redtail, "tok".into(), policy.clone()) {
            Ok(client) => assert_eq!(client.provider_id(), "redtail"),
            Err(e) => assert!(e.to_string().contains("REDTAIL"), "got: {e}"),
        }
        match write_client_for(CrmProvider::Salesforce, "tok".into(), policy) {
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
            .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "pending", None, true, &content_shape_key(&req))
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
            .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "pending", None, true, &content_shape_key(&req))
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

    /// REVIEW FINDING 3 (self-converge, from the integration branch review):
    /// requested_at joining the dedup key (ADDED SCOPE #2.1) broke CRASH
    /// idempotency — the write queue is session-only, so after a crash a
    /// re-approval mints a NEW requested_at, and the OLD pending row (from
    /// the interrupted attempt) becomes unreachable by dedup_key alone. The
    /// content-key recovery lookup must find it anyway and verify against
    /// the CRM before ever blind-resending.
    #[tokio::test]
    async fn crash_then_retry_with_new_requested_at_recovers_via_content_key_when_it_landed() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();

        let mut old_req = note_req();
        old_req.requested_at = "2026-07-01T00:00:00Z".into();
        store
            .outbound_upsert(
                &dedup_key(&old_req), "wealthbox", "note", &old_req.household_key,
                &old_req.matter_id, &old_req.source_ref, "pending", None, true,
                &content_shape_key(&old_req),
            )
            .unwrap();

        let mut new_req = note_req();
        new_req.requested_at = "2026-07-02T00:00:00Z".into();
        assert_ne!(
            dedup_key(&old_req), dedup_key(&new_req),
            "a different requested_at must produce a different exact key (this is the scenario the recovery lookup exists for)"
        );

        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![]),
            find_result: Some("999".into()), // the interrupted attempt actually landed
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let receipt = push_crm_write(&source, &store, &guard, &new_req).await.unwrap();
        assert_eq!(receipt.remote_id, "999");
        assert!(receipt.deduped);
        assert_eq!(
            source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 0,
            "must never blind-resend when the interrupted attempt actually landed"
        );

        let row = store.outbound_get(&dedup_key(&new_req)).unwrap().unwrap();
        assert_eq!(row.status, "sent", "the NEW key must also be recorded as sent, so a future retry under the SAME new requested_at hits the ordinary fast path");
        assert_eq!(row.remote_id.as_deref(), Some("999"));
    }

    #[tokio::test]
    async fn crash_then_retry_sends_fresh_when_the_interrupted_attempt_never_landed() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();

        let mut old_req = note_req();
        old_req.requested_at = "2026-07-01T00:00:00Z".into();
        store
            .outbound_upsert(
                &dedup_key(&old_req), "wealthbox", "note", &old_req.household_key,
                &old_req.matter_id, &old_req.source_ref, "pending", None, true,
                &content_shape_key(&old_req),
            )
            .unwrap();

        let mut new_req = note_req();
        new_req.requested_at = "2026-07-02T00:00:00Z".into();

        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![Ok("1000".into())]),
            find_result: None, // provably didn't land under the interrupted attempt
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let receipt = push_crm_write(&source, &store, &guard, &new_req).await.unwrap();
        assert_eq!(receipt.remote_id, "1000");
        assert!(!receipt.deduped);
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 1);

        let row = store.outbound_get(&dedup_key(&new_req)).unwrap().unwrap();
        assert_eq!(row.status, "sent");

        // Codex round 4 finding #2 (self-converge): the OLD candidate row
        // must be retired (marked failed), not left pending/pending_verify
        // — otherwise a LATER intentional repeat within the recovery
        // window could match the record THIS send just created.
        let old_row = store.outbound_get(&dedup_key(&old_req)).unwrap().unwrap();
        assert_eq!(
            old_row.status, "failed",
            "a verified miss must retire the old candidate row so it can't satisfy a future unrelated approval"
        );
    }

    /// Regression guard for ADDED SCOPE #2.1: an intentional repeat (a
    /// genuinely NEW approval of identical content, e.g. a recurring "left
    /// voicemail" note) must still send under its own new key — the
    /// content-key recovery lookup must NOT match a `sent` row from a past
    /// approval, only `pending`/`pending_verify` ones.
    #[tokio::test]
    async fn intentional_repeat_of_already_sent_content_still_sends_under_its_own_new_key() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();

        let mut old_req = note_req();
        old_req.requested_at = "2026-07-01T00:00:00Z".into();
        store
            .outbound_upsert(
                &dedup_key(&old_req), "wealthbox", "note", &old_req.household_key,
                &old_req.matter_id, &old_req.source_ref, "sent", Some("111"), true,
                &content_shape_key(&old_req),
            )
            .unwrap();

        let mut new_req = note_req();
        new_req.requested_at = "2026-07-02T00:00:00Z".into(); // a genuinely new approval

        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![Ok("222".into())]),
            find_result: None,
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let receipt = push_crm_write(&source, &store, &guard, &new_req).await.unwrap();
        assert_eq!(receipt.remote_id, "222");
        assert!(!receipt.deduped);
        assert_eq!(
            source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 1,
            "an intentional repeat must still send under its own new key, not be silently matched against a past SENT row"
        );
    }

    /// Codex round 3 (self-converge): a much-OLDER orphaned pending_verify
    /// row (never resolved, NOT a recent crash) must not be treated as a
    /// crash-recovery candidate for a later intentional repeat — this is
    /// the pending/pending_verify counterpart to the `sent`-row guard above.
    /// Without the recovery-window bound, this old row would silently
    /// suppress the new (intentional) approval entirely.
    #[tokio::test]
    async fn a_much_older_orphaned_pending_row_does_not_swallow_a_later_intentional_repeat() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();

        let mut old_req = note_req();
        old_req.requested_at = "2026-07-01T00:00:00Z".into();
        let old_key = dedup_key(&old_req);
        store
            .outbound_upsert(
                &old_key, "wealthbox", "note", &old_req.household_key,
                &old_req.matter_id, &old_req.source_ref, "pending_verify", None, true,
                &content_shape_key(&old_req),
            )
            .unwrap();
        // Backdate it well outside RECOVERY_WINDOW_MINUTES (30) — simulating
        // a long-forgotten ambiguous send, not a just-happened crash.
        let far_past = (chrono::Utc::now() - chrono::Duration::days(7)).to_rfc3339();
        store.outbound_backdate_for_test(&old_key, &far_past).unwrap();

        let mut new_req = note_req();
        new_req.requested_at = "2026-07-08T00:00:00Z".into(); // a genuinely new approval, a week later

        let source = FakeWriteSource {
            create_results: std::sync::Mutex::new(vec![Ok("333".into())]),
            // If the old row WERE (wrongly) treated as a recovery candidate,
            // this would report it as already delivered — the test fails
            // loudly (deduped=true, create_calls=0) if that guard is missing.
            find_result: Some("999-should-not-be-used".into()),
            create_calls: std::sync::atomic::AtomicUsize::new(0),
        };
        let receipt = push_crm_write(&source, &store, &guard, &new_req).await.unwrap();
        assert_eq!(receipt.remote_id, "333");
        assert!(!receipt.deduped);
        assert_eq!(
            source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 1,
            "an old orphaned pending_verify row must not swallow a much-later intentional repeat"
        );
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
            .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "pending_verify", None, true, &content_shape_key(&req))
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

    /// Codex round 3 finding #2 (self-converge): when the CONTENT-KEY
    /// recovery check itself is ambiguous, the ORIGINAL candidate row's
    /// created_at must be preserved (re-affirmed in place), not shadowed by
    /// a fresh row under the new key stamped with "now" — a fresh "now"
    /// floor would make the NEXT retry's find_recent_matching potentially
    /// miss a CRM record actually created by the original interrupted
    /// attempt (which predates "now"), risking a duplicate resend.
    #[tokio::test]
    async fn content_key_recovery_failure_preserves_the_original_rows_timestamp() {
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
                unimplemented!()
            }
            async fn get_contact_field(&self, _household_key: &str, _field: &str) -> Result<String, CrmWriteError> {
                unimplemented!()
            }
        }

        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();

        let mut old_req = note_req();
        old_req.requested_at = "2026-07-01T00:00:00Z".into();
        let old_key = dedup_key(&old_req);
        store
            .outbound_upsert(
                &old_key, "wealthbox", "note", &old_req.household_key,
                &old_req.matter_id, &old_req.source_ref, "pending_verify", None, true,
                &content_shape_key(&old_req),
            )
            .unwrap();
        // A recent, VALID recovery candidate — 10 minutes ago, well inside
        // RECOVERY_WINDOW_MINUTES (30).
        let original_created_at = (chrono::Utc::now() - chrono::Duration::minutes(10)).to_rfc3339();
        store.outbound_backdate_for_test(&old_key, &original_created_at).unwrap();

        let mut new_req = note_req();
        new_req.requested_at = "2026-07-01T00:05:00Z".into(); // e.g. a restart 5 minutes after the crash
        let new_key = dedup_key(&new_req);

        let source = FlakyFindSource { create_calls: std::sync::atomic::AtomicUsize::new(0) };
        let result = push_crm_write(&source, &store, &guard, &new_req).await;
        assert!(matches!(result, Err(CrmWriteError::VerifyPending)));
        assert_eq!(source.create_calls.load(std::sync::atomic::Ordering::SeqCst), 0);

        let old_row = store.outbound_get(&old_key).unwrap().unwrap();
        assert_eq!(
            old_row.created_at, original_created_at,
            "the original candidate row's created_at must be preserved, not reset to 'now'"
        );
        assert_eq!(old_row.status, "pending_verify");
        assert!(
            store.outbound_get(&new_key).unwrap().is_none(),
            "no NEW row should be created under the new key — the original row is re-affirmed in place instead"
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
                .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "sent", Some("old-id"), true, &content_shape_key(&req))
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
                .outbound_upsert(&dedup_key(&req), "wealthbox", "note", &req.household_key, &req.matter_id, &req.source_ref, "sent", Some("old-id"), true, &content_shape_key(&req))
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
            provenance: None,
        }
    }

    // E3 (Tier B trust guard): an AI-drafted note's provenance line must
    // travel with the content that reaches the CRM. `note_content` is the
    // single builder create_note uses, so testing it proves the wire shape.
    #[test]
    fn note_content_appends_provenance_for_ai_drafted_notes() {
        let mut req = note_req();
        req.provenance = Some(
            "Drafted by Advisor Prep Hero AI from the Jul 2, 2026 meeting; approved by Dana Lee on Jul 4, 2026.".into(),
        );
        let content = note_content(&req);
        assert!(content.starts_with("Q3 review follow-up\n\nDiscussed 529 rollover."));
        assert!(content.contains("Drafted by Advisor Prep Hero AI from the Jul 2, 2026 meeting"));
        assert!(content.contains("approved by Dana Lee on Jul 4, 2026."));
    }

    #[test]
    fn note_content_omits_provenance_when_absent_or_blank() {
        let plain = note_content(&note_req());
        assert_eq!(plain, "Q3 review follow-up\n\nDiscussed 529 rollover.");
        let mut blank = note_req();
        blank.provenance = Some("   ".into());
        assert_eq!(note_content(&blank), plain);
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
            requested_at: "2026-07-02T14:41:00Z".into(),
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

    /// Codex round 4 finding #3 (self-converge): push_crm_field_update
    /// compares live values EXACTLY (formatting is part of what the user
    /// approved), so the dedup key must distinguish formatting-only
    /// differences too — otherwise a formatting-only re-approval collides
    /// into the SAME ledger row/audit id as an earlier one, silently
    /// losing its own audit entry.
    #[test]
    fn field_dedup_key_distinguishes_formatting_only_differences() {
        let a = base_field_req();
        let mut b = base_field_req();
        b.final_value = format!("{}\n", a.final_value); // trailing newline only
        assert_ne!(
            dedup_key_field(&a), dedup_key_field(&b),
            "formatting-only differences (e.g. a trailing newline) must produce distinct keys"
        );
    }

    #[test]
    fn wealthbox_read_field_name_maps_the_only_writable_field() {
        assert_eq!(wealthbox_read_field_name("background_information"), "background_info");
        assert_eq!(wealthbox_read_field_name("something_else"), "something_else");
    }

    /// TDD regression for Wealthbox probe Finding 2
    /// (docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md): writes must use
    /// the LITERAL app-facing name, deliberately NOT the read-side
    /// translation — `wealthbox_read_field_name` would (wrongly) translate
    /// this to `background_info`, which the live API accepts with HTTP 200
    /// but silently ignores.
    #[test]
    fn wealthbox_write_field_name_is_the_identity_not_the_read_translation() {
        assert_eq!(wealthbox_write_field_name("background_information"), "background_information");
        assert_ne!(wealthbox_write_field_name("background_information"), wealthbox_read_field_name("background_information"));
    }

    #[tokio::test]
    async fn wealthbox_update_field_puts_exact_shape() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        // Confirmed live (Finding 2): PUT /contacts/{id} wants the LITERAL
        // app-facing key (background_information), NOT the read-side wire
        // name (background_info) — see wealthbox_write_field_name's doc
        // comment. Sending the read-side name here returns 200 but silently
        // leaves the field unchanged.
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

    /// TDD regression for Wealthbox probe Finding 2 — the exact live bug
    /// shape: a server that accepts the WRONG wire key (`background_info`)
    /// with HTTP 200 but echoes back the OLD value (a faithful mock of what
    /// the real sandbox did), while the CORRECT key
    /// (`background_information`) actually applies the write. Runs the full
    /// `push_crm_field_update` orchestration (not just the client method) to
    /// prove the write-path fix AND the readback-verification mechanism
    /// both work together end-to-end against a real HTTP mock.
    #[tokio::test]
    async fn push_crm_field_update_uses_the_literal_write_key_against_a_server_that_ignores_the_read_key() {
        use wiremock::{matchers, Mock, MockServer, Respond, ResponseTemplate};
        let server = MockServer::start().await;
        let stored = std::sync::Arc::new(std::sync::Mutex::new("Existing background.".to_string()));

        // GET always returns whatever is currently "stored", under the read-side wire name.
        struct GetStored(std::sync::Arc<std::sync::Mutex<String>>);
        impl Respond for GetStored {
            fn respond(&self, _: &wiremock::Request) -> ResponseTemplate {
                ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "id": 12345,
                    "background_info": self.0.lock().unwrap().clone(),
                }))
            }
        }

        // Matches Wealthbox's real (confirmed live) behavior: 200 OK either
        // way, but ONLY the literal `background_information` key actually
        // moves `stored` — a PUT under the read-side wire name
        // (`background_info`) is accepted and silently ignored, exactly
        // Finding 2. If the code under test ever regresses to sending the
        // read-side key, `stored` stays at its old value and the assertion
        // below (final == req.final_value) fails.
        struct PutOnlyAppliesLiteralKey(std::sync::Arc<std::sync::Mutex<String>>);
        impl Respond for PutOnlyAppliesLiteralKey {
            fn respond(&self, req: &wiremock::Request) -> ResponseTemplate {
                let body: serde_json::Value = req.body_json().unwrap();
                if let Some(v) = body.get("background_information").and_then(|v| v.as_str()) {
                    *self.0.lock().unwrap() = v.to_string();
                }
                ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 12345}))
            }
        }

        Mock::given(matchers::method("GET"))
            .and(matchers::path("/contacts/12345"))
            .respond_with(GetStored(stored.clone()))
            .mount(&server)
            .await;
        Mock::given(matchers::method("PUT"))
            .and(matchers::path("/contacts/12345"))
            .respond_with(PutOnlyAppliesLiteralKey(stored.clone()))
            .mount(&server)
            .await;

        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let req = base_field_req();

        let receipt = push_crm_field_update(&client, &store, &guard, &req).await.unwrap();
        assert_eq!(receipt.remote_id, "12345");
        assert_eq!(*stored.lock().unwrap(), req.final_value, "the field must have actually changed on the (mock) server");

        let row = store.outbound_get(&dedup_key_field(&req)).unwrap().unwrap();
        assert_eq!(row.status, "sent");
    }

    /// Codex round 6 (self-converge): get_contact_field must read the WIRE
    /// name (background_info), matching CrmContact's own confirmed serde
    /// alias for this exact field (model.rs) — reading the app-facing name
    /// directly off the raw JSON would return empty for every real contact.
    #[tokio::test]
    async fn wealthbox_get_contact_field_reads_the_wire_name() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("GET"))
            .and(matchers::path("/contacts/12345"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": 12345,
                "background_info": "Existing background."
            })))
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let value = client.get_contact_field("12345", "background_information").await.unwrap();
        assert_eq!(value, "Existing background.");
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

    #[test]
    fn validate_task_due_date_requires_a_date_for_wealthbox_tasks_only() {
        // The one case it must actually block: a Wealthbox task with no date.
        assert!(matches!(
            validate_task_due_date(CrmWriteKind::Task, "wealthbox", None),
            Err(CrmWriteError::TaskDueDateRequired)
        ));
        assert!(matches!(
            validate_task_due_date(CrmWriteKind::Task, "wealthbox", Some("")),
            Err(CrmWriteError::TaskDueDateRequired)
        ));
        assert!(matches!(
            validate_task_due_date(CrmWriteKind::Task, "wealthbox", Some("   ")),
            Err(CrmWriteError::TaskDueDateRequired)
        ));
        assert_eq!(
            validate_task_due_date(CrmWriteKind::Task, "wealthbox", None).unwrap_err().to_string(),
            "Wealthbox tasks need a due date"
        );

        // A real date passes.
        assert!(validate_task_due_date(CrmWriteKind::Task, "wealthbox", Some("2026-07-15")).is_ok());

        // Notes have no due date at all — never gated by this rule.
        assert!(validate_task_due_date(CrmWriteKind::Note, "wealthbox", None).is_ok());

        // Other providers aren't live yet and may have different real
        // constraints — this rule is scoped to Wealthbox specifically, not a
        // blanket "tasks always need a date".
        assert!(validate_task_due_date(CrmWriteKind::Task, "redtail", None).is_ok());
        assert!(validate_task_due_date(CrmWriteKind::Task, "salesforce", None).is_ok());
    }

    /// TDD regression for Wealthbox probe Finding 1 (HTTP 422 on a
    /// due-date-less task, docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md):
    /// `push_crm_write` — the one orchestration path every real
    /// proposal-approved task write and every other write test in this module goes
    /// through — must reject before ever reaching the network. `.expect(0)`
    /// makes wiremock itself fail the test if `POST /tasks` is ever hit.
    #[tokio::test]
    async fn push_crm_write_rejects_task_with_no_due_date_before_any_network_call() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/tasks"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 999})))
            .expect(0)
            .mount(&server)
            .await;

        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let mut req = task_req();
        req.due_date = None;

        let err = push_crm_write(&client, &store, &guard, &req).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::TaskDueDateRequired));

        // No ledger row either — a rejected request was never even attempted.
        assert!(store.outbound_get(&dedup_key(&req)).unwrap().is_none());
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

    /// Codex round 6 finding #3 (self-converge): incidental whitespace
    /// around requested_at (harmless per validate_requested_at, which
    /// trims before parsing) must not produce a different dedup key — a
    /// retry of the SAME approval with a whitespace-padded requested_at
    /// would otherwise miss its own pending/sent row.
    #[test]
    fn dedup_key_trims_requested_at_before_hashing() {
        let a = note_req();
        let mut b = note_req();
        b.requested_at = format!("  {}  ", a.requested_at);
        assert_eq!(dedup_key(&a), dedup_key(&b));
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

    /// Codex round 6 (self-converge): unlike other errors, StaleFieldValue
    /// DELIBERATELY embeds the current value — the review card needs it to
    /// re-render the 3 columns with the fresh CRM value. This is the
    /// advisor's own field they're already reviewing, not unrelated raw
    /// response-body data, so the PII discipline that keeps bodies out of
    /// other errors doesn't apply here.
    #[test]
    fn stale_field_value_display_includes_the_current_value() {
        let e = CrmWriteError::StaleFieldValue("Someone else's edit.".into());
        assert!(e.to_string().contains("Someone else's edit."));
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
        /// When true, a successful `update_field` does NOT actually move
        /// `remote_value` — simulates a real "200 OK but silently ignored"
        /// CRM response (Finding 2), so the readback verification GET
        /// afterward sees the OLD value.
        silently_ignores_write: bool,
        /// When true, the SECOND `get_contact_field` call (the post-write
        /// readback, not the pre-write stale-guard check) fails — simulates
        /// a transient GET failure right after a successful PUT.
        fail_readback_get: bool,
        /// When true, the readback GET echoes `remote_value` with LF line
        /// endings converted to CRLF plus a trailing newline appended —
        /// simulates a CRM that normalizes stored text even on a write that
        /// genuinely applied.
        readback_normalizes_line_endings: bool,
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
        async fn update_field(&self, r: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError> {
            self.update_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let result = self.update_results.lock().unwrap().remove(0);
            if result.is_ok() && !self.silently_ignores_write {
                // Mirror a real CRM: after a successful PUT, the field
                // actually holds the new value — later get_contact_field
                // calls in the same test must see it.
                *self.remote_value.lock().unwrap() = r.final_value.clone();
            }
            result
        }
        async fn get_contact_field(&self, _household_key: &str, _field: &str) -> Result<String, CrmWriteError> {
            let call_number = self.get_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            if self.fail_readback_get && call_number == 2 {
                return Err(CrmWriteError::ReadFailed);
            }
            let value = self.remote_value.lock().unwrap().clone();
            if self.readback_normalizes_line_endings && call_number == 2 {
                return Ok(format!("{}\n", value.replace('\n', "\r\n")));
            }
            Ok(value)
        }
    }

    fn fake_field_source(remote_value: &str, update_result: Result<String, CrmWriteError>) -> FakeFieldSource {
        FakeFieldSource {
            remote_value: std::sync::Mutex::new(remote_value.into()),
            update_results: std::sync::Mutex::new(vec![update_result]),
            update_calls: std::sync::atomic::AtomicUsize::new(0),
            get_calls: std::sync::atomic::AtomicUsize::new(0),
            silently_ignores_write: false,
            fail_readback_get: false,
            readback_normalizes_line_endings: false,
        }
    }

    fn fake_field_source_that_silently_ignores_writes(remote_value: &str, update_result: Result<String, CrmWriteError>) -> FakeFieldSource {
        FakeFieldSource {
            remote_value: std::sync::Mutex::new(remote_value.into()),
            update_results: std::sync::Mutex::new(vec![update_result]),
            update_calls: std::sync::atomic::AtomicUsize::new(0),
            get_calls: std::sync::atomic::AtomicUsize::new(0),
            silently_ignores_write: true,
            fail_readback_get: false,
            readback_normalizes_line_endings: false,
        }
    }

    fn fake_field_source_with_failing_readback(remote_value: &str, update_result: Result<String, CrmWriteError>) -> FakeFieldSource {
        FakeFieldSource {
            remote_value: std::sync::Mutex::new(remote_value.into()),
            update_results: std::sync::Mutex::new(vec![update_result]),
            update_calls: std::sync::atomic::AtomicUsize::new(0),
            get_calls: std::sync::atomic::AtomicUsize::new(0),
            silently_ignores_write: false,
            fail_readback_get: true,
            readback_normalizes_line_endings: false,
        }
    }

    fn fake_field_source_with_crlf_normalizing_readback(remote_value: &str, update_result: Result<String, CrmWriteError>) -> FakeFieldSource {
        FakeFieldSource {
            remote_value: std::sync::Mutex::new(remote_value.into()),
            update_results: std::sync::Mutex::new(vec![update_result]),
            update_calls: std::sync::atomic::AtomicUsize::new(0),
            get_calls: std::sync::atomic::AtomicUsize::new(0),
            silently_ignores_write: false,
            fail_readback_get: false,
            readback_normalizes_line_endings: true,
        }
    }

    /// TDD regression for Wealthbox probe Finding 2
    /// (docs/evidence/windows-smoke-2/WEALTHBOX-PROBE.md): the generic
    /// readback-verification mechanism in `push_crm_field_update` must catch
    /// ANY provider's "200 OK but the field didn't actually change" bug, not
    /// just this specific field — surfaced as a real, typed error rather
    /// than a false `sent`.
    #[tokio::test]
    async fn field_update_readback_mismatch_surfaces_as_an_error_not_success() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = fake_field_source_that_silently_ignores_writes("Existing background.", Ok("12345".into()));
        let req = base_field_req();

        let err = push_crm_field_update(&source, &store, &guard, &req).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::WriteNotApplied), "expected WriteNotApplied, got {err:?}");

        // The PUT itself was attempted exactly once (it's not the update
        // that's wrong — it's that its success is unverified), and the
        // ledger must NOT record this as sent.
        assert_eq!(source.update_calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        let row = store.outbound_get(&dedup_key_field(&req)).unwrap().unwrap();
        assert_ne!(row.status, "sent", "a write that didn't actually apply must never be recorded as sent");
    }

    /// Manual-review catch (post codex-review): the readback comparison must
    /// tolerate line-ending normalization a CRM plausibly applies to stored
    /// text (CRLF/CR → LF, trailing whitespace) even when the write
    /// genuinely applied — an EXACT string comparison would misreport this
    /// as `WriteNotApplied` forever, and an advisor would retry against a
    /// write that already succeeded. Genuinely different content (the
    /// sibling test above) must still fail.
    #[tokio::test]
    async fn field_update_readback_tolerates_crm_line_ending_normalization() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = fake_field_source_with_crlf_normalizing_readback("Existing background.", Ok("12345".into()));
        let req = base_field_req();

        let receipt = push_crm_field_update(&source, &store, &guard, &req).await.unwrap();
        assert_eq!(receipt.remote_id, "12345");
        assert!(!receipt.deduped);

        let row = store.outbound_get(&dedup_key_field(&req)).unwrap().unwrap();
        assert_eq!(row.status, "sent", "CRLF + trailing-newline normalization must not be mistaken for a silent no-op");
    }

    #[test]
    fn normalize_for_readback_compare_ignores_line_endings_and_trailing_whitespace_but_not_internal_content() {
        assert_eq!(
            normalize_for_readback_compare("a\r\nb\n\nc"),
            normalize_for_readback_compare("a\nb\n\nc\n")
        );
        // Internal differences (not just line-ending/trailing-whitespace
        // shape) must still be distinguished — this is what catches a real
        // silent no-op (Finding 2).
        assert_ne!(
            normalize_for_readback_compare("Existing background."),
            normalize_for_readback_compare("Existing background.\n\nRetiring spring 2027.")
        );
    }

    /// codex-review round 1 catch: when the PUT succeeds but the CONFIRMATION
    /// read fails (a transient GET failure right after a successful write —
    /// genuinely ambiguous, not a definite failure), this must surface as
    /// `VerifyPending` specifically. The field approval command wrapper
    /// (commands.rs) only special-cases `VerifyPending` to record a "may have
    /// been applied, unconfirmed" audit entry; any other error type falls
    /// through its catch-all and silently skips that audit for a write that
    /// may have genuinely landed.
    #[tokio::test]
    async fn field_update_readback_failure_after_a_successful_write_is_verify_pending() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = fake_field_source_with_failing_readback("Existing background.", Ok("12345".into()));
        let req = base_field_req();

        let err = push_crm_field_update(&source, &store, &guard, &req).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::VerifyPending), "expected VerifyPending, got {err:?}");

        let row = store.outbound_get(&dedup_key_field(&req)).unwrap().unwrap();
        assert_eq!(row.status, "pending_verify");
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
        // 2 GETs: the stale-guard's pre-write check, then the post-write
        // readback verification that confirms the PUT actually applied.
        assert_eq!(source.get_calls.load(std::sync::atomic::Ordering::SeqCst), 2);
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

    /// Codex round 1 finding #2 (self-converge): a PUT whose response was
    /// ambiguous (VerifyPending) but that actually reached Wealthbox must
    /// be recognized as SUCCESS on a retry — the live value now equals
    /// final_value, not existing_value, so this must not be misreported as
    /// StaleFieldValue just because it no longer matches existing_value.
    #[tokio::test]
    async fn field_update_retry_recognizes_an_ambiguous_attempt_that_actually_landed() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let req = base_field_req();

        // The live value is ALREADY final_value — as if the first PUT
        // landed server-side even though its response was lost/ambiguous.
        let source = fake_field_source(&req.final_value, Ok("should-not-be-used".into()));

        let receipt = push_crm_field_update(&source, &store, &guard, &req).await.unwrap();
        assert_eq!(receipt.remote_id, req.household_key);
        assert!(receipt.deduped);
        assert_eq!(
            source.update_calls.load(std::sync::atomic::Ordering::SeqCst), 0,
            "must not re-PUT when the live value already equals final_value"
        );

        let row = store.outbound_get(&dedup_key_field(&req)).unwrap().unwrap();
        assert_eq!(row.status, "sent", "an already-landed value must be confirmed sent, not left pending_verify");
    }

    #[tokio::test]
    async fn field_update_second_identical_push_is_deduped_without_a_redundant_write() {
        let (_dir, store) = test_store();
        let guard = WriteInFlightGuard::new();
        let source = fake_field_source("Existing background.", Ok("12345".into()));
        let req = base_field_req();

        push_crm_field_update(&source, &store, &guard, &req).await.unwrap();
        let second = push_crm_field_update(&source, &store, &guard, &req).await.unwrap();

        assert_eq!(second.remote_id, req.household_key);
        assert!(second.deduped);
        // Codex round 1 (self-converge): the second push MUST still
        // re-verify the live value (a cheap GET) before deduping — a `sent`
        // row that's since drifted (e.g. edited outside the app) must not
        // silently report success without actually writing. It must NOT
        // repeat the actual PUT, since the field already holds final_value.
        // 3 GETs total: first push's stale-guard check + its post-write
        // readback verification, then the second push's stale-guard check
        // (which now finds final_value already applied and short-circuits).
        assert_eq!(source.get_calls.load(std::sync::atomic::Ordering::SeqCst), 3);
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

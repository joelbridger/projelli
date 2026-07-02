# Wave 2 — CRM Write-Back (Wealthbox first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Lantern an approval-gated write path into the advisor's CRM — create notes and tasks on the correct Wealthbox household from inside the app — with idempotency, retries, audit provenance, and a provider trait Redtail/Salesforce adopt later.

**Architecture:** A new `write.rs` module in the existing `src-tauri/src/commands/crm/` area adds a `CrmWriteSource` trait beside the read-only `CrmSource`. `WealthboxClient` gains a `post_json` (mirroring its `get_json` discipline: 1 rps gate, 429 backoff, PII-safe logging). A `crm_outbound_writes` ledger table in the existing SQLCipher `CrmStore` makes every push idempotent (content-hash dedup key; ambiguous transport failures go to `pending_verify` and are verified against the CRM before any re-send). Two Tauri commands expose it; the frontend adds a queue store + one review card in the Client Map surface. Writes happen ONLY from the card's Approve button — never in the background.

**Tech Stack:** Rust (reqwest, async-trait, rusqlite/SQLCipher, sha2, wiremock 0.6 for tests — already in `src-tauri/Cargo.toml:185`), TypeScript strict + Zustand + shadcn/ui, Vitest + RTL.

## Global Constraints

(Inherits every rule in `docs/plans/lantern-plus/2026-07-02-MASTER-PLAN.md` — branch `lp/crm-writeback` off `lantern-plus`; `npm run gate` green before merge; never rename `matter`/`matter_id`; no background/silent CRM writes; AI proposes → user approves; audit-log every approved write; no time estimates; light theme; user-facing copy says "client/household", never "matter".)

- **PII discipline (copied from `client.rs` header):** raw HTTP response bodies are NEVER logged or included in error strings — status code + endpoint path only.
- **Command style:** every `#[tauri::command]` returns `Result<T, String>` (see `src-tauri/src/commands/crm/commands.rs:4`).
- **Wealthbox API base:** `https://api.crmworkspace.com/v1`, auth header `ACCESS_TOKEN: <token>` (NOT Bearer), ~1 request/second (`client.rs:35,148`).
- **One cargo compile at a time** on this server (shared `CARGO_TARGET_DIR`).

## VERIFY-LIVE register (Wealthbox specifics not provable from code or local docs)

- *(Task 9c)* Contact field-update endpoint + envelope (assumed `PUT /contacts/{id}` flat body) and the writable narrative-field names (starting set: `background_information`).

The read client parses notes from JSON key `"status_updates"` and `linked_to: [{id, type, name}]` — those are code-verified. The following are from Wealthbox's public API docs and MUST be probed with a real token before release (tag in code comments as `VERIFY-LIVE`):

1. `POST /notes` body shape `{"content": "...", "linked_to": [{"id": <i64>, "type": "Contact"}]}` — especially the `type` casing (`"Contact"` vs `"contact"` vs `"Household"`).
2. `POST /tasks` body shape `{"name","description","due_date","linked_to","priority"}` and the `due_date` string format (docs show e.g. `"2026-07-15 11:00 AM -0400"`).
3. Whether the create response echoes the created object with `id` at the top level.
4. Rate/quota behavior on POSTs (assume same 429 + `Retry-After` as GETs).

A `scripts/crm/wealthbox-write-probe.md` checklist is produced in Task 11 so the live probe is a five-minute job when a token is available.

## File Structure

| File | Responsibility |
|---|---|
| Create `src-tauri/src/commands/crm/write.rs` | `CrmWriteRequest`/`WriteReceipt`/`CrmWriteError` models, dedup-key hashing, `CrmWriteSource` trait, Wealthbox impl, `push_crm_write` orchestrator, Redtail/Salesforce `NotSupported` stubs, `write_client_for` registry |
| Modify `src-tauri/src/commands/crm/client.rs` | add `post_json` + update the "GET only" module header |
| Modify `src-tauri/src/commands/crm/store.rs` | add `crm_outbound_writes` table + ledger methods |
| Modify `src-tauri/src/commands/crm/commands.rs` | add `crm_create_note` / `crm_create_task` commands + matter-scoped audit payload helper |
| Modify `src-tauri/src/commands/crm/mod.rs` | `pub mod write;` |
| Modify `src-tauri/src/lib.rs` (~line 176, the `commands::crm::commands::*` block) | register the two new commands |
| Modify `src/platform/rag/matterResolver.ts` | `buildInverseCrmMap` (matterId → householdIds) |
| Modify `src/platform/utils/wealthbox-commands.ts` | `crmCreateNote` / `crmCreateTask` wrappers |
| Create `src/platform/state/crmWriteQueueStore.ts` | Zustand queue of proposed writes (the API Wave 3 feeds) |
| Create `src/features/matters/CrmWriteReviewCard.tsx` | approval card (tracked-changes-style preview, one Approve) |
| Modify `src/features/matters/ClientMapPanel.tsx` | mount the card beside `ClientMapUpdatesTray` |
| Modify `src/features/matters/MatterNotesEditor.tsx` | "Send to Wealthbox" enqueue action |
| Tests | `src-tauri` unit/wiremock tests in-module; `tests/unit/crmWriteQueue.test.ts`; `src/features/matters/CrmWriteReviewCard.test.tsx`; matterResolver tests extend the existing spec file |

---

### Task 1: Write models, error taxonomy, dedup key

**Files:**
- Create: `src-tauri/src/commands/crm/write.rs`
- Modify: `src-tauri/src/commands/crm/mod.rs` (add `pub mod write;` alongside the existing `pub mod` lines)

**Interfaces:**
- Produces: `CrmWriteKind`, `CrmWriteRequest`, `WriteReceipt`, `CrmWriteError`, `dedup_key(&CrmWriteRequest) -> String` — every later task consumes these exact names.

- [ ] **Step 1: Write the failing tests** (bottom of the new `write.rs`)

```rust
#[cfg(test)]
mod tests {
    use super::*;

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
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test --lib commands::crm::write 2>&1 | tail -5`
Expected: compile error — types not defined.

- [ ] **Step 3: Implement the models**

```rust
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
```

If `thiserror` or `sha2` is missing from `src-tauri/Cargo.toml` dependencies, add the one that is missing (check first — both are commonly already present; `hex` is used by `store.rs` so it exists).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd src-tauri && cargo test --lib commands::crm::write 2>&1 | tail -5`
Expected: `test result: ok. 3 passed`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/crm/write.rs src-tauri/src/commands/crm/mod.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(crm): write-path models, error taxonomy, dedup key"
```

---

### Task 2: `WealthboxClient::post_json`

**Files:**
- Modify: `src-tauri/src/commands/crm/client.rs` (module header lines 1–22 + new method after `get_json`, which ends at line 177)

**Interfaces:**
- Consumes: existing `rate_gate()`, `retry_delay()`, `MAX_429_RETRIES`, `new_with_base` (test constructor).
- Produces: `pub async fn post_json(&self, path: &str, body: &serde_json::Value) -> anyhow::Result<serde_json::Value>` — Task 3 consumes it.

- [ ] **Step 1: Write the failing wiremock tests** (append inside the existing `mod tests`; wiremock needs tokio — mirror how other wiremock tests in the repo set up async tests, `grep -rn "wiremock" src-tauri/src --include=*.rs -l` and copy the pattern from one; if none exist in this crate area, use `#[tokio::test]`)

```rust
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test --lib commands::crm::client 2>&1 | tail -5`
Expected: compile error — `post_json` not found.

- [ ] **Step 3: Implement `post_json`** (after `get_json`; retry ONLY on 429 pre-completion, exactly like `get_json`, because a 429 means the request was rejected, not applied)

```rust
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
            let resp = self
                .http
                .post(&url)
                .header("ACCESS_TOKEN", &self.token)
                .json(body)
                .send()
                .await
                .context("Wealthbox HTTP send")?;
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
            let text = resp.text().await.context("read Wealthbox response body")?;
            if !status.is_success() {
                log::warn!("Wealthbox write failed: HTTP {} at {}", status, path);
                anyhow::bail!("Wealthbox request failed (HTTP {})", status);
            }
            return serde_json::from_str(&text).context("parse Wealthbox JSON response");
        }
        anyhow::bail!("Wealthbox: throttled past retry budget ({} attempts)", MAX_429_RETRIES)
    }
```

Also update the module header (lines 1–4): replace the "**Read-only: GET requests only.**" paragraph with: "GETs for sync; POSTs exist ONLY for the approval-gated write path in `write.rs` — no update/delete anywhere."

- [ ] **Step 4: Run tests to verify pass**

Run: `cd src-tauri && cargo test --lib commands::crm::client 2>&1 | tail -5`
Expected: all client tests pass including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/crm/client.rs
git commit -m "feat(crm): PII-safe post_json on WealthboxClient (429-only retry)"
```

---

### Task 3: `CrmWriteSource` trait + Wealthbox implementation

**Files:**
- Modify: `src-tauri/src/commands/crm/write.rs`

**Interfaces:**
- Consumes: `post_json` (Task 2), `CrmWriteRequest`/`CrmWriteError`/`dedup_key` (Task 1), existing `WealthboxClient::list_notes`/`list_tasks` (`client.rs:275,292`).
- Produces (Tasks 5/6/10 consume):

```rust
#[async_trait::async_trait]
pub trait CrmWriteSource: Send + Sync {
    fn provider_id(&self) -> &'static str;
    async fn create_note(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError>;  // returns remote id
    async fn create_task(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError>;
    /// Look for an already-delivered identical write (recovery after an
    /// ambiguous transport failure). Returns the remote id if found.
    async fn find_recent_matching(&self, req: &CrmWriteRequest) -> Result<Option<String>, CrmWriteError>;
}
```

- [ ] **Step 1: Write the failing wiremock tests** (in `write.rs` tests; reuse `note_req()` from Task 1, add a `task_req()` twin with `kind: CrmWriteKind::Task`, `due_date: Some("2026-07-15".into())`)

```rust
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test --lib commands::crm::write 2>&1 | tail -5`
Expected: compile error — trait/methods not defined.

- [ ] **Step 3: Implement the trait + Wealthbox impl** (in `write.rs`)

```rust
use crate::commands::crm::client::WealthboxClient;

#[async_trait::async_trait]
impl CrmWriteSource for WealthboxClient {
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

    async fn find_recent_matching(&self, req: &CrmWriteRequest) -> Result<Option<String>, CrmWriteError> {
        // Recovery path: list recent objects and match on normalized content.
        // Full-list is acceptable at solo scale; the 1 rps gate bounds cost.
        match req.kind {
            CrmWriteKind::Note => {
                let notes = self.list_notes(None).await.map_err(map_http_err)?;
                let want = norm(&format!("{}\n\n{}", req.title.trim(), req.body.trim()));
                Ok(notes
                    .iter()
                    .find(|n| norm(&n.content) == want)
                    .map(|n| n.id.to_string()))
            }
            CrmWriteKind::Task => {
                let tasks = self.list_tasks(None).await.map_err(map_http_err)?;
                Ok(tasks
                    .iter()
                    .find(|t| norm(&t.name) == norm(req.title.trim()) && norm(&t.description) == norm(req.body.trim()))
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

fn remote_id_from(resp: &serde_json::Value) -> Result<String, CrmWriteError> {
    // VERIFY-LIVE: create responses echo the created object with top-level id.
    resp.get("id")
        .and_then(|v| v.as_i64().map(|n| n.to_string()).or_else(|| v.as_str().map(String::from)))
        .ok_or(CrmWriteError::InvalidInput("create response had no id"))
}
```

(`map_http_err` string-matching mirrors how `get_json` formats its two error shapes — see `client.rs:169,173`. If the implementer prefers a typed error from `post_json` instead, that refactor is allowed as long as all Task 2 tests still pass unchanged.)

- [ ] **Step 4: Run tests to verify pass**

Run: `cd src-tauri && cargo test --lib commands::crm::write 2>&1 | tail -5`
Expected: all write tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/crm/write.rs
git commit -m "feat(crm): CrmWriteSource trait + Wealthbox create_note/create_task"
```

---

### Task 4: Outbound-write ledger in `CrmStore`

**Files:**
- Modify: `src-tauri/src/commands/crm/store.rs` (add the table to the `execute_batch` in `open_with_key`, `store.rs:120-146`, and new methods; copy the test setup pattern from the existing tests at the bottom of `store.rs` — they use a temp dir + `open_with_key` with a literal key)

**Interfaces:**
- Produces (Task 5 consumes):

```rust
pub struct OutboundWrite {
    pub dedup_key: String,
    pub status: String,          // "pending" | "sent" | "pending_verify" | "failed"
    pub remote_id: Option<String>,
}
impl CrmStore {
    pub fn outbound_get(&self, dedup_key: &str) -> Result<Option<OutboundWrite>>;
    pub fn outbound_upsert(&self, dedup_key: &str, provider: &str, kind: &str,
        household_key: &str, matter_id: &str, source_ref: &str, status: &str,
        remote_id: Option<&str>) -> Result<()>;
}
```

- [ ] **Step 1: Write the failing tests** (in `store.rs` `mod tests`, following its existing temp-workspace pattern)

```rust
    #[test]
    fn outbound_ledger_upsert_and_get_roundtrip() {
        let (dir, store) = open_test_store(); // reuse/mirror the existing test helper in this file
        let _ = dir;
        assert!(store.outbound_get("k1").unwrap().is_none());
        store
            .outbound_upsert("k1", "wealthbox", "note", "12345", "m1", "doc:a.docx", "pending", None)
            .unwrap();
        let row = store.outbound_get("k1").unwrap().unwrap();
        assert_eq!(row.status, "pending");
        assert_eq!(row.remote_id, None);
        store
            .outbound_upsert("k1", "wealthbox", "note", "12345", "m1", "doc:a.docx", "sent", Some("555"))
            .unwrap();
        let row = store.outbound_get("k1").unwrap().unwrap();
        assert_eq!(row.status, "sent");
        assert_eq!(row.remote_id.as_deref(), Some("555"));
    }
```

(If no `open_test_store` helper exists, write one exactly like the setup used by the first existing test in the file — temp dir + literal 32-byte key via `open_with_key`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test --lib commands::crm::store::tests::outbound 2>&1 | tail -5`
Expected: compile error — methods not defined.

- [ ] **Step 3: Implement.** Add to the `execute_batch` string in `open_with_key`:

```sql
             CREATE TABLE IF NOT EXISTS crm_outbound_writes (
               dedup_key     TEXT PRIMARY KEY,
               provider      TEXT NOT NULL,
               kind          TEXT NOT NULL,
               household_key TEXT NOT NULL,
               matter_id     TEXT NOT NULL,
               source_ref    TEXT NOT NULL,
               status        TEXT NOT NULL,
               remote_id     TEXT,
               created_at    TEXT NOT NULL,
               updated_at    TEXT NOT NULL
             );
```

And the methods (timestamps via the same RFC-3339 helper style the file already uses for cursors; `INSERT ... ON CONFLICT(dedup_key) DO UPDATE SET status=excluded.status, remote_id=COALESCE(excluded.remote_id, crm_outbound_writes.remote_id), updated_at=excluded.updated_at`).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd src-tauri && cargo test --lib commands::crm::store 2>&1 | tail -5`
Expected: all store tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/crm/store.rs
git commit -m "feat(crm): crm_outbound_writes idempotency ledger in CrmStore"
```

---

### Task 5: `push_crm_write` orchestrator (idempotency + ambiguous-failure recovery)

**Files:**
- Modify: `src-tauri/src/commands/crm/write.rs`

**Interfaces:**
- Consumes: `CrmWriteSource` (Task 3), `CrmStore::outbound_*` (Task 4).
- Produces (Task 6 consumes): `pub async fn push_crm_write(source: &dyn CrmWriteSource, store: &CrmStore, req: &CrmWriteRequest) -> Result<WriteReceipt, CrmWriteError>`

**Semantics (encode exactly):**
1. `key = dedup_key(req)`; look up ledger.
2. `sent` → return `WriteReceipt { remote_id, deduped: true }` (never re-post).
3. `pending_verify` → call `find_recent_matching`; if found → mark `sent`, return deduped receipt; if not found → proceed to send (the earlier attempt provably didn't land).
4. none / `pending` / `failed` → upsert `pending`, call `create_note`/`create_task`.
5. Success → upsert `sent` + remote_id → receipt (`deduped: false`).
6. `CrmWriteError::VerifyPending` from the source → upsert `pending_verify`, return `VerifyPending` (the UI shows "will verify on retry").
7. Any other error → upsert `failed`, propagate.

- [ ] **Step 1: Write the failing tests** — build a `FakeWriteSource` in the tests module:

```rust
    struct FakeWriteSource {
        create_results: std::sync::Mutex<Vec<Result<String, CrmWriteError>>>,
        find_result: Option<String>,
        create_calls: std::sync::atomic::AtomicUsize,
    }
    #[async_trait::async_trait]
    impl CrmWriteSource for FakeWriteSource {
        fn provider_id(&self) -> &'static str { "wealthbox" }
        async fn create_note(&self, _r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
            self.create_calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.create_results.lock().unwrap().remove(0)
        }
        async fn create_task(&self, r: &CrmWriteRequest) -> Result<String, CrmWriteError> {
            self.create_note(r).await
        }
        async fn find_recent_matching(&self, _r: &CrmWriteRequest) -> Result<Option<String>, CrmWriteError> {
            Ok(self.find_result.clone())
        }
    }
```

Tests (each opens a fresh temp `CrmStore` like Task 4):
- `second_identical_push_is_deduped_without_network`: first push Ok("555"); second push → `deduped: true`, `create_calls == 1`.
- `ambiguous_failure_then_verify_found_never_reposts`: first push returns `Err(VerifyPending)` → orchestrator returns VerifyPending, ledger row is `pending_verify`; second push with `find_result = Some("555")` → receipt `remote_id "555"`, `deduped: true`, `create_calls == 1`.
- `ambiguous_failure_then_verify_missing_resends`: as above but `find_result = None` and second create returns Ok("556") → receipt "556", `create_calls == 2`.

- [ ] **Step 2: Run to verify failure**

Run: `cd src-tauri && cargo test --lib commands::crm::write 2>&1 | tail -5`
Expected: compile error — `push_crm_write` not defined.

- [ ] **Step 3: Implement `push_crm_write`** exactly per the semantics list above (a straightforward match ladder; ~50 lines).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd src-tauri && cargo test --lib commands::crm::write 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/crm/write.rs
git commit -m "feat(crm): push_crm_write orchestrator — idempotent, verify-before-resend"
```

---

### Task 6: Tauri commands + audit + registration

**Files:**
- Modify: `src-tauri/src/commands/crm/commands.rs`
- Modify: `src-tauri/src/lib.rs` (add to the `commands::crm::commands::` block at ~line 171–176)

**Interfaces:**
- Consumes: `push_crm_write` (Task 5), `read_token`/`CrmProvider` (`provider.rs`), `CrmState` workspace mutex, `provider_scoped_matter_entries` + `CrmMatterMapEntry` (existing, `commands.rs:837-885`), audit helper `crm_audit_payload_json` (`commands.rs:180-230`) + the best-effort append fn right below it.
- Produces (Task 8 consumes — names must match exactly for the TS invoke):

```rust
#[tauri::command]
pub async fn crm_create_note(
    app: AppHandle, state: State<'_, CrmState>,
    matter_id: String, title: String, body: String, source_ref: String,
    household_key: String, provider: Option<String>,
) -> Result<crate::commands::crm::write::WriteReceipt, String>;

#[tauri::command]
pub async fn crm_create_task(
    app: AppHandle, state: State<'_, CrmState>,
    matter_id: String, title: String, description: String, due_date: Option<String>,
    source_ref: String, household_key: String, provider: Option<String>,
) -> Result<crate::commands::crm::write::WriteReceipt, String>;
```

(Design note, decided: the master plan's provider-agnostic signature `crm_create_note(matter_id, title, body, source_ref)` is preserved; `household_key` is resolved on the TS side from the matter's `crmHouseholdKeys` — Task 8 — because the backend does not persist the matter map. `state`/`app`/`provider` are infrastructure params, matching every existing crm command.)

**Command body (both commands, same skeleton):** resolve provider (`CrmProvider::from_optional`) → `read_token` else `Err("Wealthbox not connected — connect it in Account → Connections first")` → workspace from `state.workspace` else err (mirror `crm_sync_all`, `commands.rs:868-874`) → validate inputs (non-empty title; title ≤ 500 chars, body ≤ 20_000 chars → `InvalidInput`) → `CrmStore::open(&workspace)` → build `CrmWriteRequest` → `let client = WealthboxClient::new(token)` (Wealthbox only for now; other providers: return `CrmWriteError::NotSupported(provider.display_name()).to_string()` — Task 10 wires the registry) → `push_crm_write` → on `Ok(receipt)`: append audit via the existing best-effort helper with action `provider.audit_action("create_note")` and a description like `"Note pushed to Wealthbox household {household_key} (source: {source_ref})"`, **adding a matter-scoped metadata variant**: copy `crm_audit_payload_json` to a new `crm_audit_payload_json_for_matter(id, ts, action, description, matter_id)` that emits `"scope": { "kind": "matter", "matterId": matter_id }` instead of `allMatters` (verify the exact scope shape the frontend expects by reading `getAuditEntryMatterScope` — `grep -rn "getAuditEntryMatterScope" src/` — and matching one of its accepted forms) → map errors with `.map_err(|e| e.to_string())`.

- [ ] **Step 1: Write the failing test** — commands are thin; test the one piece of pure logic extracted as a helper `validate_write_inputs(title, body) -> Result<(), CrmWriteError>` (empty title / oversize rejection) in `write.rs`, plus a compile-level registration check:

```rust
    #[test]
    fn write_input_validation() {
        assert!(validate_write_inputs("t", "b").is_ok());
        assert!(matches!(validate_write_inputs("", "b"), Err(CrmWriteError::InvalidInput(_))));
        assert!(matches!(validate_write_inputs(&"x".repeat(501), "b"), Err(CrmWriteError::InvalidInput(_))));
        assert!(matches!(validate_write_inputs("t", &"x".repeat(20_001)), Err(CrmWriteError::InvalidInput(_))));
    }
```

- [ ] **Step 2: Run to verify failure** — `cd src-tauri && cargo test --lib commands::crm::write 2>&1 | tail -3` → compile error.

- [ ] **Step 3: Implement** the helper, both commands, the matter-scoped audit payload fn, and register both commands in `src-tauri/src/lib.rs` beside `commands::crm::commands::crm_sync_all,`.

- [ ] **Step 4: Verify** — `cd src-tauri && cargo test --lib commands::crm 2>&1 | tail -5` (all pass) and `cargo check 2>&1 | tail -3` (clean — proves registration compiles).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/crm/commands.rs src-tauri/src/commands/crm/write.rs src-tauri/src/lib.rs
git commit -m "feat(crm): crm_create_note / crm_create_task commands with matter-scoped audit"
```

---

### Task 7: Content-safety tests (injection cannot escape the body field)

**Files:**
- Modify: `src-tauri/src/commands/crm/write.rs` (tests only — implementation already safe by construction; these are regression locks)

- [ ] **Step 1: Write the tests**

```rust
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
```

- [ ] **Step 2: Run to verify both pass immediately** (they lock in existing behavior): `cd src-tauri && cargo test --lib commands::crm::write 2>&1 | tail -3`. If either fails, the implementation from Tasks 1/3 has a real bug — fix it there, not in the test.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/crm/write.rs
git commit -m "test(crm): injection and dedup-separator regression locks"
```

---

### Task 8: TS wrappers + inverse matter map

**Files:**
- Modify: `src/platform/rag/matterResolver.ts` (after `buildCrmMatterMap`, `matterResolver.ts:250`)
- Modify: `src/platform/utils/wealthbox-commands.ts` (mirror its existing wrapper conventions exactly — `invoke` + `isTauri()` guard, camelCase args as the file's other wrappers pass them)
- Test: extend the existing matterResolver spec (find it: `grep -rln "buildCrmMatterMap" tests/ src/ --include=*.test.ts`) and `tests/unit/wealthboxWriteCommands.test.ts` if the repo tests command wrappers (check how existing wrappers are tested; if they aren't, matterResolver tests suffice).

**Interfaces:**
- Produces (Task 9 consumes):

```ts
// matterResolver.ts
export function buildInverseCrmMap(matters: Matter[]): Map<string, string[]>; // matterId → householdIds

// wealthbox-commands.ts
export interface CrmWriteReceipt { remoteId: string; deduped: boolean; }
export async function crmCreateNote(args: { matterId: string; title: string; body: string; sourceRef: string; householdKey: string; provider?: CrmProvider; }): Promise<CrmWriteReceipt>;
export async function crmCreateTask(args: { matterId: string; title: string; description: string; dueDate?: string; sourceRef: string; householdKey: string; provider?: CrmProvider; }): Promise<CrmWriteReceipt>;
```

(Note: the Rust `WriteReceipt` serializes `remote_id`/`deduped`; check whether existing DTOs in this file arrive snake_case or camelCase from the backend — `CrmDisconnectResult` uses camelCase, and `WriteReceipt` derives plain Serialize, so add `#[serde(rename_all = "camelCase")]` to `WriteReceipt` in Task 1's struct — do that now if it was missed.)

- [ ] **Step 1: Write the failing test** (in the matterResolver spec file)

```ts
describe('buildInverseCrmMap', () => {
  it('maps matterId to its household keys and skips blanks/unassigned', () => {
    const matters = [
      { id: 'm1', crmHouseholdKeys: ['101', '102'] },
      { id: 'm2', crmHouseholdKeys: [''] },
      { id: 'unassigned', crmHouseholdKeys: ['999'] },
    ] as unknown as Matter[];
    const inv = buildInverseCrmMap(matters);
    expect(inv.get('m1')).toEqual(['101', '102']);
    expect(inv.get('m2')).toBeUndefined();
    expect(inv.get('unassigned')).toBeUndefined();
  });
});
```

(Match the property name and unassigned-sentinel constant to what `buildCrmMatterMap` actually reads at `matterResolver.ts:250-260` — reuse its exact skip logic, inverted.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run <that spec file> 2>&1 | tail -5`
Expected: FAIL — `buildInverseCrmMap` is not exported.

- [ ] **Step 3: Implement** `buildInverseCrmMap` (10 lines, the loop from `buildCrmMatterMap` with key/value swapped and the same skip rules) and the two wrappers (copy the shape of the nearest existing wrapper in `wealthbox-commands.ts`, e.g. the `crm_sync_all` one, including its `isTauri()` guard and error behavior).

- [ ] **Step 4: Run to verify pass** — same vitest command, plus `npm run typecheck 2>&1 | tail -3`.

- [ ] **Step 5: Commit**

```bash
git add src/platform/rag/matterResolver.ts src/platform/utils/wealthbox-commands.ts tests/
git commit -m "feat(crm): TS write wrappers + inverse matter→household map"
```

---

### Task 9: Approval queue store + review card UI

**Files:**
- Create: `src/platform/state/crmWriteQueueStore.ts`
- Create: `src/features/matters/CrmWriteReviewCard.tsx`
- Modify: `src/features/matters/ClientMapPanel.tsx` — mount the card directly beside the existing `<ClientMapUpdatesTray matterId={...} />` (find it: `grep -n "ClientMapUpdatesTray" src/features/matters/ClientMapPanel.tsx`)
- Modify: `src/features/matters/MatterNotesEditor.tsx` — add a "Send to Wealthbox" toolbar action that enqueues the current note (title = note title or first line, body = plain text) for the current matter
- Test: `src/platform/state/crmWriteQueueStore.test.ts`, `src/features/matters/CrmWriteReviewCard.test.tsx`

**Interfaces:**
- Consumes: `crmCreateNote`/`crmCreateTask`/`crmIsConnected` wrappers (Task 8; `crm_is_connected` already exists — `commands.rs:559`), `buildInverseCrmMap`, the matter store (`src/platform/matter/matterStore.ts`).
- Produces (Wave 3 will feed this store with meeting outputs):

```ts
export interface ProposedCrmWrite {
  id: string;                        // local uuid
  kind: 'note' | 'task';
  matterId: string;
  title: string;
  body: string;
  dueDate?: string;
  sourceRef: string;
  status: 'proposed' | 'sending' | 'sent' | 'failed' | 'verify_pending';
  remoteId?: string;
  error?: string;
}
export const useCrmWriteQueueStore: /* zustand */ {
  items: ProposedCrmWrite[];
  enqueue(item: Omit<ProposedCrmWrite, 'id' | 'status'>): void;
  approve(ids: string[], householdKey: string): Promise<void>;  // sequential sends
  dismiss(id: string): void;
};
```

**UX spec (from the design constitution — keep exactly this simple):** the card appears on a client's map ONLY when that client has queued items. Header: "Send to Wealthbox — N items". Each item: kind chip (Note/Task), title, body preview rendered with a green tracked-changes-style tint (match the visual language used by the AI-redline/updates tray — reuse its classes), a small provenance line ("from: <sourceRef>"), a checkbox (default checked). Footer: household picker (ONLY shown when `buildInverseCrmMap` returns >1 household for this matter; auto-selected when exactly 1; the whole card shows a "Link this client to a Wealthbox household first" empty-state when 0), one primary **Approve & send** button, one quiet **Dismiss** per item. `verify_pending` items show "Delivery unconfirmed — will verify on next try" with a Retry button. Never auto-send: the ONLY call sites of `approve()` are the button handler and tests.

- [ ] **Step 1: Write the failing store test**

```ts
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { vi } from 'vitest';

vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmCreateNote: vi.fn().mockResolvedValue({ remoteId: '555', deduped: false }),
  crmCreateTask: vi.fn().mockResolvedValue({ remoteId: '556', deduped: false }),
}));

it('approve sends sequentially and marks sent', async () => {
  const { crmCreateNote } = await import('@/platform/utils/wealthbox-commands');
  const s = useCrmWriteQueueStore.getState();
  s.enqueue({ kind: 'note', matterId: 'm1', title: 'T', body: 'B', sourceRef: 'doc:x' });
  const id = useCrmWriteQueueStore.getState().items[0].id;
  await s.approve([id], '12345');
  expect(crmCreateNote).toHaveBeenCalledTimes(1);
  expect(crmCreateNote).toHaveBeenCalledWith(expect.objectContaining({ householdKey: '12345', matterId: 'm1' }));
  expect(useCrmWriteQueueStore.getState().items[0].status).toBe('sent');
});

it('enqueue never triggers a send by itself', async () => {
  const { crmCreateNote } = await import('@/platform/utils/wealthbox-commands');
  vi.mocked(crmCreateNote).mockClear();
  useCrmWriteQueueStore.getState().enqueue({ kind: 'note', matterId: 'm2', title: 'T2', body: 'B2', sourceRef: 'doc:y' });
  await new Promise((r) => setTimeout(r, 10));
  expect(crmCreateNote).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/platform/state/crmWriteQueueStore.test.ts 2>&1 | tail -5` → module not found.

- [ ] **Step 3: Implement the store** (plain Zustand, no persistence — proposals are session-scoped by design; a restart clears un-approved proposals, which is the safe default). `approve` loops the selected ids sequentially (the backend's 1 rps gate makes parallel sends pointless), sets `sending` → `sent`/`failed`/`verify_pending` (map the backend's `VerifyPending` error-string via `err.toString().includes('verification pending')`).

- [ ] **Step 4: Store tests pass** — same vitest command.

- [ ] **Step 5: Write the failing component test** (RTL; mock the store with two proposed items and connected=true; assert: renders both titles, Approve button calls `approve` once with both ids, a matter with zero households renders the link-first empty state and no Approve button).

- [ ] **Step 6: Implement `CrmWriteReviewCard.tsx`** per the UX spec (shadcn `Card`, existing button primitives from `src/ui/`; household resolution via `buildInverseCrmMap(useMatterStore.getState().matters)`; gate on `crmIsConnected()` in a `useEffect`, hiding the card with a one-line "Connect Wealthbox to send" hint when disconnected). Mount it in `ClientMapPanel.tsx` beside `ClientMapUpdatesTray`, passing the panel's current `matterId` prop the same way the tray receives it.

- [ ] **Step 7: Add the enqueue action** in `MatterNotesEditor.tsx`: a toolbar button "Send to Wealthbox" → `useCrmWriteQueueStore.getState().enqueue({ kind: 'note', matterId, title: <note title/first line>, body: <plain text>, sourceRef: 'note:' + <note path/id> })` + a toast "Added to the Wealthbox review card on this client's map". (Match how the editor's existing toolbar actions are declared — read the file's toolbar section first.)

- [ ] **Step 8: All frontend tests + typecheck pass**

Run: `npx vitest run src/platform/state/crmWriteQueueStore.test.ts src/features/matters/CrmWriteReviewCard.test.tsx 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -3`
Expected: PASS / clean.

- [ ] **Step 9: Commit**

```bash
git add src/platform/state/crmWriteQueueStore.ts src/features/matters/CrmWriteReviewCard.tsx src/features/matters/ClientMapPanel.tsx src/features/matters/MatterNotesEditor.tsx src/platform/state/crmWriteQueueStore.test.ts src/features/matters/CrmWriteReviewCard.test.tsx
git commit -m "feat(crm): approval queue + review card — one Approve, never background"
```

---

### Task 9b: Optional compliance summary filed to the CRM

> **2026-07-02 Jameson: added from Jump coverage audit** (D3 — Jump syncs compliance
> logs to the CRM). Ours rides the existing write path: one extra, approval-gated
> note composed from what the card just sent. Off by default; a single inline toggle
> on the review card — NOT a settings page.

**Files:**
- Create: `src/features/matters/complianceNote.ts`
- Modify: `src/features/matters/CrmWriteReviewCard.tsx` (footer toggle + post-approve enqueue)
- Test: `src/features/matters/complianceNote.test.ts`

**Interfaces:**
- Consumes: `ProposedCrmWrite` + `useCrmWriteQueueStore` (Task 9), `crmCreateNote` wrapper (Task 8).
- Produces: `composeComplianceNote(sent: ProposedCrmWrite[], meta: ComplianceNoteMeta): { title: string; body: string }` with

```ts
export interface ComplianceNoteMeta {
  clientLabel: string;
  whenIso: string;              // approval timestamp
  /** DEPENDS-WAVE-3: consent fields come from the Wave 3 consent ledger.
   *  Optional so this task ships in Wave 2 without it; Wave 3's Task 12
   *  (meeting outputs -> queue) passes it when the source is a meeting. */
  consent?: { status: 'noted' | 'standing' | 'not-applicable'; method?: string; atIso?: string };
  retentionPolicy?: string;     // DEPENDS-WAVE-3/4: e.g. "Audio deleted after 30 days"
}
```

- [ ] **Step 1: Write the failing test**

`src/features/matters/complianceNote.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composeComplianceNote } from './complianceNote';
import type { ProposedCrmWrite } from '@/platform/state/crmWriteQueueStore';

const sent: ProposedCrmWrite[] = [
  { id: '1', kind: 'note', matterId: 'm1', title: 'Annual review', body: 'x', sourceRef: 'meeting:2026-06-30', status: 'sent', remoteId: 'wb-9' },
  { id: '2', kind: 'task', matterId: 'm1', title: 'Send Roth illustration', body: 'y', dueDate: '2026-07-07', sourceRef: 'meeting:2026-06-30', status: 'sent', remoteId: 'wb-10' },
];

describe('composeComplianceNote', () => {
  it('lists every sent item with its remote receipt and stamps the approval time', () => {
    const { title, body } = composeComplianceNote(sent, {
      clientLabel: 'The Hendersons',
      whenIso: '2026-07-02T14:41:00Z',
      consent: { status: 'noted', method: 'verbal', atIso: '2026-06-30T10:00:00Z' },
    });
    expect(title).toContain('Compliance summary');
    expect(body).toContain('Annual review');
    expect(body).toContain('wb-10');
    expect(body).toContain('Consent: noted (verbal)');
    expect(body).toContain('Approved by the advisor');
  });

  it('omits consent lines when consent metadata is absent (pre-Wave-3 sources)', () => {
    const { body } = composeComplianceNote(sent, { clientLabel: 'X', whenIso: '2026-07-02T14:41:00Z' });
    expect(body).not.toContain('Consent:');
  });

  it('never includes failed or dismissed items', () => {
    const mixed = [...sent, { ...sent[0], id: '3', title: 'Broken', status: 'failed' as const }];
    const { body } = composeComplianceNote(mixed, { clientLabel: 'X', whenIso: '2026-07-02T14:41:00Z' });
    expect(body).not.toContain('Broken');
  });
});
```

- [ ] **Step 2: Run to verify red**

Run: `npx vitest run src/features/matters/complianceNote.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `complianceNote.ts`**

```ts
/**
 * Composes the optional, approval-gated "compliance summary" CRM note from the
 * receipts of a just-approved review-card send. Pure; no IO. Consent/retention
 * lines appear only when the caller supplies them (Wave 3+ meeting sources).
 */

import type { ProposedCrmWrite } from '@/platform/state/crmWriteQueueStore';

export interface ComplianceNoteMeta {
  clientLabel: string;
  whenIso: string;
  consent?: { status: 'noted' | 'standing' | 'not-applicable'; method?: string; atIso?: string };
  retentionPolicy?: string;
}

export function composeComplianceNote(
  items: ProposedCrmWrite[],
  meta: ComplianceNoteMeta,
): { title: string; body: string } {
  const sent = items.filter((i) => i.status === 'sent');
  const lines: string[] = [
    `Compliance summary for ${meta.clientLabel}`,
    `Approved by the advisor: ${meta.whenIso}`,
    '',
    'Records filed:',
    ...sent.map(
      (i) => `- ${i.kind === 'note' ? 'Note' : 'Task'}: "${i.title}" (receipt ${i.remoteId ?? 'pending'}; source ${i.sourceRef})`,
    ),
  ];
  if (meta.consent) {
    lines.push('', `Consent: ${meta.consent.status}${meta.consent.method ? ` (${meta.consent.method})` : ''}${meta.consent.atIso ? ` at ${meta.consent.atIso}` : ''}`);
  }
  if (meta.retentionPolicy) lines.push(`Retention policy: ${meta.retentionPolicy}`);
  return { title: `Compliance summary: ${meta.clientLabel} (${meta.whenIso.slice(0, 10)})`, body: lines.join('\n') };
}
```

- [ ] **Step 4: Run to verify green**

Run: `npx vitest run src/features/matters/complianceNote.test.ts`
Expected: `3 passed`

- [ ] **Step 5: Wire the toggle into the review card**

In `CrmWriteReviewCard.tsx`: a small checkbox row in the footer, ABOVE the Approve button, default UNCHECKED: `data-testid="file-compliance-note"` label "Also file a compliance note". In the approve handler, after `approve(ids, householdKey)` resolves: if checked, compose from the store's now-`sent` items and `enqueue({ kind: 'note', matterId, title, body, sourceRef: 'compliance:' + new Date().toISOString() })` — the compliance note goes through the SAME review card on its next render (approval-gated like everything; never auto-sent). Add one test to `CrmWriteReviewCard.test.tsx`: with the toggle checked, approving results in exactly one new `proposed` item titled with "Compliance summary" — and `crmCreateNote` has NOT been called for it.

- [ ] **Step 6: Tests + typecheck**

Run: `npx vitest run src/features/matters/complianceNote.test.ts src/features/matters/CrmWriteReviewCard.test.tsx 2>&1 | tail -5 && npm run typecheck 2>&1 | tail -3`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/matters/complianceNote.ts src/features/matters/complianceNote.test.ts src/features/matters/CrmWriteReviewCard.tsx src/features/matters/CrmWriteReviewCard.test.tsx
git commit -m "feat(crm): optional approval-gated compliance summary note (Jump coverage audit D3)"
```

---

### Task 9c: Field-level blended updates (3-column review)

> **2026-07-02 Jameson: added from Jump completeness sweep.** Jump ships "blended
> updates" — CRM field-level writes with a 3-column review (existing / new / blended).
> Jameson pulled field updates into this wave (they were v2). Same approval card, same
> dedup/retry/audit machinery, never a background sync.

**Files:**
- Modify: `src-tauri/src/commands/crm/write.rs` (new request/trait method)
- Modify: `src-tauri/src/commands/crm/client.rs` (`put_json` + `get_contact_fields`)
- Modify: `src-tauri/src/commands/crm/commands.rs` (`crm_update_field` command)
- Modify: `src-tauri/src/lib.rs` (register `crm_update_field`)
- Modify: `src/platform/crm/commands.ts` or the Task 8 wrapper module (TS wrapper)
- Modify: `src/platform/state/crmWriteQueueStore.ts` (`kind: 'field'` items)
- Modify: `src/features/matters/CrmWriteReviewCard.tsx` (3-column row rendering)
- Test: extend `write.rs` tests + `crmWriteQueueStore.test.ts` + `CrmWriteReviewCard.test.tsx`

**Interfaces:**
- Consumes: Task 1 models (`CrmWriteError`, ledger dedup), Task 2 `post_json` conventions (PII discipline: bodies never logged), Task 3 trait, Task 5 orchestrator, Task 9 card/store.
- Produces:

```rust
pub struct CrmFieldUpdateRequest {
    pub matter_id: String,
    pub household_key: String,
    pub field: String,           // provider field path, e.g. "background_information"
    pub existing_value: String,  // fetched at proposal time; re-checked at approve time
    pub new_value: String,       // what the meeting/source contributed
    pub final_value: String,     // what actually gets written (user-edited blend)
    pub source_ref: String,
}
// trait addition:
//   async fn update_field(&self, req: &CrmFieldUpdateRequest) -> Result<String, CrmWriteError>;
// dedup: dedup_key_field(&req) hashes (household_key, field, final_value).
```

  - Tauri command `crm_update_field(state, app, provider, req: CrmFieldUpdateRequest) -> Result<WriteReceipt, String>` — same audit payload helper as `crm_create_note` (`crm_audit_payload_json`, `commands.rs:180-230`) with action `"crm_field_updated"`.
  - **Blend proposal (TS side, in the queue store):** scalar fields (numbers, dates, single-choice) → `final_value = new_value` (replace); narrative fields → provider-composed merge via the existing `Provider` interface ("Merge the new information into the existing text. Keep every existing fact. Return only the merged text."), with a deterministic fallback `existing + "\n\n" + new` when no provider is configured. `final_value` is ALWAYS user-editable in the card before approve. Which fields are narrative: a provider-specific allowlist next to the wrapper (`VERIFY-LIVE:` Wealthbox narrative fields — start with `background_information`; confirm exact writable field names + PUT shape during the Task 11 live probe).
  - **Stale-guard:** at approve time the orchestrator re-fetches the field (`get_contact_fields`); if the remote value no longer equals `existing_value`, the item flips to `verify_pending` with "This field changed in Wealthbox since the proposal — review again", re-rendering the 3 columns with the fresh value. Never overwrite blind.

- [ ] **Step 1: Write the failing wiremock test** (in `write.rs` tests)

```rust
    #[tokio::test]
    async fn wealthbox_update_field_puts_exact_shape() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        // VERIFY-LIVE: Wealthbox contact update endpoint + field envelope
        // (assumed PUT /contacts/{id} with a flat field body; confirm in Task 11 live probe).
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
        let req = CrmFieldUpdateRequest {
            matter_id: "matter-1".into(),
            household_key: "12345".into(),
            field: "background_information".into(),
            existing_value: "Existing background.".into(),
            new_value: "Retiring spring 2027; stress-test earlier exit.".into(),
            final_value: "Existing background.\n\nRetiring spring 2027; stress-test earlier exit.".into(),
            source_ref: "meeting:Clients/Hendersons/Meetings/2026-06-30#0".into(),
        };
        let id = client.update_field(&req).await.unwrap();
        assert_eq!(id, "12345");
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
```

- [ ] **Step 2: Run to verify failure** — `cd src-tauri && cargo test --lib commands::crm::write 2>&1 | tail -5` → compile error.
- [ ] **Step 3: Implement Rust** — `put_json`/`get_contact_fields` on `WealthboxClient` (mirror `post_json`'s 429-only retry: PUTs never blind-retry on 5xx; PII discipline identical), the trait method, dedup, ledger reuse (kind column value `field`), the command + registration.
- [ ] **Step 4: Run Rust tests** — PASS.
- [ ] **Step 5: Write the failing TS tests** — queue store: enqueuing a field item computes a scalar replace and a narrative blend (mock provider returning a canned merge; assert deterministic fallback without a provider); card: renders three labeled columns (Existing / From this meeting / Blended, the third editable), approve disabled while `final_value` is empty, stale `verify_pending` state renders the re-review message. Follow the Task 9 test files' mocking patterns exactly.
- [ ] **Step 6: Run to verify failure**, **Step 7: Implement TS** (store blend logic + the 3-column row inside the existing card — tracked-changes green on the Blended column only; no new card, no new surface), **Step 8: Run all tests + typecheck** — PASS.
- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/commands/crm/ src-tauri/src/lib.rs src/platform/state/crmWriteQueueStore.ts src/features/matters/CrmWriteReviewCard.tsx tests/
git commit -m "feat(crm): field-level blended updates with 3-column review, stale-guard, approval-gated (Wave 2)"
```

### Task 10: Redtail / Salesforce write stubs + provider registry

> 2026-07-02 note: the stubs cover `update_field` too — same typed `NotSupported` error as create_note/create_task.

**Files:**
- Modify: `src-tauri/src/commands/crm/write.rs`

**Interfaces:**
- Consumes: `RedtailClient` (`redtail.rs`), `SalesforceClient` (`salesforce.rs`), `CrmProvider` (`provider.rs`).
- Produces: `pub fn write_client_for(provider: CrmProvider, token: String) -> anyhow::Result<Box<dyn CrmWriteSource>>` — Task 6's commands switch from direct `WealthboxClient::new` to this registry (small follow-up edit in `commands.rs`).

- [ ] **Step 1: Failing tests**

```rust
    #[tokio::test]
    async fn redtail_and_salesforce_writes_return_typed_not_supported() {
        let r = crate::commands::crm::redtail::RedtailClient::new("k".into()).unwrap();
        let err = r.create_note(&note_req()).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::NotSupported("Redtail")));
    }
```

(Mirror for Salesforce — its `new` takes a token-set JSON string; build the minimal valid one the same way `provider.rs:102` tests do, or reuse a fixture from `salesforce.rs` tests.)

- [ ] **Step 2: Verify failure** → compile error.

- [ ] **Step 3: Implement**: `impl CrmWriteSource for RedtailClient` / `SalesforceClient` with all three methods returning `Err(CrmWriteError::NotSupported("Redtail"/"Salesforce"))`, plus `write_client_for` matching `client_for` in `provider.rs:83-89`. Update Task 6's commands to route through it.

- [ ] **Step 4: Verify** — `cd src-tauri && cargo test --lib commands::crm 2>&1 | tail -5` all pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/crm/write.rs src-tauri/src/commands/crm/commands.rs
git commit -m "feat(crm): write registry + typed NotSupported stubs for Redtail/Salesforce"
```

---

### Task 11: Gate, live-probe checklist, changelog, merge

**Files:**
- Create: `scripts/crm/wealthbox-write-probe.md`
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)

- [ ] **Step 1: Write the live-probe checklist** — a five-minute manual script for whoever holds a real Wealthbox token: create one note + one task against a sandbox contact via the app, then verify in Wealthbox: (1) note content/linebreaks, (2) linked_to landed on the right household, (3) task due_date parsed, (4) response id matched the ledger's remote_id (`SELECT * FROM crm_outbound_writes` via the store's debug path), (5) one field update: blend `background_information` on the sandbox contact and verify the merged text + that no other field changed, and (6) update every `VERIFY-LIVE` comment with the confirmed shape.

- [ ] **Step 2: Update CHANGELOG.md** under `## [Unreleased]`:

```markdown
### Added
- **CRM write-back (Wealthbox)** — approval-gated notes/tasks pushed to the linked household, with idempotency ledger, verify-before-resend, and matter-scoped audit entries.
  - Files: `src-tauri/src/commands/crm/{write.rs,client.rs,store.rs,commands.rs}`, `src/features/matters/CrmWriteReviewCard.tsx`, `src/platform/state/crmWriteQueueStore.ts`
```

- [ ] **Step 3: Full gate**

Run: `npm run gate 2>&1 | tail -15`
Expected: typecheck + i18n + vitest + ESLint + cargo all green. Paste the tail output into the merge note — evidence before assertions.

- [ ] **Step 4: Codex adversarial review** (per master-plan merge ritual)

Run: `codex-review --base lantern-plus "Wave 2 CRM write-back: idempotency correctness, double-post risk, PII leaks in logs/errors, injection paths, UI auto-send regressions" < /dev/null`
Fix real findings; re-run gate if code changed.

- [ ] **Step 5: Merge + push + notify**

```bash
git checkout lantern-plus && git merge --no-ff lp/crm-writeback -m "merge: lp/crm-writeback — Wave 2 CRM write-back (gate green, codex-reviewed)"
git push origin lantern-plus
notify-jameson --subject "[Lantern-Plus] MILESTONE: CRM write-back merged" --body "Project: Lantern-Plus (~/lantern-plus — Jump-parity fork)
Task: Wave 2 — write notes/tasks into Wealthbox with one-click approval
Result: Merged, all tests green, Codex-reviewed. Live Wealthbox probe still pending (needs a real token — checklist in scripts/crm/wealthbox-write-probe.md)
Next: Wave 3 gate — your go/no-go on meeting capture" --level info --channel email,telegram
```

---

## Self-review (done at authoring time)

- **Spec coverage:** (a) commands ✓ Task 6; (b) write layer + error taxonomy + retry + idempotency + quota ✓ Tasks 1–5 (quota = 429 path, Task 2); (c) inverse mapping ✓ Task 8; (d) approval UI, no new tab, never silent ✓ Task 9; (e) audit with source_ref ✓ Task 6; (f) injection test ✓ Task 7; (g) Redtail/Salesforce trait + stubs ✓ Task 10.
- **Known judgment calls (flagged for the executor's reviewer):** household resolution lives on the TS side (backend stays map-free, matching `crm_sync_all`'s design); proposals are session-scoped (no persistence) by design; `map_http_err` string-matching is acceptable only because Task 2's tests pin the error formats — if `get_json`'s formats change, both must move together.
- **Type consistency check:** `WriteReceipt { remote_id, deduped }` + `rename_all = "camelCase"` (Task 1 struct, consumed as `{ remoteId, deduped }` in Task 8 TS) ✓; `CrmWriteRequest` fields consistent across Tasks 1/3/5/6 ✓; command arg names in Task 6 match the TS `invoke` payloads in Task 8 (Tauri 2 camelCase↔snake_case auto-conversion, same as existing wrappers) ✓.

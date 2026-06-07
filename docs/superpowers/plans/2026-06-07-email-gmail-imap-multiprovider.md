# Email Multi-Provider (Gmail + IMAP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Keepance's email import beyond Microsoft 365 to Gmail and generic IMAP, behind one shared provider seam, so adding a provider is writing one adapter — not touching the sync/encryption/index engine.

**Architecture:** Introduce a `MailProvider` trait that abstracts authenticate → list folders → fetch changes (backfill + incremental) → normalized `MailMessage`. Refactor the existing Microsoft 365 code to implement it (no behavior change, regression-guarded). Then add a `GmailProvider` (Gmail API) and an `ImapProvider` (async-imap). All three feed the existing `EncryptedMailStore` + RAG/keyword index unchanged — encryption is already solved and provider-agnostic.

**Tech Stack:** Rust (Tauri backend), `reqwest` (Gmail HTTP), `async-imap` + `mail-parser` (IMAP), existing `EncryptedMailStore` (AES-256-GCM + SQLCipher), LanceDB RAG, React/TS frontend.

**Reference implementation:** The Microsoft 365 connector (`src-tauri/src/commands/mail/{oauth,graph,sync,normalize,model,store}.rs`) is the working template. Mechanical adapter parts (HTTP client shape, device-code UX, per-folder cursor loop, blob/encrypt path) **mirror** these files; this plan calls out where to mirror vs. where the logic genuinely differs.

---

## ⚠️ Strategic decisions to confirm before executing (Jameson's call)

These are surfaced because they have cost/trust implications beyond code. Recommendations included; the rest of the plan is written to accommodate either choice.

### Decision 1 — Gmail auth path (the expensive one)
The Gmail **API** read scope `gmail.readonly` is a Google **restricted scope**. Shipping it to real users (production OAuth, >100 users) requires **CASA Tier 3** — a third-party penetration test costing **thousands of dollars per year**, weeks of lead time, with **annual** recertification. `gmail.modify` is only "sensitive" (Tier 2, cheaper) but grants read+write, which breaks our read-only/least-privilege story and is the wrong look for a privilege-focused product.

Three real options:
- **(A) IMAP-with-app-password reaches Gmail too, CASA-free (recommended).** Gmail users with 2FA can generate a Google "app password" and connect over IMAP. No Google Cloud verification, no CASA, no annual fee. Covers Gmail *and* every other IMAP host with one adapter. Downside: the user does a one-time app-password setup; no Gmail-native labels/history (we use IMAP UID sync). 
- **(B) Build the Gmail API adapter, ship it only in "Testing" mode (≤100 users) for now.** Lets early design-partner Gmail users in without CASA; defer the CASA spend until Gmail demand justifies it.
- **(C) Commit to CASA Tier 3 for `gmail.readonly`.** Cleanest Gmail-native UX (labels, history sync, no app-password step) but real recurring cost + timeline. Only worth it once Gmail is a proven demand driver.

**Recommendation:** Build **Phase 0 (seam)** and **Phase 2 (IMAP)** first — IMAP is CASA-free and immediately reaches Gmail users via app-password. Build the **Gmail API adapter (Phase 1)** but keep it in **Testing mode** until paid demand justifies CASA. This delivers Gmail coverage now at zero verification cost and keeps the native-Gmail path open.

### Decision 2 — IMAP authentication / credential storage
IMAP needs credentials. Options: app-password / plain password (stored in OS keychain), or `XOAUTH2` (OAuth token, no stored password but hits the same restricted-scope wall for Gmail/M365). **Recommendation:** Support **app-password/password via the OS keychain** (never plaintext on disk; never logged) as the primary path, plus **XOAUTH2 reuse of an existing M365 OAuth token** for Outlook IMAP where we already have it. Show clear per-provider setup help (e.g., "Generate a Google app password" link). No raw password is ever stored outside the OS keychain.

### Decision 3 — Build order
Phase 0 is a prerequisite for both. After that, **recommend IMAP before Gmail-API** (per Decision 1). You picked "plan both together"; the plan is order-flexible after Phase 0 — say the word if you want Gmail-API first.

---

## File structure

**New files:**
- `src-tauri/src/commands/mail/provider.rs` — the `MailProvider` trait + shared types (`RemoteFolder`, `ChangePage`, `Cursor`), and a `ProviderKind` enum.
- `src-tauri/src/commands/mail/gmail/mod.rs` — `GmailProvider` (implements `MailProvider`).
- `src-tauri/src/commands/mail/gmail/oauth.rs` — Google OAuth (device flow, mirrors `oauth.rs`).
- `src-tauri/src/commands/mail/gmail/api.rs` — Gmail REST client (mirrors `graph.rs`).
- `src-tauri/src/commands/mail/gmail/normalize.rs` — Gmail JSON → `MailMessage`.
- `src-tauri/src/commands/mail/imap/mod.rs` — `ImapProvider` (implements `MailProvider`).
- `src-tauri/src/commands/mail/imap/client.rs` — async-imap connection + FETCH/UID logic.
- `src-tauri/src/commands/mail/imap/normalize.rs` — RFC822 → `MailMessage` (via `mail-parser`).
- `src/components/settings/MailAccounts.tsx` — multi-account / multi-provider connect UI (generalizes `MailConnect.tsx`).

**Modified files:**
- `src-tauri/src/commands/mail/model.rs` — add `folders: Vec<String>` (labels-as-tags), `thread_id: Option<String>`, `provider`/`account` fields; keep `from_graph` (moves to be called by `GraphProvider`).
- `src-tauri/src/commands/mail/graph.rs` + new `m365/provider.rs` — wrap the existing Graph client in a `GraphProvider: MailProvider`.
- `src-tauri/src/commands/mail/sync.rs` — make `sync_folder_enc` generic over `&dyn MailProvider` instead of `&GraphClient`; `apply_page_enc` operates on normalized `MailMessage`/removed-ids, not raw Graph JSON.
- `src-tauri/src/commands/mail/store.rs` — `MailRecord` gains `provider` + `account` columns; cursor keyed by `(provider, account, folder)`.
- `src-tauri/src/commands/mail/mod.rs` — command surface gains a `provider`/`account` argument; `mail_sync_all` iterates configured accounts across providers.
- `src-tauri/src/commands/mail/fde.rs` — unchanged (OS-level).
- `src-tauri/Cargo.toml` — add `async-imap`, `mail-parser`, `async-trait`.
- `src/utils/mail-commands.ts`, `src/stores/mailStore.ts`, `src/hooks/useMailSync.ts` — carry `provider`/`account`.

**Design invariants (do not break):**
- Encryption stays in `EncryptedMailStore` + `build_batch_mail`; providers never see ciphertext or keys.
- Folders/labels are **tags** on the normalized model (a message can have several) — absorbs Outlook-folders vs Gmail-labels.
- Cross-provider de-dupe uses the `internet_message_id` (`Message-ID`) header.
- Threading reconciled onto one `thread_id` (Graph `conversationId` / Gmail `threadId` / IMAP `References`/`In-Reply-To`).
- Credentials/tokens only in the OS keychain, keyed per `(provider, account)`. Never logged.

---

## Phase 0 — Provider seam (refactor M365 behind a trait; no behavior change)

**Outcome:** M365 import works exactly as today, but through `MailProvider`. Existing mail/rag tests stay green (this is the regression gate).

### Task 0.1: Define the `MailProvider` trait + shared types

**Files:**
- Create: `src-tauri/src/commands/mail/provider.rs`
- Modify: `src-tauri/src/commands/mail/mod.rs` (add `pub mod provider;`)
- Modify: `src-tauri/Cargo.toml` (add `async-trait = "0.1"`)

- [ ] **Step 1: Write the failing test** (`provider.rs`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cursor_roundtrips_through_string() {
        assert_eq!(Cursor::from_token(Some("abc".into())), Cursor::Resume("abc".into()));
        assert_eq!(Cursor::from_token(None), Cursor::Backfill);
    }
}
```

- [ ] **Step 2: Run it, expect FAIL** — `cargo test --lib provider` → "cannot find type `Cursor`".

- [ ] **Step 3: Implement the trait + types:**

```rust
use async_trait::async_trait;
use crate::commands::mail::model::MailMessage;

/// A provider folder/label (Outlook folder, Gmail label, IMAP mailbox).
#[derive(Debug, Clone, PartialEq)]
pub struct RemoteFolder { pub id: String, pub display_name: String }

/// Where a folder's sync resumes from. Opaque per provider (delta link,
/// historyId, or "UIDVALIDITY:lastUID").
#[derive(Debug, Clone, PartialEq)]
pub enum Cursor { Backfill, Resume(String) }
impl Cursor {
    pub fn from_token(t: Option<String>) -> Cursor {
        match t { Some(s) => Cursor::Resume(s), None => Cursor::Backfill }
    }
}

/// One page of changes for a folder.
pub struct ChangePage {
    pub messages: Vec<MailMessage>,   // already normalized
    pub removed_ids: Vec<String>,     // tombstones
    pub next: Option<String>,         // Some = more / resume token; None = folder complete
    pub done: bool,                   // true when the round is complete (persist as deltaLink)
}

#[async_trait]
pub trait MailProvider: Send + Sync {
    fn kind(&self) -> &'static str;            // "m365" | "gmail" | "imap"
    async fn list_folders(&self) -> anyhow::Result<Vec<RemoteFolder>>;
    /// Fetch one page of changes for `folder` from `cursor`.
    async fn fetch_changes(&self, folder: &RemoteFolder, cursor: &Cursor)
        -> anyhow::Result<ChangePage>;
}
```

- [ ] **Step 4: Run test, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(mail): MailProvider trait + shared provider types"`.

### Task 0.2: Normalized model gains tags + thread id + provenance

**Files:** Modify `src-tauri/src/commands/mail/model.rs` (+ its tests).

- [ ] **Step 1:** Add a failing test asserting `MailMessage` has `folders: Vec<String>`, `thread_id: Option<String>`, `provider: String`, `account: String`, and that `from_graph` populates `thread_id` from `conversationId` and `provider="m365"`.
- [ ] **Step 2:** Run → FAIL (missing fields).
- [ ] **Step 3:** Add the fields (default empty/`"m365"` in `from_graph`); set `thread_id = conversation_id.clone()`. Keep `body_text`, etc. unchanged.
- [ ] **Step 4:** Run → PASS. Update `normalize::to_markdown` to emit `thread_id`/`folders`/`provider` frontmatter (use the existing `yaml_escape`; keep it on single lines).
- [ ] **Step 5:** Commit.

### Task 0.3: `apply_page_enc` operates on normalized messages, not Graph JSON

**Files:** Modify `src-tauri/src/commands/mail/sync.rs` (+ tests).

- [ ] **Step 1:** Add `apply_messages_enc(store, ws, folder_id, msgs: &[MailMessage], removed: &[String], key, index_cb, tombstone_cb) -> PageStats` — same body as today's `apply_page_enc` but driven by the normalized inputs (no `from_graph` / no `value` array parsing). The blob/encrypt/index/tombstone logic is unchanged (mirror lines that write `.enc`, call `index_callback`, `tombstone_callback`).
- [ ] **Step 2:** Keep `apply_page_enc(...page: &Value...)` as a thin wrapper that parses Graph JSON into `(Vec<MailMessage>, Vec<removed>)` then calls `apply_messages_enc`, so existing tests still pass. Run the existing sync tests → PASS.
- [ ] **Step 3:** Commit.

### Task 0.4: `GraphProvider` implements `MailProvider`

**Files:**
- Create: `src-tauri/src/commands/mail/m365/provider.rs` (+ `pub mod m365;` with `provider`), or place `GraphProvider` in `graph.rs`.
- Modify: `sync.rs` to add a generic `sync_folder_provider(provider: &dyn MailProvider, store, ws, folder, key, emit, index_cb, tombstone_cb)`.

- [ ] **Step 1:** Test: a `GraphProvider` built on a wiremock base returns folders via `list_folders()` and a `ChangePage` via `fetch_changes()` (reuse the wiremock pattern from `graph.rs` tests).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `GraphProvider { client: GraphClient }`: `list_folders` = the `mailFolders?$top=200` pagination currently inlined in `mod.rs`; `fetch_changes` = `client.get_json(url)` + `page_continuation` + parse items to `MailMessage` (`from_graph`) + collect `@removed` ids, mapping `DeltaGone` → restart cursor. Move the 410-bound loop into `sync_folder_provider`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Rewire `mail_sync_all_inner` to build a `GraphProvider` and call `sync_folder_provider`. Run the FULL mail suite + `tsc -b` + `npm test` → all green (regression gate). Commit.

---

## Phase 1 — Gmail adapter (gated on Decision 1; build in Testing mode)

**Outcome:** A Gmail account connects (device-flow OAuth) and imports into the same encrypted store + index. Ships behind the same UI.

> Build/test entirely in Google "Testing" mode (no CASA needed for ≤100 test users). Do NOT submit for production verification without an explicit go on Decision 1(C).

### Task 1.1: Google Cloud OAuth client (operator step, automatable)
- [ ] Register a Google Cloud project + OAuth 2.0 **Desktop** client and enable the Gmail API, OAuth consent screen in "Testing", scopes `https://www.googleapis.com/auth/gmail.readonly` + `openid email`. (Claude can drive this in the Chrome app, mirroring how the Azure app was registered; record `GMAIL_CLIENT_ID` via `option_env!` fallback like `client_id()` in `mod.rs`.) No client secret is committed (Desktop clients use PKCE; the "secret" for installed apps is not confidential, but we use PKCE + loopback/device flow).

### Task 1.2: Google OAuth (device flow), mirrors `oauth.rs`
**Files:** Create `src-tauri/src/commands/mail/gmail/oauth.rs`.
- [ ] **Step 1:** Tests (wiremock) for `request_device_code` (`https://oauth2.googleapis.com/device/code`) and `poll_token` (`https://oauth2.googleapis.com/token`), asserting `authorization_pending`/`slow_down`/`access_denied`/`expired_token` mapping — mirror `oauth.rs` `TokenOutcome` exactly (reuse the same enum; consider moving `TokenOutcome` to `provider.rs` as shared).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement against Google endpoints (form fields: `client_id`, `scope`, `device_code`, `grant_type=urn:ietf:params:oauth:grant-type:device_code`). Reuse the `slow_down`/empty-token/timeouts hardening already in `oauth.rs`.
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit.

### Task 1.3: Gmail REST client, mirrors `graph.rs`
**Files:** Create `src-tauri/src/commands/mail/gmail/api.rs`.
- [ ] **Step 1:** Tests (wiremock): `list_labels` (`/gmail/v1/users/me/labels`), `list_message_ids` (`/users/me/messages?q=&pageToken=`), `get_message` (`/users/me/messages/{id}?format=full`), `history` (`/users/me/history?startHistoryId=`). Assert 429/`Retry-After` honored (reuse `retry_delay`, capped) and timeouts set.
- [ ] **Step 2:** FAIL → **Step 3:** implement with `reqwest` + bearer token (mirror `GraphClient`: capped retry, timeouts, no body leak to UI). **Step 4:** PASS. **Step 5:** Commit.

### Task 1.4: Gmail normalize → `MailMessage`
**Files:** Create `src-tauri/src/commands/mail/gmail/normalize.rs`.
- [ ] **Step 1:** Test: a sample Gmail `format=full` JSON (payload.headers for `From`/`To`/`Cc`/`Subject`/`Message-ID`/`Date`, `payload.parts` MIME body, `threadId`, `labelIds`) parses to a `MailMessage` with `provider="gmail"`, `thread_id=threadId`, `folders=labelIds`, `internet_message_id` from the `Message-ID` header, base64url body decoded, prefers `text/plain` then strips `text/html`.
- [ ] **Step 2:** FAIL → **Step 3:** implement `from_gmail(&Value) -> Option<MailMessage>` (walk MIME parts recursively; base64url-decode `body.data`). **Step 4:** PASS. **Step 5:** Commit.

### Task 1.5: `GmailProvider: MailProvider`
**Files:** Create `src-tauri/src/commands/mail/gmail/mod.rs`.
- [ ] **Step 1:** Test (wiremock): `list_folders` maps labels→`RemoteFolder`; `fetch_changes` with `Cursor::Backfill` pages through `messages.list`+`get`, returns `ChangePage` with `next` page token; with `Cursor::Resume(historyId)` uses `history.list` and emits `removed_ids` for `messagesDeleted`. Backfill completion stores the current `historyId` as the resume token (`done=true`).
- [ ] **Step 2:** FAIL → **Step 3:** implement. Cursor encoding: backfill page token vs `hist:{historyId}` (prefix-tagged string). **Step 4:** PASS. **Step 5:** Commit.

### Task 1.6: Wire Gmail into the command surface + live E2E harness
- [ ] Add `provider`/`account` to `mail_begin_login`/`mail_poll_login`/`mail_sync_all` (Phase 0.5 of cross-cutting below). Add an `#[ignore]`d `gmail_e2e.rs` mirroring `mail_e2e.rs` (manual run against a real test Gmail). Commit.

---

## Phase 2 — IMAP adapter (CASA-free; reaches Gmail via app-password)

**Outcome:** Any IMAP host (Gmail app-password, Fastmail, generic) connects and imports into the same encrypted store + index.

### Task 2.1: Dependencies
**Files:** Modify `Cargo.toml`.
- [ ] Add `async-imap = "0.10"` (tokio), `mail-parser = "0.9"`, `tokio-rustls` (TLS). Commit (`chore: imap deps`).

### Task 2.2: IMAP client wrapper
**Files:** Create `src-tauri/src/commands/mail/imap/client.rs`.
- [ ] **Step 1:** Tests against a local stub IMAP server (use `async-imap`'s test utilities or a greenmail-style fixture; if a real fixture is heavy, unit-test the pure helpers: UID-range builder, `UIDVALIDITY:lastUID` cursor parse/format, capability/auth selection). At minimum, fully unit-test the cursor + UID math; gate the live FETCH behind an `#[ignore]`d integration test like `mail_e2e.rs`.
- [ ] **Step 2:** FAIL → **Step 3:** implement: TLS connect (993), `LOGIN`/`AUTHENTICATE XOAUTH2`, `LIST` folders, `SELECT` (read `UIDVALIDITY` + `UIDNEXT`), `UID FETCH {range} (UID ENVELOPE BODY.PEEK[])`. Use `BODY.PEEK` (never set `\Seen`). **Step 4:** PASS. **Step 5:** Commit.

### Task 2.3: IMAP normalize (RFC822 → `MailMessage`)
**Files:** Create `src-tauri/src/commands/mail/imap/normalize.rs`.
- [ ] **Step 1:** Test: a raw RFC822 message parses (via `mail-parser`) to `MailMessage` with `internet_message_id` from `Message-ID`, `thread_id` derived from `References`/`In-Reply-To` (use the root `Message-ID` of the reference chain), `from`/`to`/`cc`/`subject`/`date`, text body (prefer text/plain, strip html), `folders=[mailbox_name]`, `provider="imap"`.
- [ ] **Step 2:** FAIL → **Step 3:** implement with `mail-parser`. **Step 4:** PASS. **Step 5:** Commit.

### Task 2.4: `ImapProvider: MailProvider`
**Files:** Create `src-tauri/src/commands/mail/imap/mod.rs`.
- [ ] **Step 1:** Test: `list_folders` from `LIST`; `fetch_changes` with `Cursor::Backfill` fetches all UIDs in pages; with `Cursor::Resume("UIDVALIDITY:lastUID")` fetches `UID > lastUID`; if `UIDVALIDITY` changed, returns a full re-backfill (and signals the caller to drop that folder's prior rows). Tombstones: optionally diff server UIDs vs stored (defer hard-delete detection to a later pass; document it).
- [ ] **Step 2:** FAIL → **Step 3:** implement. Cursor = `"{uidvalidity}:{max_uid_seen}"`. **Step 4:** PASS. **Step 5:** Commit.

### Task 2.5: IMAP credential capture + keychain
- [ ] Add `imap_connect(account, host, port, username, secret, auth_kind)` Tauri command that stores the secret in the OS keychain keyed `(imap, account)` and verifies the connection before saving. Never log the secret. Commit.

---

## Cross-cutting (do alongside Phase 0.5 / before first non-M365 sync)

### Task X.1: Multi-account store + cursors
**Files:** Modify `store.rs`.
- [ ] `MailRecord` gains `provider` + `account`; cursor table key becomes `(provider, account, folder)`; `id` dedupe stays by `internet_message_id` where present (cross-provider). Migration: additive columns (mirror the G4 nullable-column pattern). Tests for per-account cursor isolation. Commit.

### Task X.2: Command surface + multi-account sync
**Files:** Modify `mod.rs`.
- [ ] `mail_sync_all` iterates all configured accounts (each `(provider, account)`), building the right provider, calling `sync_folder_provider` per folder. Progress events carry `provider`/`account`. Keep the single-flight `SyncGuard`. Commit.

### Task X.3: Frontend — multi-provider connect UI
**Files:** Create `src/components/settings/MailAccounts.tsx`; modify `mail-commands.ts`, `mailStore.ts`, `useMailSync.ts`.
- [ ] Generalize `MailConnect.tsx` into an accounts list: "Add account" → choose Microsoft 365 / Gmail / IMAP. M365 + Gmail use the existing device-code flow component (parameterized by provider); IMAP shows a host/username/app-password form with provider-specific help links ("Generate a Google app password"). Light theme; honest copy; no em dashes. Reuse the hardened polling + error handling. Tests mirror `MailConnect.test.tsx`. Commit.

---

## Testing strategy
- **Unit (offline, CI):** every provider's oauth/api/normalize against wiremock + sample JSON/RFC822 fixtures; cursor/UID math; multi-account store isolation. These run in `cargo test --lib` and must stay green.
- **Live E2E (`#[ignore]`d, manual):** `gmail_e2e.rs`, `imap_e2e.rs` mirroring `mail_e2e.rs` — real account, real import, asserts encrypted blobs + searchable. Never in CI (needs secrets).
- **Regression gate after Phase 0:** full mail suite + `tsc -b` + `npm test` green, proving the M365 refactor changed nothing.
- **Encryption invariants:** reuse the existing `build_batch_mail` / `EncryptedMailStore` tests unchanged — providers must never bypass them (the `build_batch` `unreachable!()` guard stays).

## Out of scope (later phases)
- IDLE/push for IMAP (poll on open + manual refresh first).
- Reliable IMAP hard-delete (tombstone) detection (UID-diff pass later; document the gap).
- AI draft-replies / enrichment (Phase 4 of the master design).
- Gmail production CASA verification (Decision 1(C)) — separate operator track if pursued.

---

## Self-review notes
- **Spec coverage:** design doc §7 (normalized model, adapters, threading, Message-ID dedup, labels-as-tags) → Tasks 0.2, X.1, 1.4, 2.3. Gmail + IMAP adapters → Phases 1 + 2. Encryption reuse → unchanged store, asserted by regression gate.
- **Type consistency:** `MailProvider`/`Cursor`/`ChangePage`/`RemoteFolder` defined once in `provider.rs`; `TokenOutcome` shared from `oauth.rs`→`provider.rs`. `sync_folder_provider` is the single generic loop used by all providers.
- **Contingency:** Phase 1 (Gmail API) detail assumes Decision 1(B) "Testing mode". If Decision 1(A) "IMAP-only for Gmail" is chosen, Phase 1 is skipped and Gmail is reached through Phase 2 (app-password) — Phase 0 + 2 + cross-cutting still stand unchanged.

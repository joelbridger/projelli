# Wealthbox Connector — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only Wealthbox connector: an advisor pastes their Wealthbox API token, Keepance backfills their households/people/profile/notes into a durable local store, renders them to searchable RAG chunks, auto-creates one Matter per household, and the Client Map fills in — with clickable Wealthbox citations and a manual "Sync now."

**Architecture:** A CRM-specific, **object-level** sync engine (NOT a clone of the mail connector's folder-shaped provider trait). Pull each Wealthbox object type in bulk via `updated_since`, upsert into a durable encrypted SQLCipher store (`crm-enc.db`), compute affected households, render **granular per-object records + a household summary**, and index them as `source_type='crm'` RAG chunks under the household's `matter_id`. Reuse the mail connector's *infrastructure* (keychain, AES-GCM-at-rest, bounded-concurrency indexing, the `index_*_text_internal` delete-then-insert bridge, Tauri progress events) verbatim where possible.

**Tech Stack:** Rust (Tauri 2, rusqlite+SQLCipher, reqwest, LanceDB/Arrow, fastembed e5-small), TypeScript/React (Zustand, `@tauri-apps/api`).

## Global Constraints
- Worktree `feat/wealthbox-connector` @ `/home/jameson/keepance-wt-wealthbox` (based on `keepance-3.0`). All work here. **Hold the merge into `keepance-3.0` for Jameson's explicit go.**
- **Read-only**: no Wealthbox writes. Only GET endpoints.
- **Never rename `matter_id`.** `matter_id` + `privilege` are NON-NULL plaintext (LanceDB prefilter); always pass a real matter id or the `"unassigned"` sentinel. CRM privilege = `PRIVILEGE_NONE`.
- **Encrypt chunk text at rest** via `build_batch_*` + the vector-store master key (`rag::crypto::get_or_create_master_key`). Never write plaintext chunks.
- **Bound bulk-index concurrency** (semaphore cap 4) — the box is memory-tight; unbounded embedding tasks have crashed imports before.
- **Command boundary returns `Result<T, String>`**; use `anyhow` only internally; convert with `.map_err(|e| e.to_string())`.
- **Never leak raw Wealthbox response bodies to the UI** (PII) — log locally, return status-only errors.
- **NO em dashes in user-facing UI copy.** Light theme. Plain language.
- **Wealthbox API:** base `https://api.crmworkspace.com/v1`; auth header `ACCESS_TOKEN: <token>`; ~1 rps token-bucket + 429 backoff; collections `{ "<plural>": [...] }`; households are contacts `type=household` with nested `members[]`; notes come back under key `status_updates`; numeric ids resolved via `/v1/categories/{type}`, `/v1/users`, `/v1/teams`. Verify empirically: max `per_page`, exact `updated_since` format, plan-tier API gating, per-endpoint paging stability.
- **Sync continuously** with `keepance-3.0` (rebase/merge in frequently) so the eventual merge stays tiny.

---

## File structure (Phase 1)

**Backend — new module `src-tauri/src/commands/crm/`:**
- `mod.rs` — `#[tauri::command]` fns (`crm_connect`, `crm_is_connected`, `crm_disconnect`, `crm_sync_all`, `crm_cancel_sync`, `crm_sync_status`), `CrmState`, `manage_state`, keychain token helpers, `index_crm_text_internal` + `spawn_crm_rag_index`.
- `client.rs` — `WealthboxClient` (reqwest, `ACCESS_TOKEN` header, 1 rps limiter + 429 backoff, paged GET, id-resolver cache).
- `model.rs` — normalized structs (`WbContact`, `WbHousehold`, `WbNote`, `WbTask`, `WbEvent`, membership) + JSON parsing from Wealthbox payloads.
- `store.rs` — `CrmStore` (SQLCipher `crm-enc.db`): objects, hashes, membership, tombstones, per-object cursors, per-household render/index state.
- `engine.rs` — object-level backfill + delta sync; affected-household queue; calls `render` then `index_crm_text_internal`.
- `render.rs` — from `CrmStore`, render per-object records (`crm:contact:<id>`, `crm:note:<id>`, …) + a household summary (`crm:household:<id>`).

**Backend — edits to existing files:**
- `src-tauri/src/commands/rag/store.rs` — add `SourceType::Crm` arm to the exhaustive match (`~:516`); add `build_batch_crm` (clone `build_batch_mail` `:604`, hardcode `"crm"`); add `list_indexed_crm_paths` (clone `list_indexed_mail_paths` `:1399`, `only_if("source_type = 'crm'")`).
- `src-tauri/src/commands/mod.rs` — add `pub mod crm;`.
- `src-tauri/src/lib.rs` — register `commands::crm::*` in `generate_handler!` (`:111-149` block) + `commands::crm::manage_state(app);` (`:179`).

**Frontend — new files:**
- `src/features/settings/WealthboxConnect.tsx` (model: `MailConnect.tsx`).
- `src/platform/utils/wealthbox-commands.ts` (model: `mail-commands.ts`; defines `CRM_SYNC_EVENT='crm-sync-progress'`, `CrmSyncProgress`).
- `src/features/crm/useCrmSync.ts` + `crmStore.ts` (models: `useMailSync.ts`, `mailStore.ts`).

**Frontend — edits:**
- `src/platform/utils/tauri-commands.ts:115` — add `'crm'` to `RagHit.sourceType`.
- `src/platform/clientMap/types.ts` — add `'crm'` to `SourceRef.kind` (`:27`); extend `sourceRefFromRagHit` ternary (`:147`) so `sourceType==='crm' → kind:'crm'`.
- `src/platform/clientMap/openSource.ts` — add a `'crm'` branch in `dispatchOpenSource` (`:47`) dispatching `keepance:open-crm`; add a virtual viewer listener.
- `src/features/account/AccountWindow.tsx` — import + render `<WealthboxConnect />` in the `connections` tab (`:292-300`).
- `src/platform/types/matter.ts` — add `crmHouseholdKeys?: string[]`.
- `src/platform/matter/matterStore.ts` — add to `createMatter`/`CreateMatterInput`; add `addCrmHouseholdKey`/`removeCrmHouseholdKey`; bump `MATTERS_VERSION` 5→6 + `version<6` migrate block.
- Cosmetic label sites (add `'crm'`): `askHelpers.ts`, `renderingHelpers.tsx`, `legalAnalysis.ts`, `AIChatViewer.tsx` (Phase 1C polish).

---

## Sub-plan 1A — Ingestion pipeline core (NO external account needed)

*Goal: prove Wealthbox text → encrypted RAG chunk → matter-scoped retrieval, with `source_type='crm'`, fully via fixtures. This is the foundation 1B/1C build on. Inline execution is appropriate (tightly-coupled Rust that must compile as a unit); Codex-review the diff before committing.*

### Task 1A.1: `build_batch_crm` + the compile-gated `SourceType::Crm` arm
**Files:** Modify `src-tauri/src/commands/rag/store.rs`.
**Interfaces — Produces:** `pub fn build_batch_crm(rows: &[(Chunk, Vec<f32>)], key: &[u8; 32], matter_id: &str, privilege: &str) -> Result<RecordBatch>` (writes `source_type="crm"`).

- [ ] Add a `SourceType::Crm` variant to the enum (`store.rs:117-140`), mirroring `Mail` (unit variant; keeps `Copy`).
- [ ] Add the compile-gated arm in `build_batch`'s match (`store.rs:516-534`): `SourceType::Crm => unreachable!("crm chunks must use build_batch_crm, not build_batch"),`.
- [ ] Add `build_batch_crm` by cloning `build_batch_mail` (`store.rs:604-701`) verbatim, changing only: the `st_arr` literal `"mail"`→`"crm"` (the `:666` line), and the encrypt error messages. Keep `encrypt_with_key(c.text.as_bytes(), key)` + `hex::encode`, the 16-column order, `encrypted=true`, `validate_privilege`.
- [ ] (No standalone test yet — covered by 1A.3's fixture test.)
- [ ] Commit: `feat(rag): add SourceType::Crm + build_batch_crm`.

### Task 1A.2: `index_crm_text_internal` + `spawn_crm_rag_index`
**Files:** Create `src-tauri/src/commands/crm/mod.rs`; Modify `src-tauri/src/commands/mod.rs` (`pub mod crm;`).
**Interfaces — Consumes:** `build_batch_crm` (1A.1). **Produces:** `async fn index_crm_text_internal(workspace: &Path, source_id: &str, plaintext: &str, matter_id: &str) -> anyhow::Result<u32>` and `fn spawn_crm_rag_index(workspace: PathBuf, source_id: String, text: String, matter_id: String, enc_key: [u8;32])`.

- [ ] Create `commands/crm/mod.rs` with `index_crm_text_internal` cloned from `index_mail_text_internal` (`mail/mod.rs:1258-1324`): open store, `delete_path(&table, source_id, &key)`, `chunk_text(source_id, plaintext)`, `embed_documents_batched`, `build_batch_crm(&rows, &key, matter_id, PRIVILEGE_NONE)`, `table.add(...)`. `source_id` is pre-formatted `crm:<kind>:<id>` by the caller.
- [ ] Add `MAIL_INDEX_SEMAPHORE` analogue `CRM_INDEX_SEMAPHORE` (cap 4) + `spawn_crm_rag_index` cloned from `mail/mod.rs:1413,1420-1456` (reuse `rag::crypto::get_or_create_master_key` for `enc_key`).
- [ ] Add `pub mod crm;` to `commands/mod.rs:14` area.
- [ ] Commit: `feat(crm): add index_crm_text_internal + bounded spawn`.

### Task 1A.3: Fixture integration test (no model, no account)
**Files:** Create `src-tauri/tests/crm_fixture_import.rs`.
**Interfaces — Consumes:** `build_batch_crm`.

- [ ] Write the failing test, cloning `tests/mail_fixture_import.rs`: temp workspace, `open_connection`+`open_or_create_table`, index a fixture "client brief" via `build_batch_crm` with **fake vectors** `vec![0.1f32; EMBEDDING_DIM]` under source id `crm:household:demo-1` and a matter id; `store::nearest(...)`; assert the hit's `source_type == Some("crm")` and decrypted text round-trips. (NOT model-gated — uses fabricated vectors like the mail fixture test.)
- [ ] Run: `CARGO_TARGET_DIR=<warm> cargo test --test crm_fixture_import` → expect FAIL (compile error / missing fn) first, then PASS after 1A.1/1A.2 compile.
- [ ] Commit: `test(crm): fixture-prove crm chunks index + retrieve`.

### Task 1A.4: Frontend source-type wiring (citations + unions)
**Files:** Modify `tauri-commands.ts`, `clientMap/types.ts`, `clientMap/openSource.ts`.
- [ ] Add `'crm'` to `RagHit.sourceType` union (`tauri-commands.ts:115`).
- [ ] Add `'crm'` to `SourceRef.kind` (`clientMap/types.ts:27`); extend `sourceRefFromRagHit` (`:147`) to `hit.sourceType==='crm' ? 'crm' : (hit.sourceType==='mail' ? 'email' : 'document')`.
- [ ] Add a `'crm'` branch in `dispatchOpenSource` (`openSource.ts:47`) that dispatches `new CustomEvent('keepance:open-crm', { detail: { sourceId: ref.ref } })` (virtual viewer wired in 1C).
- [ ] Run: `npm run typecheck` (or `tsc --noEmit`) → expect PASS.
- [ ] Commit: `feat(clientmap): route crm source kind + open-crm event`.

**1A acceptance:** `cargo test --test crm_fixture_import` passes; typecheck passes; a `crm`-typed chunk is retrievable matter-scoped and would render in the Client Map. **Codex-review the 1A diff; then sync `keepance-3.0` in.**

---

## Sub-plan 1B — Wealthbox client + CRM store + object-level sync engine (needs trial token)

*Delegate as a bounded build (Codex or a subagent), built against fixtures first, then validated with a real Wealthbox trial token. Each task is independently testable.*

### Task 1B.1: `CrmStore` (SQLCipher `crm-enc.db`)
**Files:** Create `src-tauri/src/commands/crm/store.rs`.
- [ ] Clone the SQLCipher open/key/migrate pattern from `mail/store.rs:586-645` (PRAGMA key first, `busy_timeout`, idempotent `ALTER TABLE` migrations, `get_meta`/`set_meta`). Reuse `rag::crypto::get_or_create_master_key` (or a dedicated `keepance-crm-enc` keychain entry mirroring `mail/crypto.rs:15-16,60-83`).
- [ ] Tables: `crm_objects(id TEXT PRIMARY KEY, kind TEXT, household_id TEXT, updated_at TEXT, content_hash TEXT, json TEXT, deleted INTEGER DEFAULT 0)`; `crm_cursors(object_type TEXT PRIMARY KEY, cursor TEXT)`; `crm_render_state(household_id TEXT PRIMARY KEY, render_hash TEXT, indexed INTEGER DEFAULT 0)`; `meta(key,value)`. Upsert/get/list-by-household/tombstone helpers + unit tests (temp file, no model).
- [ ] Commit per helper group.

### Task 1B.2: `WealthboxClient` (reqwest + rate limit + id resolver)
**Files:** Create `src-tauri/src/commands/crm/client.rs`, `model.rs`.
- [ ] `WealthboxClient::new(token)` (reqwest client w/ timeouts, base `https://api.crmworkspace.com/v1`); `get_json(path, query)` using `.header("ACCESS_TOKEN", &token)` (model: `graph.rs:17-56` but custom header + 429/Retry-After backoff + ~1 rps token-bucket). Never log/return raw bodies.
- [ ] `me()` → workspace+plan (validate token); paged list helpers (`list_contacts(updated_since, type)`, `list_status_updates(...)`, `list_tasks`, `list_events`); `resolve_categories/users/teams` with an in-memory cache. Normalize JSON → `model.rs` structs (remember notes live under `status_updates`).
- [ ] Tests: parse fixtures (captured/synthetic JSON) into structs; a live-gated `#[ignore]` smoke test that runs only with `WEALTHBOX_TEST_TOKEN` set (mirrors the email live-smoke pattern). **Empirically verify** max `per_page`, `updated_since` format, paging stability here.

### Task 1B.3: object-level sync `engine.rs` + `render.rs`
**Files:** Create `src-tauri/src/commands/crm/engine.rs`, `render.rs`.
- [ ] `render.rs`: from `CrmStore`, produce per-object record text (`crm:contact:<id>`, `crm:note:<id>`, `crm:task:<id>`, `crm:event:<id>`) + a household summary (`crm:household:<id>`) — readable text, sensitive govt IDs omitted.
- [ ] `engine.rs`: `backfill(client, store)` + `delta(client, store)` — per object type, paged pull via overlapping `updated_since` timestamp windows + `(updated_at,id)` dedupe; upsert to store; compute affected households; for each, `render` then `spawn_crm_rag_index` per source id (clearing removed records' chunks). Single-flight + progress events (`crm-sync-progress`). Deletions: contacts via `deleted_since`; others via store-diff vs a periodic full id pull. Failure recovery: track render/index state; a `crm_backfill_rag` repair (clone `mail_backfill_rag` + `list_indexed_crm_paths`).
- [ ] Tests: a fixture firm (1 household, 2 people, notes) → engine → assert chunks exist + Client-Map retrieval; a delete → chunks gone.

### Task 1B.4: commands + keychain + state
**Files:** Modify `src-tauri/src/commands/crm/mod.rs`, `lib.rs`.
- [ ] `crm_connect(token)` (validate via `me()`, store in keychain `keepance-wealthbox`/`api-token`), `crm_is_connected`, `crm_disconnect`, `crm_sync_all(matterMap)`, `crm_cancel_sync`, `crm_sync_status`. `CrmState`+`manage_state`. Register all in `lib.rs`.
- [ ] Commit.

---

## Sub-plan 1C — Connect screen, household→matter mapping, citation viewer

*Delegate (Claude subagent or Codex). Frontend, mirrors the mail connector UI.*

### Task 1C.1: command bindings + sync hook/store
- [ ] `wealthbox-commands.ts` (clone `mail-commands.ts`): `crmConnect(token)`, `crmIsConnected`, `crmDisconnect`, `crmSyncAll(matterMap)`, `crmCancelSync`, `crmSyncStatus`; `CRM_SYNC_EVENT='crm-sync-progress'` + `CrmSyncProgress`.
- [ ] `useCrmSync.ts` + `crmStore.ts` (clone `useMailSync.ts`/`mailStore.ts`).

### Task 1C.2: `WealthboxConnect.tsx` + mount
- [ ] Clone `MailConnect.tsx`: paste-token field + "Test connection" (`crmConnect` → show workspace+plan) → "Connected ✓" + progress + "Sync now"/"Stop"/"Disconnect". **Onboarding copy:** "Keepance imports what this Wealthbox login can see." Light theme, no em dashes.
- [ ] Mount in `AccountWindow.tsx` connections tab (`:292-300`) + import.

### Task 1C.3: household → matter mapping + auto-create
- [ ] `matter.ts`: add `crmHouseholdKeys?: string[]`. `matterStore.ts`: `createMatter`/`CreateMatterInput` + `addCrmHouseholdKey`/`removeCrmHouseholdKey` + interface decls; bump `MATTERS_VERSION`→6 + `version<6` migrate block.
- [ ] On first sync, auto-create one Matter per household (named from household) and map `crmHouseholdKeys`; a `buildCrmMatterMap(getMatters())` helper (model: `buildMailMatterMap`) feeds `crmSyncAll`. Review/merge via `MatterManagerDialog.tsx`.

### Task 1C.4: virtual Wealthbox citation viewer
- [ ] A read-only panel/tab that listens for `keepance:open-crm` and shows the cited Wealthbox record (from `crm_get_record(sourceId)` reading `CrmStore`). Label citations "Wealthbox · <household/record>". Extend cosmetic label sites for `'crm'`.

**1C acceptance:** in the running app, paste a (trial) token → households appear as Client Maps → a Client Map cites a Wealthbox note → clicking it opens the record. Drive it via the Windows bench per the real-OS testing rule.

---

## Execution & verification protocol
- Build/test in the worktree against the **warm shared `CARGO_TARGET_DIR`** (one cargo compile at a time — coordinate; the box is memory-tight). Frontend: `npm run typecheck` + targeted vitest.
- **Codex-review each sub-plan's diff** before committing the sub-plan; act on findings.
- **Sync `keepance-3.0` in** after each sub-plan (`git -C ~/keepance fetch` then merge/rebase into the feature branch) to keep the eventual merge trivial.
- **Do NOT merge into `keepance-3.0`** until Jameson gives the go.
- Spin up a free Wealthbox 14-day trial + personal API token for 1B/1C real verification.

## Self-review notes
- Spec coverage: connect+validate (1B.4/1C.2), object-level backfill of households/people/profile/notes (1B), durable CRM store (1B.1), granular records + household summary (1B.3/render), `crm` chunks (1A), one Matter per household (1C.3), manual Sync now (1C.2), Client Map fills in (1A+1B), virtual citation viewer (1A.4+1C.4). ✅ Data breadth = core (skip opportunities/workflows/projects in v1). ✅
- Deferred to Phase 2 (per spec): scheduled cadence, full deletion-by-snapshot polish, user-facing import-scope control, tasks/events breadth toggles.
- Type consistency: `source_id` format `crm:<kind>:<id>`; `SourceType::Crm`→`"crm"` string→`RagHit.sourceType='crm'`→`SourceRef.kind='crm'`→`keepance:open-crm`. Consistent across tasks.

# Connector Program — Shared Foundation + 5-Connector Plan

**Status:** Foundation in progress (branch `feat/connector-foundation`, worktree `/home/jameson/kp-conn-foundation`, based on `keepance-3.0`)
**Date:** 2026-06-27
**Lead:** Claude (connector-program lead session). Coordinator does independent review + serial merges into `keepance-3.0`.
**Reuses:** the mail connector (`src-tauri/src/commands/mail/`) and the Wealthbox CRM connector (`src-tauri/src/commands/crm/`) + the Wealthbox design (`docs/superpowers/specs/2026-06-25-wealthbox-connector-design.md`).

---

## 0. Plain-language summary

Advisor Prep Hero already has two working "connectors" — bridges that pull a client's data out of an outside tool and into Advisor Prep Hero so it becomes searchable and shows up in the Client Map: one for **email** and one for the **Wealthbox** CRM. We're adding **five more** (OneDrive documents, DocuSign signed agreements, Redtail CRM, Calendly meetings, Salesforce). To build five at once without them stepping on each other, we first lay down a small shared "foundation" — the common wiring all five need — **once**, so each connector after that only adds its own self-contained piece and never edits the shared wiring. That's this branch.

---

## 1. What's reusable (verified against the code)

- **The "external text → searchable encrypted chunks" bridge.** `index_crm_text_internal` (`crm/mod.rs`) → `build_batch_crm` (`rag/store.rs`) → LanceDB. Deletes stale chunks for a `source_id` before re-inserting; encrypts text at rest; tags every chunk with `matter_id`. Connector-agnostic.
- **The durable encrypted local store** (`CrmStore`, SQLCipher `crm-enc.db`) — generic over object "kind"; holds raw records + content-hash + cursors + tombstones. Makes delta-sync + deletions correct.
- **The Client Map fills itself in.** It is NOT a datastore an adapter writes to — it's an AI-generated, source-cited profile derived from RAG retrieval scoped to one `matter_id` (`platform/clientMap/generator.ts`, 5 sections, TOP_K=8). A connector only writes matter-tagged chunks; the map lights up automatically. **No connector touches Client Map code.**
- **The Microsoft Graph login is reusable for OneDrive (verified).** Advisor Prep Hero's own multi-tenant public-client Azure app (`KEEPANCE_MS_CLIENT_ID` default `845ddba0-70ab-4f90-88ba-e3522157e37a`), full OAuth + refresh-token-in-keychain in `mail/oauth.rs` + `mail/mod.rs`, and a generic `GraphClient` (`mail/graph.rs`) that already does bearer auth + 429/Retry-After backoff against `https://graph.microsoft.com`. OneDrive = add a scope + new Graph paths, NOT a new OAuth flow.

### The honest gap
The CRM connector's *plumbing* is reusable, but its *outer layer* is hardcoded to Wealthbox: the command layer instantiates `WealthboxClient` directly, the keychain slot is the literal string `keepance-wealthbox`, the models are `Wb*`, and there is **no provider-selection layer and no connector registry**. So Redtail/Salesforce can't "drop in" yet — that's what the CRM provider-ization (§3) fixes.

---

## 2. Foundation Part A — additive shared layer (SAFE, zero demo risk)

Purely additive. Does **not** modify the working mail or CRM code paths. After this lands, OneDrive / DocuSign / Calendly add only their own module + register append-only.

### A1. Rust — generic external RAG bridge (new shared module)
New file `src-tauri/src/commands/connector/mod.rs` (registered `pub mod connector;` in `src-tauri/src/commands/mod.rs`):
- `pub async fn index_external_text_internal(workspace: &Path, source_id: &str, plaintext: &str, matter_id: &str, source_type: &str) -> anyhow::Result<u32>` — a parameterized clone of `crm/mod.rs::index_crm_text_internal`: delete stale chunks for `source_id`, embed, then call the new `build_batch_external`. `source_type` is the connector's string id ("onedrive" | "esign" | "meeting" | ...).
- `pub fn spawn_external_rag_index(workspace: PathBuf, source_id: String, text: String, matter_id: String, source_type: String)` — bounded-concurrency (semaphore cap 4) fire-and-forget wrapper, cloned from `spawn_crm_rag_index`.

New function in `src-tauri/src/commands/rag/store.rs`:
- `pub fn build_batch_external(rows, key, matter_id, privilege, source_type: &str) -> Result<RecordBatch>` — an exact structural clone of `build_batch_crm` but writing `source_type` from the parameter instead of the literal `"crm"`. Validate `source_type` against an allowlist constant (`text|pdf|mail|docx|rtf|xlsx|pptx|transcript|crm|onedrive|esign|meeting`) so a typo can't silently create an un-citable kind. **Do NOT modify `build_batch_mail` / `build_batch_crm`.**
- Ensure the disconnect/purge path can delete by these new `source_type` strings (extend the existing `delete_by_source_type`/`delete_source_type` helper's accepted set if it validates; if it takes a free string, no change needed — confirm in code).

> Note: new connectors do **NOT** add `SourceType` enum variants — that enum drives the typed file-extraction path only; external connectors write the `source_type` *string* via `build_batch_external`. Keeps the enum closed and untouched.

### A2. Frontend — pre-stage every new record kind ONCE
- **The three duplicated `RagHit.sourceType` unions** — add `'onedrive' | 'esign' | 'meeting'` to each (keep existing members):
  - `src/platform/utils/tauri-commands.ts:115`
  - `src/platform/types/ai.ts:154`
  - `src/features/workflows/engine/legalAnalysis.ts:42`
- **`SourceRef.kind`** (`src/platform/clientMap/types.ts:28`) — extend `'document'|'email'|'crm'` to also include `'onedrive'|'esign'|'meeting'`.
- **`sourceRefFromRagHit`** (`src/platform/clientMap/types.ts:147`) — map `onedrive→'onedrive'`, `esign→'esign'`, `meeting→'meeting'` (crm→'crm', mail→'email', else 'document' unchanged).
- **Citation viewer routing** (`src/platform/clientMap/openSource.ts`, `dispatchOpenSource` ~L48) — add `OPEN_ONEDRIVE_EVENT`, `OPEN_ESIGN_EVENT`, `OPEN_MEETING_EVENT` constants + a dispatch branch each (mirroring `OPEN_CRM_EVENT`). The per-connector branch adds the actual listener component.
- **Citation labels** — extend the `switch (sourceType)` blocks that build human labels so the new kinds get sensible labels ("OneDrive · <file>", "DocuSign · <agreement>", "Calendly · <meeting>"): `src/features/ask/askHelpers.ts`, `src/features/ask/renderingHelpers.tsx`, `legalAnalysis.ts`.

### A3. Frontend — Matter mapping field slots (avoid `matter.ts` conflicts)
- `src/platform/types/matter.ts` — add optional fields mirroring `crmHouseholdKeys` / `mailFolderPaths`: `onedriveFolderKeys?: string[]`, `esignKeys?: string[]`, `meetingKeys?: string[]`. (Redtail + Salesforce REUSE the existing `crmHouseholdKeys`.)
- `src/platform/rag/matterResolver.ts` — add `buildOneDriveMatterMap` / `buildEsignMatterMap` / `buildMeetingMatterMap` helper shells mirroring `buildCrmMatterMap`; the per-connector branch fills in the real mapping rule.
- Bump the matter-store persist version + add a no-op migration if the existing pattern requires it (follow the `crmHouseholdKeys` precedent / the v5→v6 migration tested in `tests/unit/crm/crmMatterMap.test.ts`).

### A4. Checks for Part A
`npm run typecheck` green; `cargo test -p <tauri crate>` green (the new `build_batch_external` gets a unit test mirroring the crm batch test + a `crm_fixture_import`-style round-trip for one new source_type, e.g. `esign`). Add a Vitest for `sourceRefFromRagHit` covering the three new kinds.

---

## 3. Foundation Part B — CRM provider-ization (RISKY: touches the demo's Wealthbox path — FLAGGED to coordinator)

Goal: make Wealthbox / Redtail / Salesforce each a thin "client + record-normalizer" plugged into ONE neutral CRM core, so Redtail and Salesforce branches ADD a small adapter file and register a provider (append-only) instead of cloning ~600 lines each.

- Introduce a `CrmProvider` selector + provider-scoped keychain (`keepance-crm-<provider>` instead of the literal `keepance-wealthbox`; keep a back-compat read of the old slot so existing Wealthbox users don't have to reconnect).
- Make the command layer (`crm/commands.rs`) take a `provider` argument and dispatch to the right client, instead of hardcoding `WealthboxClient`.
- Keep the engine/store/render operating on the existing neutral-enough shapes; rename `Wb*` → neutral `Crm*` **only** if it stays behavior-identical. Wealthbox stays the first registered provider.
- **Safety net:** the existing Wealthbox suite (`crm/engine.rs` `FakeCrmSource` tests, `crm/store.rs` tests, `crm/commands.rs` pure-logic tests, `tests/crm_fixture_import.rs`) must stay 100% green; then a **Codex review** of the diff; then a **Legion smoke test** that the live Wealthbox connector still imports a book end-to-end.
- **Recommendation: do it** (robust, no duplication, matches the Wealthbox design's "another adapter, not a rebuild"). Lower-risk alternative if the coordinator prefers: leave Wealthbox untouched and let Redtail/Salesforce clone the CRM module (more duplicated code, zero Wealthbox risk).
- Part B is independent of the two lead connectors (OneDrive/DocuSign/Calendly don't need it), so it lands right behind Part A, before Redtail/Salesforce need it.

---

## 4. The 5 connectors

Each lives in its **own** module/dir + its own UI components, branched off `feat/connector-foundation`. They register append-only in `src-tauri/src/lib.rs` (`invoke_handler!` + `manage_state`) — the one unavoidable shared file; serial merges by the coordinator make these trivial.

| Connector | Worktree / branch | Auth | Shape | Client-Map kind | Entity mapping |
|---|---|---|---|---|---|
| **OneDrive / SharePoint** | `kp-conn-onedrive` / `feat/connector-onedrive` | MS Graph OAuth (reuse app `845ddba0…`; **own scope string + keychain slot**: add `Files.Read.All`/`Sites.Read.All`) | file/folder | `onedrive` | files → matter by OneDrive folder (`onedriveFolderKeys`); content reuses existing docx/pdf/xlsx extractors |
| **DocuSign** | `kp-conn-docusign` / `feat/connector-docusign` | self-serve dev sandbox; JWT or Auth-Code OAuth; paste-key style | object (envelopes + recipients + audit events) | `esign` | envelopes → matter by recipient/client name match (`esignKeys`); signed PDF reuses pdf extraction |
| **Redtail CRM** | `kp-conn-redtail` / `feat/connector-redtail` | **vendor/partner API key (GATEKEEPER)** + advisor username/password Basic auth | object (households/contacts/notes/activities) | reuse `crm` | reuse `crmHouseholdKeys` + `buildCrmMatterMap`; new client + normalizer into CRM core (Part B) |
| **Calendly** | `kp-conn-calendly` / `feat/connector-calendly` | self-serve Personal Access Token (paste-key) | object (scheduled events + invitee Q&A) | `meeting` | meetings → matter by invitee match (`meetingKeys`) |
| **Salesforce FSC** | `kp-conn-salesforce` / `feat/connector-salesforce` | self-serve dev org; OAuth | object (SOQL over Account/Contact/relationships) | reuse `crm` | v1 scope: Households(Account)→Contacts→relationships → matter via `crmHouseholdKeys`; defer holdings/portfolio |

### Per-connector v1 representation (mirror Wealthbox §5.3)
Index **granular per-object records** (`<ns>:<kind>:<id>`) + a concise per-matter summary, both matter-tagged, because Client Map keeps only TOP_K=8 per query — granular retrieves + cites better than one blob.

### Lead order
1. **OneDrive** + **DocuSign** first (we control the timeline; both self-serve; live-testable now).
2. **Calendly** close behind (self-serve PAT).
3. **Redtail** built fully now against the published API with a mocked source; live-tested when the vendor key lands.
4. **Salesforce FSC** last (deepest data model; scoped subset first).

---

## 5. Merge-conflict strategy

Pre-staging (Parts A/B) removes every painful semantic conflict. Remaining shared touch-point: `src-tauri/src/lib.rs` (each connector registers ~6 commands + state). It's append-only; the coordinator merges connectors serially, so each merge is a trivial add. No two connector branches edit the same shared logic.

---

## 6. Landmines (honor exactly)
- **Never rename `matter_id` / `Matter`.** `matter_id` + `privilege` are NON-NULL plaintext (LanceDB isolation prefilter). Pass a real id or the `"unassigned"` sentinel into `index_external_text_internal`.
- **Never invent a Client/Household/Account entity** — everything maps onto the existing `Matter`.
- Chunk text must be encrypted via `build_batch_*` (never write plaintext chunks). Cap bulk indexing concurrency. Respect Local-only mode (egress guard covers connector-derived content — client PII is Reg S-P data).
- Real connectors today = files / email / Wealthbox. **Advisor Prep Hero is NOT SOC 2 certified** — no connector copy may imply a security certification we don't hold. Keep the "coming soon" integration logo grid honest.

---

## 7. Open items flagged to coordinator
- **CRM provider-ization (Part B)** touches the demo's Wealthbox path — recommend doing it behind the test net; coordinator may prefer the clone alternative.
- **Redtail vendor key** — apply at `corporate.redtailtechnology.com/api` (Redtail/Orion partner program). Likely needs Advisor Prep Hero company/product info + a business contact (probably Jameson) + read-only use statement. Lead will draft the application text; live-test when granted.
- **OneDrive Azure change** — add `Files.Read.All` (+ `Sites.Read.All` for SharePoint) delegated permission to the existing Advisor Prep Hero Azure app `845ddba0…` (one-time admin/Jameson click).
- **Salesforce FSC scope** — confirm exact v1 object subset once in the dev org.

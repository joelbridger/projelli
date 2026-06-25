# Wealthbox → Keepance Connector — Research & Design

**Status:** Design (research complete; awaiting final scope sign-off before plan/implementation)
**Date:** 2026-06-25
**Author:** Claude (senior staff engineer session), for Jameson
**Branch / worktree:** `feat/wealthbox-connector` @ `/home/jameson/keepance-wt-wealthbox` (isolated; based on `keepance-3.0`)

---

## 0. Plain-language summary (read this first)

We're building a **connector** — a bridge — that pulls a financial advisor's client and family information **out of Wealthbox** (a popular CRM/contact database built for advisors) **into Keepance**, drops it into each client's **Client Map**, makes it **searchable**, and then **keeps it fresh** by checking back on a schedule.

**Two decisions are locked:**
- **Read-only, one-way.** Wealthbox stays the source of truth. Keepance only *reads* a copy; it never changes anything in Wealthbox. Zero risk of corrupting an advisor's live records.
- **"Paste-a-key" first.** The advisor copies a secret access key from their Wealthbox settings and pastes it into Keepance once. This works *today* with no waiting. Later we add the polished one-click "Connect with Wealthbox" button (which requires becoming an official Wealthbox partner — a slower, approval-gated path). The connector is designed so that button slots in behind the same machinery without a rewrite.

**The core idea that makes this elegant:** Keepance's Client Map already builds itself by reading *text* about a client and pulling out the people, the money picture, and the story. So instead of inventing a whole new data system, the connector turns each Wealthbox household into a clean, readable **"client brief"** (a synthesized text profile), feeds that into Keepance's existing search/index, and the Client Map lights up **automatically** — no changes to the Client Map itself.

**Four honest limits of Wealthbox** we design around: (1) no instant change-alerts, so we poll on a schedule; (2) no file/document downloads through the API; (3) no live investment-account balances (only what the advisor typed in); (4) a tight speed limit (~1 request/second), so the first big import takes a little while but staying in sync afterward is cheap.

---

## 1. Goal & scope

### Goal
Let an advisor connect their Wealthbox account so that **every household/client and the knowledge attached to them** (people, relationships, financial profile, key dates, notes, upcoming meetings/tasks) appears inside Keepance — integrated into the **Client Map**, **searchable** via Ask/RAG, and **kept up to date** on a regular cadence.

### In scope (v1)
- Read-only, one-way sync from Wealthbox via its public REST API (`https://api.crmworkspace.com/v1`).
- "Paste-a-key" auth (Wealthbox **Personal API Access Token**), stored in the OS keychain.
- Pull the **client-knowledge core**: households + member people (+ trusts/orgs in a household), their full contact/financial/relationship profile, notes, tasks, events. (Exact breadth = the one open product decision, §8.)
- Render each household into a synthesized, source-cited **client brief** and index it as matter-scoped RAG chunks → flows into the Client Map + search.
- Initial full backfill + **delta sync** (`updated_since`) on a cadence, with manual "Sync now."
- Map **one Wealthbox household → one Keepance Matter** (the advisor's "client/household" unit).

### Out of scope (v1 — explicitly deferred)
- Writing anything back to Wealthbox (no two-way).
- One-click OAuth "Connect with Wealthbox" button + Wealthbox partner listing (Phase 3; partner application can start in parallel).
- Document/file binaries (the API can't provide them).
- Live AUM/brokerage balances (not in the API).
- Other CRMs (Redtail, Salesforce FSC). The provider abstraction is built so they *could* be added later, but they are not a v1 goal.

---

## 2. Decisions locked (and why)

| Decision | Choice | Why |
|---|---|---|
| Sync direction | **Read-only, one-way** | Safety (never corrupt a live CRM), simplicity, matches the ask. |
| Auth method (v1) | **Paste Personal API Token** | Ships immediately; no dependency on Wealthbox partner approval. Good for first pilot advisors. |
| Auth method (later) | **OAuth 2.0 one-click** (Phase 3) | Polished UX + marketplace listing, but gated behind manual Wealthbox partner onboarding (email → build → demo → approve). |
| Architecture pattern | **Mirror the existing mail connector** | Keepance already has a proven provider/sync/index pattern for external data (M365/Gmail/IMAP). Reuse it, don't reinvent. |
| Client unit | **Household → Matter** (one matter per household; per-person matter for unhouseholded individual clients) | Matches the advisor pivot's "client/household" unit; `matter_id` is the locked isolation key. |
| Workspace isolation | **Dedicated worktree `feat/wealthbox-connector`** | Three other sessions are actively building Keepance; never collide. |

---

## 3. Wealthbox research (what it is & how it works)

> Verified against the official API reference at **https://dev.wealthbox.com/** (raw HTML downloaded and checked directly). Full long-form report: `scratchpad/wealthbox-research.md` in the session, and the published report (link in the project memory).

### 3.1 What Wealthbox is
A cloud CRM built specifically for financial advisors / RIAs (Starburst Labs, 2014). #2 advisor CRM by usage and fastest-growing (behind Redtail; Salesforce FSC dominates enterprise). Known for a modern, "activity-stream" UX. Wealth-management-specific data model: households, self-reported financial-profile fields, compliance dates (ADV/CRS).

### 3.2 Data model — the important part
**Everything hangs off a Contact.** `contact.type` ∈ `person | household | organization | trust`.

**Households = "families".** A household is itself a contact (`type=household`) with its own id and name (e.g. "The Andersons"). Each person's record carries a nested `household` object: `{ name, title, id, members[] }`; each member is `{ id, first_name, last_name, title, type }`. Household **titles** (the family role): `Head, Spouse, Partner, Child, Grandchild, Parent, Grandparent, Sibling, Other Dependent`. A household can group people, trusts, and organizations.
- To reconstruct a family: list `type=household` contacts → read each household's `members[]` → fetch each member contact for full detail. (Membership is managed via `POST/DELETE /v1/households/{id}/members` — irrelevant for read-only.)

**A Contact carries a lot inline** (high-value for the Client Map):
- **Identity:** name parts, nickname, gender, maiden name, birth place, company, job title, occupation, image.
- **Dates:** `birth_date`, `anniversary`, `client_since`, `date_of_death`, `retirement_date`.
- **Classification:** `contact_type` (Client/Prospect/…), `status`, `marital_status`, `assigned_to` (advisor), `referred_by`, free-text `background_information`, `important_information`, `personal_interests`.
- **Investment profile:** `investment_objective`, `time_horizon`, `risk_tolerance`, experience years.
- **Financial profile (self-reported, NOT live balances):** `gross_annual_income`, `assets`, `non_liquid_assets`, `liabilities`, `adjusted_gross_income`, `estimated_taxes`, `tax_year`, `tax_bracket`.
- **Compliance dates:** `signed_fee_agreement_date`, `last_adv_offering_date`, `initial_crs_offering_date`, `last_privacy_offering_date`, etc.
- **Sensitive IDs (handle with care):** `passport_number`, `green_card_number`, `drivers_license`.
- **Professional relationships (each a contact id):** `attorney`, `cpa`, `doctor`, `insurance`, `business_manager`, `family_officer`, `assistant`, `trusted_contact`.
- **Arrays:** `street_addresses[]`, `email_addresses[]`, `phone_numbers[]`, `websites[]`.
- **Nested:** `household`, `tags[]`, `custom_fields[]`, `contact_roles[]` (e.g. "Planning Advisor").

**Other objects** (all readable, all support `updated_since`): **Notes** (returned under JSON key `status_updates`!), **Tasks** (with subtasks), **Events** (calendar), **Opportunities** (sales pipeline), **Projects**, **Workflows** (+ read-only templates), **Comments**, **Activity Stream** (`/v1/activity`, HTML timeline items), plus definition endpoints for **Custom Fields / Tags / Categories / Users / Teams** (needed to translate numeric ids like `stage:1` into labels).

**Not available via API:** document/file binaries, live investment/AUM accounts (only the self-reported fields), synced email bodies.

### 3.3 API essentials
- **Base:** `https://api.crmworkspace.com/v1`. Version `v1` (stable). JSON. Collections return `{ "<plural>": [...] }`.
- **Auth (v1 for us):** Personal API Token via header **`ACCESS_TOKEN: <token>`**. (OAuth later uses `AUTHORIZATION: Bearer <token>`; access token 2 h, refresh 90 d; scopes only `login`/`data`, all-or-nothing.)
- **Pagination:** page-based — `per_page` (default 25) + `page` (default 1). Max `per_page` **undocumented — must test**. **Collections unordered by default → always pass `order`** (e.g. `updated`) for stable paging.
- **Filtering:** strong on contacts — `type`, `contact_type`, `household_title`, `updated_since`, `updated_before`, `deleted`, `deleted_since`, `active`, `tags`, `external_unique_id`, etc. Other list endpoints take `resource_id`+`resource_type` and `updated_since`.
- **No `include`/expand** — related records are embedded inline (household/tags/custom_fields/addresses), but numeric id refs (assigned_to, stage, category) must be resolved via categories/users/teams endpoints.
- **Status codes:** `202` = 2FA required, `402` = trial expired, `403` = no permission, `429` = rate limited.

### 3.4 Incremental sync, deletions, real-time
- **`updated_since`/`updated_before` are first-class** on every object we care about → the backbone of delta sync. ⚠️ Timestamps come back in a **non-ISO format** (`"2015-05-24 10:00 AM -0400"`); the exact format `updated_since` accepts is **unconfirmed — test ISO-8601 and native; store/compare UTC.**
- **Deletions are uneven:** **Contacts** have real tombstones (`deleted=true`, `deleted_since=<ts>`). **Every other object has no deletion feed** → detect deletes by periodic **full ID snapshot + diff**.
- **No native webhooks.** (Third-party "Wealthbox webhook" guides are AI-generated and describe endpoints that don't exist.) **Polling is mandatory.**

### 3.5 Limits & operational
- **Rate limit ~1 req/sec** averaged over 5 min (~3,600/hr), bursts tolerated, `429` on exceed → token-bucket limiter at ~1 rps + backoff + checkpoint/resume.
- **Big books (10k+ contacts):** prefer **object-level bulk pulls with `updated_since`** over per-contact fan-out; push `per_page` high. Initial backfill of a large firm takes minutes-to-longer; must be resumable.
- **Per-user visibility (biggest real-world risk):** a token sees only what *that user* can see — `Private`/group-scoped records won't appear, and admin ≠ full visibility. For solo/pilot advisors (their own token) this is fine; for firms, surface "connect as a full-visibility user."
- **Pricing/tier gating:** plans Basic $59 → Enterprise. Personal API tokens appear broadly available; **whether any tier disables API access is unconfirmed — verify.**
- **No sandbox tenant** — use a 14-day trial workspace + a personal token for dev/test.

### 3.6 Three things to verify empirically (quick live probes with a trial token)
1. Max `per_page`.
2. Exact `updated_since` timestamp format accepted.
3. Whether any plan tier blocks API access.

---

## 4. Keepance architecture (where this plugs in)

> Read-only exploration of `keepance-3.0`. Full map: `scratchpad/keepance-map.md`.

### 4.1 Stack & data stores
- `src/` = TS/React frontend (5-layer DAG: lib ← ui ← platform ← features ← app). `src-tauri/` = Rust backend (Tauri 2, `#[tauri::command]`, registered in `src-tauri/src/lib.rs`). `backend/` = separate firm E2EE relay (not for a local connector).
- **RAG vectors:** LanceDB at `<ws>/.keepance/vectors/` (`chunks` table), embeddings via fastembed **e5-small (384-dim)**, native Rust (`src-tauri/src/commands/rag/`).
- **Mail metadata + resume cursors:** SQLCipher at `<ws>/.keepance/mail.db`.
- **App/UI state:** Zustand + localStorage (Matters, Client Maps). No general SQL DB.
- **Secrets:** OS keychain via `keyring` crate (`com.keepance.*`).

### 4.2 The Client Map (the integration target)
- **Not a datastore — a per-matter, AI-built, source-cited profile *derived from RAG retrieval*** scoped to one `matter_id`, persisted as small JSON in localStorage (`keepance:client-maps`). Code: `src/platform/clientMap/` + UI `src/features/matters/`.
- **5 core sections** (`generator.ts` `buildClientMap()`): `story`, `people` (household members, spouse, children, beneficiaries, CPA, attorney), `standing` (accounts, assets, liabilities, net worth, custodian, risk), `upcoming`, `next`. Each runs a fixed semantic query against `MemoryService.retrieve(query, topK=8, {kind:'matter', matterId})` → AI writes cited bullets.
- **⇒ Anything we want in the Client Map must become matter-tagged RAG chunks.** The people/standing/story queries already look for exactly the household/financial/relationship language Wealthbox provides.

### 4.3 The Matter = the client unit (no separate Client/Household entity)
- `matter_id` (`matter_<uuid>`) is the confidentiality/isolation key threaded everywhere — **LOCKED, never rename** (ARCHITECTURE.md L80-83). `Matter` type: `src/platform/types/matter.ts`. Store: `src/platform/matter/matterStore.ts`.
- A "household"/"client" is a Matter with cosmetic profession labeling (`useEntityLabel.ts` → advisor: one='client', group='household'). People & accounts are **not structured records** — they surface as AI-extracted text inside Client Map sections.
- **⇒ One Wealthbox household → one Keepance Matter. Members/notes/events → indexed text under that `matter_id` → Client Map fills in automatically.**

### 4.4 Search & indexing (RAG)
- `chunks` table (`rag/store.rs` `build_schema()`): `id, path(HMAC token), matter_id (NOT NULL, plaintext prefilter), source_id (NOT NULL), paragraph_index, text (AES-256-GCM at rest), vector[384], source_type, page_number, encrypted, privilege (NOT NULL: none|attorney-client|work-product), locator, path_enc`.
- `matter_id` + `privilege` stay plaintext on purpose (LanceDB **prefilter** for isolation before vector search). Everything else encrypted at rest.
- **`SourceType` enum** (`store.rs`): `Text, Pdf, Mail, Docx, Rtf, Xlsx, Pptx, Transcript` → **add `Crm`** for us.
- Ingestion wiring: `src/platform/hooks/useMemoryWiring.ts`; retrieval API: `src/platform/rag/MemoryService.ts`.

### 4.5 The mail connector = our template (proven external-data pattern)
- **Provider trait** (`src-tauri/src/commands/mail/provider.rs`):
  ```rust
  #[async_trait] pub trait MailProvider {
    fn kind(&self) -> &'static str;
    async fn list_folders(&self) -> Result<Vec<RemoteFolder>>;
    async fn fetch_changes(&self, folder: &RemoteFolder, cursor: &Cursor) -> Result<ChangePage>;
  }
  pub enum Cursor { Backfill, Resume(String) }
  pub struct ChangePage { messages, removed_ids, next: Option<String>, done: bool }
  ```
- **Sync orchestration** (`mail/sync.rs` `sync_folder_provider`): provider-agnostic loop — fetch_changes → persist resume cursor per folder → apply.
- **Ingestion→RAG bridge** (`mail/mod.rs` `index_mail_text_internal(ws, "mail:<id>", text, matter_id)`): the single function that turns external text into chunks (`store::build_batch_mail`). `spawn_mail_rag_index` = fire-and-forget with a **concurrency semaphore cap 4** (avoids OOM on bulk import — the box is memory-tight).
- **OAuth + keychain** (`mail/oauth.rs`, `mail/gmail/oauth.rs`): loopback-PKCE; refresh token in keychain; `fresh_access_token()` before each section. We mirror this in Phase 3.
- **Connect UI**: `src/features/settings/MailConnect.tsx`; bindings `src/platform/utils/mail-commands.ts`.
- **Cadence:** there is **no scheduler** today — mail sync is manual/on-connect. We add cadence ourselves (a `setInterval` lifecycle hook mirroring the `App.tsx` heartbeat, or a Tokio interval). Delta cursors make repeats cheap.

---

## 5. Proposed connector design

### 5.1 Shape (mirror mail, add a CRM provider)
**Backend `src-tauri/src/commands/crm/`** (new module, registered in `lib.rs`):
- `provider.rs` — a `CrmProvider` trait mirroring `MailProvider`: `kind()`, `list_households()` (≈ list_folders), `fetch_changes(scope, cursor)`. Same `Cursor`/`ChangePage` shapes.
- `wealthbox/mod.rs` — `WealthboxProvider`: calls `api.crmworkspace.com/v1` via `tauri_plugin_http`/`commands/http.rs`, with a **~1 rps token-bucket limiter + 429 backoff**. Resolves & caches categories/users/teams to translate numeric ids.
- `dossier.rs` — **the renderer**: turns a household + its members + linked notes/tasks/events into a clean, readable **client brief** (Markdown-ish text) with stable internal anchors for citations. *(This is the key elegance — see §5.3.)*
- `index.rs` — `index_crm_text_internal(ws, "crm:wealthbox:<householdId>", brief_text, matter_id)` cloned from `index_mail_text_internal`, calling a new `store::build_batch_crm` (`source_type='crm'`, `privilege='none'`). Reuse the bounded-concurrency semaphore for backfill.
- `sync.rs` + command `crm_sync_all` — clone `sync_folder_provider`; persist **per-household delta cursors** + last-sync timestamps in a small SQLCipher table (clone `folder_cursors`/`meta`). Stream progress via a `crm-sync-progress` Tauri event.
- **Token storage:** `keyring::Entry` under a new service `com.keepance.wealthbox` (key = the pasted token). Validate on save via `GET /v1/me`.

**Frontend:**
- `src/features/settings/WealthboxConnect.tsx` (clone `MailConnect.tsx`): paste-token field with clear steps + "Test connection" (`GET /v1/me` → show workspace name + plan) → "Connected ✓" → kick off `wealthboxSyncAll(map)`.
- `src/platform/utils/wealthbox-commands.ts` (clone `mail-commands.ts`).
- **Household↔Matter mapping:** add `crmHouseholdKeys?: string[]` to `Matter` (mirroring `mailFolderPaths`) + a helper mirroring `buildMailMatterMap`. Mapping/review UI reuses `MatterManagerDialog.tsx`. **Do not invent a Household entity** — map to a Matter; `useEntityLabel` shows the word "Household."
- **Cadence:** a lifecycle hook `setInterval` → `wealthboxSyncAll` (default cadence in §8) + a manual "Sync now."

**Schema touch-points (small, additive):** `SourceType::Crm` (`store.rs`); `RagHit.sourceType` union (`tauri-commands.ts`) + `SourceRef.kind` (`clientMap/types.ts`, add `'crm'`) so citations render as "from Wealthbox."

### 5.2 Data flow (end to end)
```
Wealthbox REST (api.crmworkspace.com/v1, ACCESS_TOKEN header, ~1 rps)
   │  bulk pull per object with updated_since (contacts incl. households, notes/status_updates, tasks, events, …)
   │  resolve numeric ids via cached categories/users/teams
   ▼
Normalize + group by household  →  dossier.rs renders a per-household "client brief" (readable text + citation anchors)
   ▼
index_crm_text_internal(ws, "crm:wealthbox:<id>", brief, matter_id)  →  build_batch_crm  →  LanceDB chunks
   (matter_id = the household's Matter; source_type='crm'; encrypted at rest; bounded concurrency)
   ▼
Client Map generator (unchanged) retrieves matter-scoped chunks → people / standing / story / upcoming / next
   ▼
Searchable in Ask/RAG; citations show "Wealthbox · <household>"
```

### 5.3 Key idea — the "client brief" (dossier) renderer
Rather than forcing Wealthbox's structured fields into a new structured schema, **synthesize a readable brief per household** and let Keepance's existing text-understanding do the rest. Example shape:

> **The Anderson Household** — Clients since 2016.
> **People:** John Anderson (Head, b. 1968, retiring 2030, Growth objective, Moderate risk). Jane Anderson (Spouse, b. 1971). Emma Anderson (Child, b. 2004).
> **Financial profile (self-reported):** Assets ~$2.4M; liabilities ~$300k; gross income ~$420k; tax bracket 35%.
> **Professional team:** Attorney — Maria Reyes; CPA — David Lin.
> **Key dates:** Last ADV offering 2025-03; review anniversary March.
> **Recent notes:** [most recent advisor notes, dated] …
> **Upcoming:** Annual review meeting 2026-07-14; task "send updated IPS" due 2026-07-01.

Why this is the right call:
- It maps **directly** onto the Client Map's `people` / `standing` / `story` / `upcoming` sections with **zero Client Map changes**.
- It's human-readable, so search results and citations are meaningful.
- It's robust to Wealthbox quirks (numeric ids resolved to labels; notes under `status_updates`; missing fields just omitted).
- Updating = re-render the brief and re-index that one household (cheap; mirrors how mail re-indexes a message).

**Storage choice:** index as **virtual `crm:<id>` sources** (exactly like mail's `mail:<id>`) rather than writing files into the advisor's workspace — cleaner, no file clutter, mirrors the proven pattern. *(Alternative if visibility matters: also write a `Wealthbox/<Household>.md` file so the advisor can see/open the brief. Deferred; note for §8.)*

### 5.4 Sync strategy
- **Initial backfill:** bulk-pull each object type with `order=updated` + paging, grouped by household, rendered, indexed. Resumable via per-object checkpoints (survives the 1 rps slog and app restarts).
- **Delta sync:** per object, `updated_since=<last_sync>`; re-render + re-index only affected households.
- **Deletions:** contacts via `deleted_since`; other objects via a **periodic full ID snapshot + diff** (less frequent than delta). On household/contact delete → remove its chunks (`rag_delete_*` exists) and optionally archive the Matter.
- **Cadence:** background poll (default in §8) + manual "Sync now"; single-flight guard (mirror `MailState`); progress events to the UI.

### 5.5 Privacy & security posture (Keepance is local-first)
- All Wealthbox data lands in the **local** encrypted RAG store on the advisor's machine; brief text is encrypted at rest (use `build_batch_*`, never write plaintext chunks).
- The token lives only in the **OS keychain**, never logged.
- Respect **Local-only mode** (the Client Map provider already forces local AI there) — important: client PII is **Reg S-P** data; default `privilege='none'` is correct but the local-only egress guard must cover CRM-derived content too.
- **Sensitive IDs** (passport, driver's license, green card) — recommend **omitting these from the indexed brief by default** (they add risk, little Client-Map value). Easy to include later if asked.

---

## 6. Phased build plan (high-level, no dates)

- **Phase 1 — MVP (paste-key, read-only, the wow):** token connect + validate; backfill **households + people + their profile + notes**; dossier renderer; index as `crm` chunks; auto-create one Matter per household; manual "Sync now"; Client Map fills in. *Goal: an advisor pastes a key and sees their book appear as Client Maps.*
- **Phase 2 — Freshness & breadth:** scheduled cadence; delta sync via `updated_since`; deletion handling (contacts tombstones + snapshot-diff); add tasks/events (and opportunities/workflows if in scope); category/user resolution caching; large-book resilience (checkpoint/resume, rate-limit polish); mapping/review UI.
- **Phase 3 — Polished OAuth + partnership:** one-click "Connect with Wealthbox" (OAuth loopback-PKCE behind the same `CrmProvider`); Wealthbox partner application + demo + marketplace listing; multi-user/firm visibility handling.

The provider abstraction means Phase 3's OAuth is a *swap behind the same interface*, and a future Redtail/Salesforce connector is *another provider*, not a rebuild.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Per-user visibility** silently under-fetches a firm's book | Fine for solo/pilot. For firms, onboarding asks the advisor to connect as a full-visibility user; show what the token can/can't see (`GET /v1/me`). |
| **Tight ~1 rps + no webhooks** → slow first import, limited freshness | Token-bucket + bulk object pulls + checkpoint/resume; cadence tuned to book size; "last synced" shown in UI. |
| **Uneven deletions** (only contacts tombstoned) | Contacts via `deleted_since`; periodic snapshot-diff for the rest. |
| **No files / no live AUM via API** | Set expectations in UI copy; documents still enter Keepance normally; AUM is a future custodian/portfolio integration, not Wealthbox. |
| **OAuth partner approval is a schedule dependency** | Paste-key ships now; start partner application in parallel (needs Jameson's go — outward-facing). |
| **Timestamp format / max per_page / tier gating unknown** | Quick empirical probes with a trial token before hardening (§3.6). |
| **Bulk-import OOM** (box is memory-tight) | Reuse mail's bounded concurrency (cap 4); stream, don't load all in memory. |
| **Reg S-P sensitive PII** | Local-only storage, encrypted at rest, omit sensitive govt IDs from the brief by default. |

---

## 8. Open decision (needs Jameson) + my recommendations on the rest

**The one product decision worth your call — how much to capture (data breadth):**
- **My recommendation (balanced):** capture the **client-knowledge core** — households + members (people, trusts, orgs in a household), their full contact/financial/relationship/profile fields + key dates, **notes**, and **upcoming events & open tasks**. *Skip* the operational CRM machinery (sales **opportunities** pipeline, **workflow** templates/progress, **projects**) in v1 — it's advisor-workflow plumbing, not client knowledge, and adds sync cost. Easy to add in Phase 2 if you want it.
- Alternatives: **(Minimal)** households + people + notes only (fastest wow, least noise). **(Everything)** mirror all objects including opportunities/workflows/projects (richest, but noisier Client Maps + more API load).

**Things I'll just decide (sensible defaults; flag if you disagree):**
- **Matter mapping:** auto-create one Matter per household on first sync (named from the household), with a review/merge step in the mapping UI. Unhouseholded individual *clients* → one Matter each. Prospects/vendors → not auto-mapped (optionally importable later).
- **Cadence:** background sync a few times a day + on app open, plus manual "Sync now." (Tunable; conservative given 1 rps.)
- **Storage:** virtual `crm:` sources (no workspace file clutter); revisit writing visible `.md` briefs if you want advisors to see them.
- **Sensitive govt IDs:** omitted from the indexed brief by default.

---

## 9. Pointers (read these first when implementing)
- **Wealthbox facts:** `scratchpad/wealthbox-research.md` (this session) + https://dev.wealthbox.com/
- **Keepance seams:** `scratchpad/keepance-map.md`; then in-repo: `mail/provider.rs` → `mail/sync.rs` → `index_mail_text_internal` + `outlook_connect` (`mail/mod.rs`) → `rag/store.rs` (`build_schema`, `build_batch_mail`) → `useMemoryWiring.ts` → `clientMap/generator.ts` → `types/matter.ts`.
- **Landmines:** never rename `matter_id`; `matter_id`/`privilege` are NON-NULL plaintext (pass a real id or `"unassigned"`); chunk text must be encrypted via `build_batch_*`; cap bulk indexing concurrency; respect Local-only mode.
- **Earlier abandoned prototype** (reference only, do not build on): `/home/jameson/kp-wt-wealthbox` (branch `feat/advisor-wealthbox`), a 2-day-old stale sketch (`WealthboxConnect.tsx`, `wealthboxMatterSync.ts`, `src-tauri/.../wealthbox/mod.rs`).

---

*Next step after sign-off: turn this into an implementation plan (writing-plans) for Phase 1, build it in this worktree, Codex-review before merge.*

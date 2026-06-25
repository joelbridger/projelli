# Wealthbox → Keepance Connector — Research & Design

**Status:** Design (research complete; independently reviewed by Codex; awaiting final scope sign-off before plan/implementation)
**Date:** 2026-06-25
**Author:** Claude (senior staff engineer session), for Jameson
**Branch / worktree:** `feat/wealthbox-connector` @ `/home/jameson/keepance-wt-wealthbox` (isolated; based on `keepance-3.0`)

---

## 0. Plain-language summary (read this first)

We're building a **connector** — a bridge — that pulls a financial advisor's client and family information **out of Wealthbox** (a popular CRM/contact database built for advisors) **into Keepance**, drops it into each client's **Client Map**, makes it **searchable**, and then **keeps it fresh** by checking back on a schedule.

**Two decisions are locked:**
- **Read-only, one-way.** Wealthbox stays the source of truth. Keepance only *reads* a copy; it never changes anything in Wealthbox. Zero risk of corrupting an advisor's live records.
- **"Paste-a-key" first.** The advisor copies a secret access key from their Wealthbox settings and pastes it into Keepance once. This works *today* with no waiting. Later we add the polished one-click "Connect with Wealthbox" button (which requires becoming an official Wealthbox partner — a slower, approval-gated path). The connector is designed so that button slots in behind the same machinery without a rewrite.

**The core idea that makes this elegant:** Keepance's Client Map already builds itself by reading *text* about a client and pulling out the people, the money picture, and the story. So the connector keeps a small local copy of the raw Wealthbox records, turns them into clean readable text (the individual records **plus** a short household profile), feeds that into Keepance's existing search/index, and the Client Map lights up **automatically** — no changes to the Client Map itself.

**Four honest limits of Wealthbox** we design around: (1) no instant change-alerts, so we poll on a schedule; (2) no file/document downloads through the API; (3) no live investment-account balances (only what the advisor typed in); (4) a tight speed limit (~1 request/second), so the first big import takes a little while but staying in sync afterward is cheap.

---

## 1. Goal & scope

### Goal
Let an advisor connect their Wealthbox account so that **every household/client and the knowledge attached to them** (people, relationships, financial profile, key dates, notes, upcoming meetings/tasks) appears inside Keepance — integrated into the **Client Map**, **searchable** via Ask/RAG, and **kept up to date** on a regular cadence.

### In scope (v1)
- Read-only, one-way sync from Wealthbox via its public REST API (`https://api.crmworkspace.com/v1`).
- "Paste-a-key" auth (Wealthbox **Personal API Access Token**), stored in the OS keychain.
- Pull the **client-knowledge core**: households + member people (+ trusts/orgs in a household), their full contact/financial/relationship profile, notes, tasks, events. (Exact breadth = the one open product decision, §8.)
- A **durable local copy** of the synced Wealthbox objects, rendered into matter-scoped RAG chunks (granular per-record + a household summary) → flows into the Client Map + search.
- Initial full backfill + **delta sync** on a cadence, with manual "Sync now."
- Map **one Wealthbox household → one Keepance Matter** (the advisor's "client/household" unit).

### Out of scope (v1 — explicitly deferred)
- Writing anything back to Wealthbox (no two-way).
- One-click OAuth "Connect with Wealthbox" button + Wealthbox partner listing (Phase 3; partner application can start in parallel).
- Document/file binaries (the API can't provide them).
- Live AUM/brokerage balances (not in the API).
- Other CRMs (Redtail, Salesforce FSC). The engine is built so they *could* be added later, but they are not a v1 goal.

---

## 2. Decisions locked (and why)

| Decision | Choice | Why |
|---|---|---|
| Sync direction | **Read-only, one-way** | Safety (never corrupt a live CRM), simplicity, matches the ask. |
| Auth method (v1) | **Paste Personal API Token** | Ships immediately; no dependency on Wealthbox partner approval. Good for first pilot advisors. |
| Auth method (later) | **OAuth 2.0 one-click** (Phase 3) | Polished UX + marketplace listing, but gated behind manual Wealthbox partner onboarding (email → build → demo → approve). |
| Architecture pattern | **Reuse the mail connector's *infrastructure ideas*** (keychain, bounded indexing, progress events, single-flight, the RAG bridge) — but a **CRM-specific, object-level sync engine**, not a literal household-as-folder clone | Keepance already has proven external-data plumbing; the *orchestration* must match Wealthbox's object model (see §5). |
| Client unit | **Household → Matter** (one matter per household; per-person matter for unhouseholded individual clients) | Matches the advisor pivot's "client/household" unit; `matter_id` is the locked isolation key. |
| Workspace isolation | **Dedicated worktree `feat/wealthbox-connector`** | Three other sessions are actively building Keepance; never collide. |

**Independently reviewed (Codex, 2026-06-25).** An independent engine (OpenAI Codex) adversarially reviewed this design against the live code. It **confirmed** the core integration target (Client Map reads matter-scoped RAG; `matter_id` is the isolation key; the mail trait/sync/indexing pieces exist; `SourceType` needs a new `Crm` variant) and surfaced refinements now folded into §5: (1) the sync engine is **object-level**, not a household-as-folder clone of the mail provider; (2) a **durable CRM object store** is required (deletions / re-render need prior state); (3) index **granular per-object records** plus a household summary (not one lossy mega-brief); (4) add **failure recovery** (separate "fetched" vs "indexed" status + backfill markers); (5) citations need a **virtual Wealthbox source viewer** (there's no workspace file to open); (6) onboarding must say "imports what this Wealthbox user can see" (the API can't prove full firm visibility).

---

## 3. Wealthbox research (what it is & how it works)

> Verified against the official API reference at **https://dev.wealthbox.com/** (raw HTML downloaded and checked directly). Full long-form report: `scratchpad/wealthbox-research.md` in the session, and the published report (link in the project memory).

### 3.1 What Wealthbox is
A cloud CRM built specifically for financial advisors / RIAs (Starburst Labs, 2014). #2 advisor CRM by usage and fastest-growing (behind Redtail; Salesforce FSC dominates enterprise). Known for a modern, "activity-stream" UX. Wealth-management-specific data model: households, self-reported financial-profile fields, compliance dates (ADV/CRS).

### 3.2 Data model — the important part
**Everything hangs off a Contact.** `contact.type` ∈ `person | household | organization | trust`.

**Households = "families".** A household is itself a contact (`type=household`) with its own id and name (e.g. "The Andersons"). Each person's record carries a nested `household` object: `{ name, title, id, members[] }`; each member is `{ id, first_name, last_name, title, type }`. Household **titles** (the family role): `Head, Spouse, Partner, Child, Grandchild, Parent, Grandparent, Sibling, Other Dependent`. A household can group people, trusts, and organizations.
- To reconstruct a family: list `type=household` contacts → read each household's `members[]` → fetch each member contact for full detail. (Membership-edit endpoints exist but are irrelevant for read-only.)

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
- **Pagination:** page-based — `per_page` (default 25) + `page` (default 1). Max `per_page` **undocumented — must test**. **Collections are unordered by default**, and `order` support is **uneven** (contacts/notes accept `order=updated`; tasks have no `order`; events/opportunities' `order` choices exclude `updated`). ⇒ don't rely on `order=updated` globally; page via **overlapping timestamp windows** (see §5.4).
- **Filtering:** strong on contacts — `type`, `contact_type`, `household_title`, `updated_since`, `updated_before`, `deleted`, `deleted_since`, `active`, `tags`, `external_unique_id`, etc. Other list endpoints take `resource_id`+`resource_type` and `updated_since`.
- **No `include`/expand** — related records are embedded inline (household/tags/custom_fields/addresses), but numeric id refs (assigned_to, stage, category) must be resolved via categories/users/teams endpoints.
- **Status codes:** `202` = 2FA required, `402` = trial expired, `403` = no permission, `429` = rate limited.

### 3.4 Incremental sync, deletions, real-time
- **`updated_since`/`updated_before` are first-class** on every object we care about → the backbone of delta sync. ⚠️ Timestamps come back in a **non-ISO format** (`"2015-05-24 10:00 AM -0400"`); the exact format `updated_since` accepts is **unconfirmed — test ISO-8601 and native; store/compare UTC.**
- **Deletions are uneven:** **Contacts** have real tombstones (`deleted=true`, `deleted_since=<ts>`). **Every other object has no deletion feed** → detect deletes by diffing our **durable CRM store**'s known ids against a periodic full id pull.
- **No native webhooks.** (Third-party "Wealthbox webhook" guides are AI-generated and describe endpoints that don't exist.) **Polling is mandatory.**

### 3.5 Limits & operational
- **Rate limit ~1 req/sec** averaged over 5 min (~3,600/hr), bursts tolerated, `429` on exceed → token-bucket limiter at ~1 rps + backoff + checkpoint/resume.
- **Big books (10k+ contacts):** prefer **object-level bulk pulls with `updated_since`** over per-contact fan-out; push `per_page` high. Initial backfill of a large firm takes minutes-to-longer; must be resumable.
- **Per-user visibility (biggest real-world risk):** a token sees only what *that user* can see — `Private`/group-scoped records won't appear, and admin ≠ full visibility. For solo/pilot advisors (their own token) this is fine; for firms, onboarding states the limitation honestly (we **cannot** detect what's hidden).
- **Pricing/tier gating:** plans Basic $59 → Enterprise. Personal API tokens appear broadly available; **whether any tier disables API access is unconfirmed — verify.**
- **No sandbox tenant** — use a 14-day trial workspace + a personal token for dev/test.

### 3.6 Things to verify empirically (quick live probes with a trial token)
1. Max `per_page`.
2. Exact `updated_since` timestamp format accepted.
3. Whether any plan tier blocks API access.
4. Per-endpoint paging stability under `updated_since` (does paging stay stable mid-sync?).

---

## 4. Keepance architecture (where this plugs in)

> Read-only exploration of `keepance-3.0`. Full map: `scratchpad/keepance-map.md`.

### 4.1 Stack & data stores
- `src/` = TS/React frontend (5-layer DAG: lib ← ui ← platform ← features ← app). `src-tauri/` = Rust backend (Tauri 2, `#[tauri::command]`, registered in `src-tauri/src/lib.rs`). `backend/` = separate firm E2EE relay (not for a local connector).
- **RAG vectors:** LanceDB at `<ws>/.keepance/vectors/` (`chunks` table), embeddings via fastembed **e5-small (384-dim)**, native Rust (`src-tauri/src/commands/rag/`).
- **Mail metadata + resume cursors:** SQLCipher (encrypted) at `<ws>/.keepance/mail-enc.db` (legacy plaintext `mail.db` is migrated away). **This is the model for our CRM store.**
- **App/UI state:** Zustand + localStorage (Matters, Client Maps). No general SQL DB.
- **Secrets:** OS keychain via `keyring` crate (`com.keepance.*`).

### 4.2 The Client Map (the integration target)
- **Not a datastore — a per-matter, AI-built, source-cited profile *derived from RAG retrieval*** scoped to one `matter_id`, persisted as small JSON in localStorage (`keepance:client-maps`). Code: `src/platform/clientMap/` + UI `src/features/matters/`.
- **5 core sections** (`generator.ts` `buildClientMap()`): `story`, `people`, `standing` (accounts/assets/liabilities/net worth/custodian/risk), `upcoming`, `next`. Each runs a fixed semantic query against `MemoryService.retrieve(query, topK=8, {kind:'matter', matterId})` → AI writes cited bullets.
- **⇒ Two consequences:** (a) anything we want in the Client Map must become matter-tagged RAG chunks; (b) because retrieval is `TOP_K=8` per broad query, **granular, well-scoped chunks retrieve better than one giant blob** — directly informs §5.3.

### 4.3 The Matter = the client unit (no separate Client/Household entity)
- `matter_id` (`matter_<uuid>`) is the confidentiality/isolation key threaded everywhere — **LOCKED, never rename** (ARCHITECTURE.md L80-83). `Matter` type: `src/platform/types/matter.ts`. Store: `src/platform/matter/matterStore.ts` (`createMatter()` mints the id; persisted to `keepance:matters`).
- A "household"/"client" is a Matter with cosmetic profession labeling (`useEntityLabel.ts` → advisor: one='client', group='household'). People & accounts are **not structured records** — they surface as AI-extracted text inside Client Map sections.
- **⇒ One Wealthbox household → one Keepance Matter. Members/notes/events → indexed text under that `matter_id` → Client Map fills in automatically.**

### 4.4 Search & indexing (RAG)
- `chunks` table (`rag/store.rs` `build_schema()`): `id, path(HMAC token), matter_id (NOT NULL, plaintext prefilter), source_id (NOT NULL), paragraph_index, text (AES-256-GCM at rest), vector[384], source_type, page_number, encrypted, privilege (NOT NULL), locator, path_enc`.
- `matter_id` + `privilege` stay plaintext on purpose (LanceDB **prefilter** for isolation). Everything else encrypted at rest.
- **`SourceType` enum** (`store.rs`): `Text, Pdf, Mail, Docx, Rtf, Xlsx, Pptx, Transcript` → **add `Crm`**.
- Ingestion wiring: `useMemoryWiring.ts`; retrieval API: `MemoryService.ts`.

### 4.5 The mail connector = our *reference*, not a template to clone verbatim
What to **reuse** (the good infrastructure):
- **Ingestion→RAG bridge** (`mail/mod.rs` `index_mail_text_internal(ws, "mail:<id>", text, matter_id)`): the single function that turns external text into chunks (`store::build_batch_mail`), and **deletes stale chunks for that source id before re-inserting** (`mod.rs:~1281`) — exactly what re-rendering needs. We clone this as `index_crm_text_internal`.
- **Bounded indexing** (`spawn_mail_rag_index`, semaphore cap 4 — avoids OOM on the memory-tight box) and the **"RAG backfill needed" repair path** when embeddings aren't ready (`mod.rs:~698`).
- **Keychain** pattern for secrets; **single-flight guard** (`MailState`); **progress events** (`mail-sync-progress`).
What **not** to copy: the `MailProvider` trait is **folder-shaped** (`provider.rs`: `list_folders` + `fetch_changes(folder, cursor)` returning messages + tombstones). Wealthbox is **object-shaped**, so we build a different orchestration (§5).
- **Connect UI / cadence:** `MailConnect.tsx` is the UI reference; note there is **no scheduler** today (mail sync is manual/on-connect) — we add cadence ourselves (§5.4).

---

## 5. Proposed connector design (revised per independent review)

### 5.1 Components — a CRM-specific, object-level engine
**Backend `src-tauri/src/commands/crm/`** (new module, registered in `lib.rs`):
- **`client.rs` — `WealthboxClient`:** HTTP against `api.crmworkspace.com/v1` (via `tauri_plugin_http`/`commands/http.rs`) with a **~1 rps token-bucket + 429 backoff**, the `ACCESS_TOKEN` header, and a **cached resolver** for numeric ids (categories/users/teams → labels).
- **`store.rs` — durable CRM object store:** an **encrypted SQLCipher `crm-enc.db`** (mirroring `mail-enc.db`) holding **normalized Wealthbox objects** (contacts/households/notes/tasks/events/…), household membership, each object's `updated_at` + a content hash, **tombstones**, per-object delta cursors, and per-household `render_state` (last rendered hash, fetched-vs-indexed status). *This canonical store is what makes deletions, re-rendering, and resume correct — it's the piece the first draft was missing.*
- **`engine.rs` — object-level sync engine:** for each object type, pull deltas (timestamp windows, §5.4) → upsert into the CRM store → compute the set of **affected households** (any household whose contacts/notes/tasks/events changed) → enqueue them for **re-render + re-index**. Single-flight guard; progress via a `crm-sync-progress` event; bounded indexing concurrency.
- **`render.rs` — record + summary renderer:** from the CRM store, render **(a) granular per-object text records** (`contact:<id>`, `note:<id>`, `task:<id>`, `event:<id>`…) and **(b) a concise household summary** (`household:<id>`). Both carry the household's `matter_id` and stable source ids for citations. *(Granular records → sharp retrieval + real citations; the summary → the "story"/"standing" overview.)*
- **`index.rs` — `index_crm_text_internal(ws, source_id, text, matter_id)`:** cloned from `index_mail_text_internal` (deletes stale chunks for that `source_id` first, then re-inserts), calling a new `store::build_batch_crm` (`source_type='crm'`, `privilege='none'`). Tracks **"indexed" status** in the CRM store so a failed embed is retried (reusing the mail backfill-repair idea), so sync can never "succeed" while search stays empty.
- **`commands.rs` + token storage:** `crm_connect` (validate token via `GET /v1/me`, store in keychain `com.keepance.wealthbox`), `crm_sync_all`, `crm_sync_status`, `crm_disconnect`.

**Frontend:**
- `src/features/settings/WealthboxConnect.tsx` (UI reference: `MailConnect.tsx`): paste-token field with clear steps + "Test connection" (`GET /v1/me` → show workspace name + plan) → "Connected ✓" → kick off sync. **Onboarding copy states honestly:** "Keepance imports what this Wealthbox login can see." (We cannot detect privately-scoped records.)
- `src/platform/utils/wealthbox-commands.ts` (clone `mail-commands.ts`).
- **Household↔Matter mapping:** add `crmHouseholdKeys?: string[]` to `Matter` (mirroring `mailFolderPaths`) + a helper mirroring `buildMailMatterMap`. Review/merge UI reuses `MatterManagerDialog.tsx`. **Do not invent a Household entity** — map to a Matter; `useEntityLabel` shows "Household."
- **Citations / source viewer:** add `'crm'` to `SourceRef.kind` (`clientMap/types.ts`, currently only `'document'|'email'`) **and** a virtual viewer path so a CRM citation opens a **Wealthbox record panel** rather than trying to open a workspace file (today `openSource.ts` falls back to opening a file). Display label: "Wealthbox · <household/record>".
- **Cadence:** a lifecycle hook `setInterval` → `crm_sync_all` (default in §8) + a manual "Sync now."

**Schema touch-points (small, additive):** `SourceType::Crm` (`store.rs`); `RagHit.sourceType` union (`tauri-commands.ts`); `SourceRef.kind` += `'crm'` (`clientMap/types.ts`) + the opener/viewer.

### 5.2 Data flow (end to end)
```
Wealthbox REST (api.crmworkspace.com/v1, ACCESS_TOKEN, ~1 rps token-bucket)
   │  OBJECT-LEVEL delta pulls (contacts incl. households, notes/status_updates, tasks, events, …) via timestamp windows
   │  resolve numeric ids via cached categories/users/teams
   ▼
Durable CRM object store (crm-enc.db): upsert normalized objects + hashes + membership + tombstones + cursors
   │  compute AFFECTED households → enqueue
   ▼
render.rs → per-object records (contact:/note:/task:/event:<id>) + household summary (household:<id>)   [text + matter_id]
   ▼
index_crm_text_internal(ws, source_id, text, matter_id) → build_batch_crm → LanceDB chunks
   (source_type='crm'; encrypted at rest; deletes stale chunks for source_id first; bounded concurrency; tracks indexed status)
   ▼
Client Map generator (unchanged) retrieves matter-scoped chunks → people / standing / story / upcoming / next
   ▼
Searchable in Ask/RAG; citations open a virtual "Wealthbox · <record>" viewer
```

### 5.3 Representation — granular records + a household summary (not one blob)
**Why dual representation** (the key review correction): the Client Map runs 5 broad semantic queries and keeps only **TOP_K=8** hits each. A single giant per-household brief would (a) bury facts in a large household, (b) lose the structure/recency of individual records, and (c) make every citation point at a synthetic blob instead of the real note/person. So we index **both**:
- **Granular records** — one small chunk-source per Wealthbox object (`contact:<id>` with the person's profile/financials/relationships; `note:<id>` with the dated note; `task:<id>`, `event:<id>`…). Each is independently retrievable and citable back to the real record.
- **A concise household summary** (`household:<id>`) — a short readable profile (who's in the family, headline financial picture, professional team, key dates, what's upcoming) that feeds the Client Map's `story`/`standing` overview.

All share the household's `matter_id`. Re-rendering on change re-writes only the affected sources (and `index_crm_text_internal` clears their stale chunks first), so the index never accumulates ghosts.

### 5.4 Sync strategy
- **Initial backfill:** object-level bulk pulls (push `per_page` high), upsert into the CRM store, then render + index all households. Resumable via per-object cursors in the store (survives the 1 rps slog and app restarts).
- **Delta sync:** per object, `updated_since=<last_sync>` using **overlapping timestamp windows** (small re-overlap to tolerate boundary records) + `(updated_at, id)` dedupe against the store — because `order` support is uneven and paging stability is unproven (§3.3/3.6). Re-render + re-index only **affected households**.
- **Deletions:** contacts via `deleted_since`; for objects with no deletion feed, periodically pull the full id list per type and **diff against the CRM store's known ids** → tombstone the missing ones, drop their chunks (`rag_delete_*`), and re-render their household. On household delete → archive the Matter.
- **Failure recovery:** the CRM store tracks **fetched vs indexed** per object; a startup/backfill repair re-indexes anything fetched-but-not-indexed (mirrors mail's backfill-needed path) so an embed failure or model-not-ready never leaves search silently empty.
- **Cadence:** background poll (default §8) + manual "Sync now"; single-flight guard; progress events to the UI; "last synced" shown.

### 5.5 Privacy & security posture (Keepance is local-first)
- All Wealthbox data (the CRM store **and** the chunks) lives **locally** on the advisor's machine, **encrypted at rest** (SQLCipher + the vector master key; use `build_batch_*`, never write plaintext chunks).
- The token lives only in the **OS keychain**, never logged.
- Respect **Local-only mode** (the Client Map provider already forces local AI there); client PII is **Reg S-P** data, so the local-only egress guard must cover CRM-derived content too.
- **Sensitive govt IDs** (passport, driver's license, green card) — **omit from indexed text by default** (risk, little Client-Map value); easy to include later if asked.

---

## 6. Phased build plan (high-level, no dates)

- **Phase 1 — MVP (paste-key, read-only, the wow):** token connect + validate; object-level backfill of **households + people + their profile + notes**; CRM store; render granular records + household summary; index as `crm` chunks; auto-create one Matter per household; manual "Sync now"; Client Map fills in; CRM citations open the virtual viewer. *Goal: an advisor pastes a key and sees their book appear as Client Maps.*
- **Phase 2 — Freshness & breadth:** scheduled cadence; delta sync (timestamp windows); deletion handling (contacts tombstones + store-diff); failure-recovery repair; add tasks/events (and opportunities/workflows if in scope); large-book resilience (checkpoint/resume, rate-limit polish); mapping/review UI.
- **Phase 3 — Polished OAuth + partnership:** one-click "Connect with Wealthbox" (OAuth loopback-PKCE behind the same engine); Wealthbox partner application + demo + marketplace listing; multi-user/firm visibility handling.

The engine/store split means Phase 3's OAuth is a *swap of the auth front-end* on the same sync engine, and a future Redtail/Salesforce connector is *another client + normalizer* into the same CRM store — not a rebuild.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Per-user visibility** silently under-fetches a firm's book (and `/v1/me` can't prove what's hidden) | Fine for solo/pilot. Onboarding states honestly that Keepance imports what *this Wealthbox login* sees; for firms, recommend connecting a full-visibility user. |
| **Tight ~1 rps + no webhooks** → slow first import, limited freshness | Token-bucket + object-level bulk pulls + checkpoint/resume; cadence tuned to book size; "last synced" shown. |
| **Uneven deletions** (only contacts tombstoned) | Contacts via `deleted_since`; store-diff (known ids vs full id pull) for the rest. |
| **Uneven `order` support / unproven paging stability** | Timestamp-window paging + `(updated_at,id)` dedupe; empirically test per endpoint before hardening. |
| **No files / no live AUM via API** | Set expectations in UI copy; documents still enter Keepance normally; AUM is a future custodian/portfolio integration, not Wealthbox. |
| **Re-render leaving stale chunks** | `index_crm_text_internal` clears a source id's chunks before re-insert; CRM store tracks render/index state. |
| **Indexing "succeeds" but search stays empty** (embed fail / model not ready) | Fetched-vs-indexed status + backfill-repair on startup (mirrors mail). |
| **OAuth partner approval is a schedule dependency** | Paste-key ships now; start partner application in parallel (needs Jameson's go — outward-facing). |
| **Timestamp format / max per_page / tier gating unknown** | Quick empirical probes with a trial token before hardening (§3.6). |
| **Bulk-import OOM** (box is memory-tight) | Reuse mail's bounded concurrency (cap 4); stream, don't load all in memory. |
| **Reg S-P sensitive PII** | Local-only storage, encrypted at rest, omit sensitive govt IDs by default. |

---

## 8. Open decision (needs Jameson) + my recommendations on the rest

**The one product decision worth your call — how much to capture (data breadth):**
- **My recommendation (balanced):** capture the **client-knowledge core** — households + members (people, trusts, orgs in a household), their full contact/financial/relationship/profile fields + key dates, **notes**, and **upcoming events & open tasks**. *Skip* the operational CRM machinery (sales **opportunities** pipeline, **workflow** templates/progress, **projects**) in v1 — it's advisor-workflow plumbing, not client knowledge, and adds sync cost. Easy to add in Phase 2.
- Alternatives: **(Minimal)** households + people + notes only (fastest wow, least noise). **(Everything)** mirror all objects including opportunities/workflows/projects (richest, but noisier Client Maps + more API load).

**Things I'll just decide (sensible defaults; flag if you disagree):**
- **Matter mapping:** auto-create one Matter per household on first sync (named from the household), with a review/merge step. Unhouseholded individual *clients* → one Matter each. Prospects/vendors → not auto-mapped (optionally importable later).
- **Cadence:** background sync a few times a day + on app open, plus manual "Sync now." (Tunable; conservative given 1 rps.)
- **Representation:** granular per-object records + a household summary (§5.3); virtual viewer for citations (no workspace files).
- **Sensitive govt IDs:** omitted from the indexed text by default.

---

## 9. Pointers (read these first when implementing)
- **Wealthbox facts:** `scratchpad/wealthbox-research.md` (this session) + https://dev.wealthbox.com/
- **Keepance seams:** `scratchpad/keepance-map.md`; then in-repo: `mail/mod.rs` (`index_mail_text_internal` ~1281, backfill-repair ~698, `spawn_mail_rag_index` ~1402) → `rag/store.rs` (`build_schema`, `build_batch_mail`, `SourceType`) → `mail/store.rs` (encrypted SQLCipher pattern → model for `crm-enc.db`) → `useMemoryWiring.ts` → `clientMap/generator.ts` (TOP_K=8 queries) → `clientMap/types.ts` + `clientMap/openSource.ts` (citations) → `types/matter.ts` + `matter/matterStore.ts`. *Reference only — don't clone the `mail/provider.rs` folder trait.*
- **Landmines:** never rename `matter_id`; `matter_id`/`privilege` are NON-NULL plaintext (pass a real id or `"unassigned"`); chunk text must be encrypted via `build_batch_*`; cap bulk indexing concurrency; respect Local-only mode.
- **Earlier abandoned prototype** (reference only, do not build on): `/home/jameson/kp-wt-wealthbox` (branch `feat/advisor-wealthbox`), a 2-day-old stale sketch.

---

*Next step after sign-off: turn this into an implementation plan (writing-plans) for Phase 1, build it in this worktree, Codex-review before merge.*
*Independently reviewed by Codex 2026-06-25 (object-level engine, durable CRM store, granular records + summary, failure recovery, virtual citation viewer, honest visibility copy, store-path fix all incorporated).*

# Connectors

> How outside data sources (email, a CRM, cloud files, a calendar, e-signatures)
> get pulled into Keepance, tagged to the right client, and made searchable with
> citations. Written for humans and AI agents. **Verify every status claim
> against the code before relying on it** — connector status moves fast, and the
> statuses below were grounded in the `keepance-3.0` source on 2026-06-28. If a
> detail disagrees with the code, trust the code and fix this doc.

## What a connector is

A **connector** is the bridge from one external data source into Keepance's
local, cited search. Each connector does three jobs:

1. **Connect + authenticate** to a provider (OAuth, a pasted API token, or
   username/password) and keep the credential in the OS keychain.
2. **Sync** — fetch the source's items (emails, CRM households, cloud documents,
   meetings, signed envelopes), incrementally and cancellably.
3. **Index into the Client Map / RAG** — turn each item into text, tag it with a
   `matter_id` (the client) and a `source_type`, and hand it to the shared RAG
   indexer so it becomes a cited, matter-scoped search result.

The end result: a question like "what did the Caldwells' financial plan say
about their cash position?" can be answered from a OneDrive PDF, with a clickable
citation, scoped so only the Caldwell client's data is ever consulted. The RAG
side of that pipeline is documented in [RAG_PIPELINE.md](./RAG_PIPELINE.md); this
doc is about getting the *data in* and *tagged correctly*.

All connector backends live under
[`src-tauri/src/commands/`](../../src-tauri/src/commands/) — one folder per
connector — over a shared foundation in
[`connector/mod.rs`](../../src-tauri/src/commands/connector/mod.rs). Their UI
lives in [`src/features/settings/`](../../src/features/settings/) (the
`*Connect` components) and is surfaced in **Account → Connections**
([`src/features/account/AccountWindow.tsx`](../../src/features/account/AccountWindow.tsx)).

---

## The connect → sync → index lifecycle

Every connector follows the same shape (command names vary by connector; CRM
shown as the example):

```
crm_set_workspace(path)         ── point the connector at the open workspace
        │
crm_connect(token) / OAuth      ── authenticate; refresh token → OS keychain
        │
crm_is_connected()              ── UI polls this to show "Connected"
        │
crm_list_households()           ── (optional) browse items before syncing
        │
crm_sync_all(matter_map)        ── fetch items; for each, resolve its matter,
        │                          render to text, hand to the RAG indexer
crm_sync_status() ──poll──►      ── progress for the UI; crm_cancel_sync() aborts
        │
   chunks land in LanceDB, tagged matter_id + source_type
```

**Authentication** is one of three patterns, and the credential always lands in
the OS keychain (never a config file, never logged):

| Pattern | Used by | Keychain service |
|---|---|---|
| OAuth 2.0 PKCE (loopback **or** device-code) | Outlook/M365, Gmail, OneDrive, DocuSign, Salesforce | `keepance-mail-ms`, `keepance-mail-gmail`, `keepance-docs-ms`, `keepance-docusign`, `keepance-crm-salesforce` |
| Pasted API token | Wealthbox, Calendly | `keepance-crm-wealthbox`, `keepance-calendly` |
| Username + password / API key | IMAP, Redtail | `keepance-mail-imap`, `keepance-crm-redtail` |

OAuth refresh tokens are auto-refreshed on each call (e.g. OneDrive's
`fresh_access_token()`), so a connector stays connected without re-prompting.

**Sync** is incremental and idempotent: each connector keeps per-source cursors
(delta tokens, modified-since timestamps) so a re-sync only fetches what
changed, and re-indexing the same item is safe (the RAG layer does
delete-then-add by `source_id`).

---

## How imported data maps to clients (matters)

This is the heart of the connector design — and a **privacy boundary**, not just
a convenience. A client in Keepance is a *matter* (`matter_id`). Connector data
must land on the right matter, and must never silently cross from one client to
another. All the mapping logic is pure TypeScript in
[`src/platform/rag/matterResolver.ts`](../../src/platform/rag/matterResolver.ts),
so it's unit-testable and the same rules apply everywhere.

Each connector has its own **matter-map entry** type and a `build*MatterMap()`
function that produces the map handed to the sync command:

| Connector | Map entry | Maps by |
|---|---|---|
| Email | `MailMatterMapEntry { provider, account, folderId, matterId }` | mail folder → matter (folder-level beats account-level) |
| Wealthbox / CRM | `CrmMatterMapEntry { householdId, matterId }` | one household → one matter |
| OneDrive | `OneDriveMatterMapEntry { folderKey, matterId }` | a cloud folder → matter |
| DocuSign | `EsignMatterMapEntry` | envelope → matter (exact then fuzzy name match) |
| Calendly | `MeetingMatterMapEntry` | meeting name (normalized) → matter |

Two rules keep this safe, enforced in `matterResolver.ts`:

- **Most-specific match wins.** A folder path resolves to the deepest matching
  matter folder, so a parent matter can't swallow a child folder's content.
- **Ambiguity never auto-links.** Client names are normalized
  (`normalizeClientName()` — lowercase, trim, collapse whitespace, strip edge
  punctuation). If two matters share a normalized name, the resolver refuses to
  pick one — the item goes to `unassigned` or a "needs filing" state for the
  user to resolve. Better unfiled than misfiled.

Anything that can't be confidently matched lands in the `UNASSIGNED_MATTER`
bucket (`"unassigned"`) and shows up for manual filing, rather than being
attached to a guessed client.

---

## How to add a new connector

A connector touches five layers. Use an existing connector as a template —
**Calendly** is the smallest end-to-end example (paste-token auth, simple sync);
**OneDrive** is the reference for OAuth + cloud-file fetching.

1. **Backend module** — create `src-tauri/src/commands/<name>/` with the
   provider client, a sync engine, and `#[tauri::command]` functions following
   the `*_set_workspace` / `*_connect` / `*_is_connected` / `*_sync*` /
   `*_cancel_sync` shape. Register every command in the
   `tauri::generate_handler!` list in
   [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs), and register any managed
   state in the `.setup()` hook (`<name>::manage_state(app)`).

2. **Index through the shared foundation** — render each item to plain text and
   call `spawn_external_rag_index(workspace, source_id, text, matter_id,
   source_type)` from
   [`connector/mod.rs`](../../src-tauri/src/commands/connector/mod.rs). It
   validates the `source_type`, encrypts the chunk text at rest, deletes stale
   rows first (idempotent), and writes through `build_batch_external`. Indexing
   is bounded to 4 concurrent tasks (`EXTERNAL_INDEX_SEMAPHORE`). Use a stable,
   prefixed `source_id` (e.g. `meeting:<event-id>`, `onedrive:<drive>:<item>`,
   `crm:<kind>:<id>`) so provenance is recoverable from `Hit.path`.

3. **Source-kind allowlist** — your `source_type` must be in
   `EXTERNAL_SOURCE_TYPE_ALLOWLIST` in
   [`src-tauri/src/commands/rag/store.rs`](../../src-tauri/src/commands/rag/store.rs).
   The current allowlist (anything else is rejected by
   `validate_external_source_type`):

   ```
   text, pdf, mail, docx, rtf, xlsx, pptx, transcript, crm, onedrive, esign, meeting
   ```

   Adding a genuinely new kind means adding it here (and to the typed checks +
   tests next to it).

4. **Matter map** — add a `<Name>MatterMapEntry` type and a
   `build<Name>MatterMap()` / `resolveMatterFor<Name>()` in
   [`src/platform/rag/matterResolver.ts`](../../src/platform/rag/matterResolver.ts),
   following the most-specific-wins + ambiguity-is-unassigned rules above. This
   is what keeps a new connector from leaking across clients.

5. **UI** — add a `<Name>Connect` component under `src/features/settings/`, wire
   it into **Account → Connections**
   ([`AccountWindow.tsx`](../../src/features/account/AccountWindow.tsx)), and (if
   it should appear at first run) into the onboarding "connect your data" scene
   ([`src/features/onboarding/v2/scenes/ConnectScene.tsx`](../../src/features/onboarding/v2/scenes/ConnectScene.tsx)).
   Connectors that aren't wired yet render as honest grayed-out "coming soon"
   logos from `ONB_COMING_SOON_LOGOS` in
   [`copy.ts`](../../src/features/onboarding/v2/copy.ts).

Keep credentials in the keychain, keep the connector read-only unless there's a
clear reason not to (most pull data; they don't write back), and never let a
connector pick a matter on its own when the match is ambiguous.

---

## Connector status (code-grounded, `keepance-3.0`, 2026-06-28)

> This corrects a couple of older summaries. Statuses are grouped by **what the
> code actually supports on this branch**, not by roadmap intent.

### Shipped and demo-proven

Backend commands registered in `lib.rs`, a `*Connect` UI in Account →
Connections, working auth + sync, and exercised in the 2026-06-28 Windows demo.

| Connector | Backend | `source_type` | Auth | Notes |
|---|---|---|---|---|
| **Email** (Outlook/M365, Gmail, IMAP) | `commands/mail/` | `mail` | OAuth (M365/Gmail) · user+pass (IMAP) | Multi-provider; folder→matter mapping; per-message manual filing. |
| **Wealthbox** (CRM) | `commands/crm/` (default provider) | `crm` | Paste API token | Households + contacts + notes; backfill then incremental. |
| **OneDrive / SharePoint** | `commands/onedrive/` | `onedrive` | OAuth PKCE (device-code or loopback) | Cloud `.docx`/`.pdf`/`.txt`; see the personal-account notes below. |
| **Calendly** | `commands/calendly/` | `meeting` | Paste API token | Events + invitees; meeting-name → matter. (Connector works; demo content was parked pending a calendar reconnect.) |

### Code-complete, gated on vendor credentials

Real, registered backend code (and in some cases UI), but they can't function in
production until Keepance has the provider's integrator credentials. These are
the ones to reach for when a partner key arrives.

| Connector | Backend | What's missing |
|---|---|---|
| **DocuSign** (e-signature) | `commands/docusign/` (8 commands registered) + `DocuSignConnect` UI | Needs a DocuSign integrator/app credential to authenticate; still listed under onboarding "coming soon." |
| **Salesforce** (CRM) | `commands/crm/salesforce.rs` + `SalesforceConnect` UI | Needs `KEEPANCE_SALESFORCE_CLIENT_ID` (Salesforce partner app); auto-sync not fully wired. |
| **Redtail** (CRM) | `commands/crm/redtail.rs` + `RedtailConnect` UI | Needs `KEEPANCE_REDTAIL_API_KEY` (Redtail partner integration); full parity with Wealthbox otherwise. |

### Placeholder logos only — no backend code on this branch

These appear as grayed-out "coming soon" logos in onboarding
(`ONB_COMING_SOON_LOGOS`) but have **no** connector code in `keepance-3.0`:
**RightCapital, eMoney, MoneyGuidePro, Holistiplan, Orion, Tamarac, Addepar,
Nitrogen.** (Redtail, Salesforce, and DocuSign also still appear in this
onboarding list even though their backends exist — the list is due a refresh.)

### Roadmap — committed, no code yet (vendor-access track)

Named as committed builds in `KEEPANCE_BUSINESS_PLAN.md` (board, 2026-06-10) but
deferred pending vendor API access, which is being applied for in parallel: the
**Clio** practice-management connector, the **iManage / NetDocuments** document
management connectors, and the **Microsoft Office add-ins**. No connector code
exists for these on this branch.

> **Note for the coordinator / next writer:** I found **no** backend or frontend
> code on `keepance-3.0` for Box, ShareFile, Jotform, or Zocks (earlier notes
> listed some of these as "built+queued"). If that work exists, it's on another
> branch — it is not in `keepance-3.0`, so this doc doesn't claim it.

---

## Hard-won OneDrive learnings (personal Microsoft accounts)

Personal Microsoft accounts (`@outlook.com`/`@hotmail.com`) behave very
differently from work/school accounts, and getting OneDrive import to attach to
the right client took four fixes. If you touch the OneDrive connector, read this
first — full detail is in
`keepance-coordination/handoffs/BENCH-HANDOFF.md` (§3).

The trap: a personal account can return **multiple drives, all
`driveType:"personal"`**, and the one `/me/drives` lists **first** is *not* the
real default drive that items actually live in. The four rules that make it work:

1. **Route personal drives via `/me/drive`, not `/drives/{id}`.**
   `GET /v1.0/drives/{personal-id}/root/children` returns HTTP 400
   `"ObjectHandle is Invalid"` for personal accounts. Personal drives must be
   addressed as `/me/drive/…` (children: `/me/drive/items/{id}/children`;
   download: `/me/drive/items/{id}/content`).
2. **Omit `$select` on the delta call for personal accounts.** Personal rejects
   `$select=` on `/…/root/delta` (the `omit_delta_select` path).
3. **The folder-listing path needs the same treatment.** The UI's
   `autoLinkOneDriveFolders` calls `onedrive_list_folders`, which must route
   personal accounts through `/me/drive` too — otherwise it throws the 400
   *before* the sync even runs.
4. **Tag folder keys with the REAL default-drive id.**
   `resolve_matter_for_item` only attaches a document when
   `folder_key.drive_id == item.drive_id`. Items report the real default drive
   (e.g. `cc84a8364295d326` from `GET /me/drive`), so folder keys must be tagged
   with `client.default_drive().await?.id` — not the first drive `/me/drives`
   happens to list. Get this wrong and every document imports as `unassigned`.

Verified end state from the demo: 26/26 clients with OneDrive docs attached
(~300 cloud chunks, zero routing 400s), and a client-scoped Ask citing the right
OneDrive financial plan as the top hit.

**Clean-slate re-test** (if you ever need an unambiguous re-import): delete the
workspace's `.keepance/onedrive-enc.db` (resets the delta cursor + item store →
full re-fetch; does **not** disconnect — the token stays in the keychain), clear
each matter's `onedriveFolderKeys` in the `keepance:matters` localStorage entry,
restart, then re-sync. Details and the exact steps are in the bench handoff.

---

## File map

| Layer | Path |
|---|---|
| Shared indexing foundation | [`src-tauri/src/commands/connector/mod.rs`](../../src-tauri/src/commands/connector/mod.rs) |
| Connector backends | `src-tauri/src/commands/{mail,crm,onedrive,calendly,docusign}/` |
| Command registration | [`src-tauri/src/lib.rs`](../../src-tauri/src/lib.rs) (`generate_handler!`) |
| Source-kind allowlist | [`src-tauri/src/commands/rag/store.rs`](../../src-tauri/src/commands/rag/store.rs) (`EXTERNAL_SOURCE_TYPE_ALLOWLIST`) |
| Matter mapping | [`src/platform/rag/matterResolver.ts`](../../src/platform/rag/matterResolver.ts) |
| Connector UI | `src/features/settings/*Connect.tsx`, surfaced in [`AccountWindow.tsx`](../../src/features/account/AccountWindow.tsx) |
| Onboarding "connect your data" | [`src/features/onboarding/v2/scenes/ConnectScene.tsx`](../../src/features/onboarding/v2/scenes/ConnectScene.tsx) + [`copy.ts`](../../src/features/onboarding/v2/copy.ts) |

## See also

- [RAG_PIPELINE.md](./RAG_PIPELINE.md) — what happens to connector text once it's
  indexed (chunking, embedding, the matter/privilege prefilters, cited answers).
- [RUST_BACKEND.md](./RUST_BACKEND.md) — the command layer, keychain usage, and
  the encrypted stores connector data lands in.

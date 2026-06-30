# OneDrive / SharePoint connector — build spec

**Branch:** `feat/connector-onedrive` (worktree `/home/jameson/kp-conn-onedrive`, based on `feat/connector-foundation`).
**Reuses:** the foundation layer (`build_batch_external`, `index_external_text_internal`, `SourceRef.kind='onedrive'`, `Matter.onedriveFolderKeys`, `OPEN_ONEDRIVE_EVENT`) + the existing Microsoft Graph client (`src-tauri/src/commands/mail/graph.rs`) + the CRM connector as the structural template (`src-tauri/src/commands/crm/`).
**Read first:** `docs/superpowers/specs/2026-06-27-connector-program-foundation.md` (§1, §2, §6 landmines) + this doc.

## Goal
Read-only, one-way sync of a OneDrive/SharePoint user's documents into Advisor Prep Hero: list files, download supported types, extract text REUSING the existing extractors, index as encrypted matter-scoped `onedrive` chunks → the Client Map + Ask light up automatically. Incremental via Graph delta. Mirrors the mail/CRM connector pattern.

## Auth — reuse the Microsoft login, but ISOLATED from email
- **Own scope string:** `offline_access openid User.Read Files.Read.All Sites.Read.All`.
- **Own keychain slot:** service `keepance-docs-ms`, key `ms-refresh-token`. (Separate from mail's `keepance-mail-ms` so connecting documents is independent of email; existing email users are unaffected; disconnecting docs never disconnects mail.)
- **Reuse the same Azure app** (`KEEPANCE_MS_CLIENT_ID` default `845ddba0-70ab-4f90-88ba-e3522157e37a`) and the same OAuth mechanics (loopback auth-code + PKCE; device-code as fallback).
- **Do NOT modify the working mail auth path.** `mail/oauth.rs` hardcodes its `SCOPES` const. Rather than touch it, give OneDrive its **own** small OAuth helper `onedrive/oauth.rs` parameterized by the OneDrive scope (it may freely reuse the PKCE/browser/loopback helpers and the token-exchange/refresh shapes — clone, don't mutate mail). A future task can unify mail+onedrive OAuth into one shared helper; NOT in this branch (zero risk to the demo's mail path). Store/refresh the OneDrive refresh token under the `keepance-docs-ms` slot.
- **`GraphClient` (`mail/graph.rs`) is shared + generic** (bearer auth, 429/Retry-After backoff, 410→DeltaGone). Reuse it as-is for JSON. It needs ONE additive method `get_bytes(&self, url) -> Result<Vec<u8>>` for file download (clone `get_json`'s auth/retry/error handling; never log raw bodies). Adding this method is additive and must not change `get_json`.

## Graph endpoints (v1.0 only)
- **Recursive list:** `GET /v1.0/me/drive/root/children`, then per-folder `GET /v1.0/me/drive/items/{id}/children`. `$select=id,name,parentReference,file,folder,size,lastModifiedDateTime,eTag,cTag,webUrl,remoteItem`, `$top=200`, follow `@odata.nextLink`.
- **Incremental:** `GET /v1.0/me/drive/root/delta` → pages carry `@odata.nextLink` (keep paging) then `@odata.deltaLink` (store opaque, reuse verbatim next sync). `410 Gone` → drop cursor, full delta again. `deleted` facet → remove that item's RAG chunks.
- **Download:** `GET /v1.0/me/drive/items/{id}/content` (and `/drives/{drive-id}/items/{id}/content`).
- **SharePoint:** `GET /v1.0/sites?search={q}` or resolve by URL → `GET /v1.0/sites/{id}/drives` → `/drives/{drive-id}/root/children` + `/drives/{drive-id}/root/delta` + `/drives/{drive-id}/items/{id}/content`. (Delegated flow: use `sites?search` / resolve-by-URL, not tenant-wide listing.)

## Text extraction — REUSE existing extractors (do NOT re-implement)
- DOCX: `keepance_docx::parse_docx_bytes(&bytes)` + `extract_paragraph_texts` (see `rag/mod.rs`).
- XLSX/PPTX/RTF: `rag::office::extract_xlsx_sections` / `extract_pptx_sections` / `extract_rtf_text`.
- TXT/MD: `String::from_utf8`.
- **Factor a public additive helper** `rag::index_downloaded_document_bytes(table, source_id, filename, bytes, matter_id, privilege, key, cancel)` reusing the SAME extraction branches + `chunker::chunk_text` + `embedder::embed_documents_batched` + `store::upsert_*`. This is additive to `rag/mod.rs` (do not change the existing local-file walker).
- **PDF — scope decision:** there is no Rust PDF text extractor (`src/lib/pdf-extract.ts` is renderer-side). For v1, index the office + text formats above (fully Rust, robust). For PDF: investigate whether the existing PDF pipeline (`rag::pdf_indexer::index_pdf_chunks`) can be cleanly reused Rust-side; if yes, include PDF; if it requires the frontend, IMPLEMENT office/text now and leave PDF as a clearly-flagged fast-follow (store the file metadata + a tombstone-free "pending-pdf" marker so it indexes the moment the path lands). Report which path you took.

## Source ids + matter mapping
- Source ids: `onedrive:{drive-id}:{item-id}` and `sharepoint:{site-id}:{drive-id}:{item-id}`.
- **Matter mapping by folder** (advisors think "this folder = this matter"): `Matter.onedriveFolderKeys` (added in foundation), key shape `m365/default/{drive-id}:{normalized-folder-path}` (SharePoint: `m365/default/{site-id}/{drive-id}:{path}`). During sync, build the item's normalized cloud folder path from `parentReference.path`+`name`, pick the LONGEST matching `onedriveFolderKeys` entry → that matter id; no match → `UNASSIGNED_MATTER`. Store `driveId` so same-named folders in different drives don't collide. Fill in `buildOneDriveMatterMap` (foundation shell).

## Module layout (mirror `commands/crm/`)
`src-tauri/src/commands/onedrive/`: `mod.rs`, `oauth.rs`, `client.rs` (Graph doc methods: list_root_children/list_children/delta_root/download_content/search_sites/list_site_drives), `source.rs` (trait seam `DocumentSource` for offline tests), `model.rs` (DriveItem/Drive/Site/delta tombstone/cursor structs), `store.rs` (encrypted `.keepance/onedrive-enc.db`: cursors, item metadata, content hashes, mapped source ids, fetched-vs-indexed status — DO NOT store raw file bytes), `engine.rs` (delta loop: cursor→delta→download changed supported files→index→delete chunks for tombstones→save deltaLink; single-flight; bounded concurrency; `onedrive-sync-progress` event; fetched-vs-indexed repair), `render.rs` (bytes→text adapter calling the rag/office/docx helpers), `commands.rs` (`onedrive_connect/disconnect/is_connected/list_drives/list_folders/sync/cancel/status` + keychain token mgmt + audit).
- Frontend: `src/platform/utils/onedrive-commands.ts` (clone mail-commands), `src/features/onedrive/` (store + useOneDriveSync hook + an `OPEN_ONEDRIVE_EVENT` listener panel for citations), `src/features/settings/OneDriveConnect.tsx` (connect UI; honest copy: "imports what this Microsoft login can see"; reuses the folder→matter mapping UI pattern).
- Register append-only in `src-tauri/src/commands/mod.rs` + `src-tauri/src/lib.rs` (invoke_handler + manage_state).

## Hard rules (from foundation §6)
Read-only (GET only; never write to Graph). Pass a real `matter_id` or `UNASSIGNED_MATTER` to `index_external_text_internal`/the rag helper. Chunk text encrypted via `build_batch_external`/the rag helpers (never plaintext). Cap bulk indexing concurrency. Respect Local-only mode (egress guard covers doc-derived content). Never invent a Client/Folder entity — map to a Matter. Never rename `matter_id`.

## Tests (TDD; robust)
- Rust: a `DocumentSource` fake (mirroring CRM's `FakeCrmSource`) driving the engine offline through a fixture drive (folders + docx/xlsx/txt items + a delta tombstone) — assert: correct chunks indexed per matter via folder mapping, tombstone removes chunks, unchanged-by-hash items skipped, fetched-vs-indexed repair. A round-trip integration test indexing one downloaded docx fixture → encrypted chunk → retrievable (mirror `external_fixture_import.rs`). Delta-cursor persistence + 410-reset test.
- Frontend: Vitest for `buildOneDriveMatterMap` (longest-prefix folder match, drive-id disambiguation) + onedrive-commands wiring.
- Gate: `npm run typecheck` + the new Rust tests + new Vitest green; existing mail/crm/rag tests still green.

## Live test (coordinate via coordinator — needs the Legion bench + the Azure scope grant)
After gate-green: ping coordinator to (a) confirm the Azure `Files.Read.All`/`Sites.Read.All` grant is in place, (b) reserve the Legion. Then drive the desktop app: connect a real OneDrive (Microsoft login), map a folder to a matter, sync, confirm the documents appear in Ask/Client Map with `onedrive` citations that open the viewer.

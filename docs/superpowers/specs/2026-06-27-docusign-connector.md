# DocuSign connector — build spec

**Branch:** `feat/connector-docusign` (worktree `/home/jameson/kp-conn-docusign`, based on `feat/connector-foundation`).
**Reuses:** the foundation layer (`build_batch_external`/`index_external_text_internal` with `source_type='esign'`, `SourceRef.kind='esign'`, `Matter.esignKeys`, `OPEN_ESIGN_EVENT`) + the CRM connector as the structural template (`src-tauri/src/commands/crm/`) + the existing PKCE/loopback OAuth helpers used by the mail connector.
**Read first:** `docs/superpowers/specs/2026-06-27-connector-program-foundation.md` (§1, §2, §6) + this doc.

## Goal
Read-only, one-way sync of a user's DocuSign **completed envelopes** (signed agreements), their recipients, the signing **audit trail**, and the signed **PDF** documents into Advisor Prep Hero → indexed as encrypted matter-scoped `esign` chunks → Client Map/Ask light up, with citations that open a virtual "DocuSign · <agreement>" viewer. Mirrors the CRM connector (object-level sync engine + durable encrypted store + render-to-text + index).

## Auth — Authorization Code Grant + PKCE (NOT JWT)
- **Flow:** OAuth 2.0 Authorization Code + PKCE (public client), exactly the shape the mail connector already uses for loopback login. Reuse those PKCE/loopback/browser helpers; DocuSign-specific URLs + token storage live in `docusign/oauth.rs`.
- **Scopes:** `signature extended` (`extended` → refresh tokens). **There is NO read-only scope** — `signature` is broad. **Advisor Prep Hero MUST enforce read-only in code:** a hard allowlist of GET-only endpoints; the client has NO method that can POST/PUT/DELETE/void/send. This is a security requirement, not a nicety.
- **Integration key (client id):** Advisor Prep Hero's own DocuSign integration key, read from `KEEPANCE_DOCUSIGN_CLIENT_ID` (with a demo-sandbox default, mirroring `KEEPANCE_MS_CLIENT_ID`). *(Coordinator item: a demo integration key from a free DocuSign developer account is needed for live-test; production needs go-live. Build + tests do NOT need a live account.)*
- **Token storage:** own keychain slot, service `keepance-docusign`, refresh token + the resolved `accountId` + `base_uri`. Refresh on expiry (DocuSign access tokens are short-lived; `extended` gives a long-lived refresh token).
- **Environments:**
  | | Demo | Production |
  |---|---|---|
  | OAuth (authorize/token/userinfo) | `https://account-d.docusign.com` | `https://account.docusign.com` |
  | eSignature REST API | `https://demo.docusign.net/restapi` | from `/oauth/userinfo` `base_uri` + `/restapi` |
- After token, call `GET {oauth}/oauth/userinfo` → pick the account → **store `accountId` + `base_uri`** (`apiBase = {base_uri}/restapi`). Demo↔prod do not share tokens/accounts/envelopes — on go-live the user reconnects against prod and we re-resolve userinfo.

## Read endpoints (all GET; `apiBase = {base_uri}/restapi`)
- **List completed envelopes:** `GET {apiBase}/v2.1/accounts/{accountId}/envelopes?from_date=...&status=completed&include=recipients,documents,custom_fields` (test `folder_types=normal,inbox,sentitems` for received vs sent). `listStatusChanges` caps 1,000/page; requires `from_date` (else only ~last 2 years) → **sync in date windows**, page via `start_position`/`nextUri`.
- **One envelope:** `GET .../envelopes/{envelopeId}?include=recipients,documents,custom_fields`.
- **Recipients:** `GET .../envelopes/{envelopeId}/recipients?include_extended=true`.
- **Documents list + download:** `GET .../envelopes/{envelopeId}/documents`, `GET .../envelopes/{envelopeId}/documents/{documentId}` (signed PDF), `.../documents/combined?certificate=true`, `.../documents/certificate`.
- **Audit/signing history (source of truth):** `GET .../envelopes/{envelopeId}/audit_events`.
- **Rate limits:** ~3,000 calls/hr/account + a 30s burst window — read `x-ratelimit-*` / `x-burstlimit-*` headers; token-bucket + backoff. **Do not re-poll a specific envelope more than once / 15 min.** Avoid per-envelope calls until a specific agreement is imported/opened.

## Records to index + matter mapping
Index granular records (foundation §, mirror Wealthbox §5.3) under `esign` chunks, all matter-tagged:
- **EnvelopeAgreementRecord** (`docusign:{accountId}:{envelopeId}`): subject, status, created/sent/completed dates, sender, recipients (name/email/role/status), document names, custom fields, source folder. → render to readable text.
- **SigningEventRecord** (`docusign:{accountId}:{envelopeId}:event:{eventId|hash}`): event type, recipient, timestamp, auth details — from `audit_events`.
- **SignedDocumentRecord** (`docusign:{accountId}:{envelopeId}:doc:{documentId}`): the signed PDF's extracted text. **PDF text extraction** — DocuSign documents are PDFs; reuse Advisor Prep Hero's existing PDF pipeline (`rag::pdf_indexer` / the frontend `pdf-extract.ts` path). If clean Rust-side reuse isn't available, index the envelope+audit+recipient metadata now and flag PDF-body extraction as a fast-follow (same decision shape as the OneDrive PDF note); REPORT which path you took.
- **Matter mapping** (`Matter.esignKeys`, fill in `buildEsignMatterMap`): match an envelope to a Matter by (1) recipient email exact, (2) sender email, (3) fuzzy recipient/sender name vs client names, (4) subject/custom-field; ambiguous/low-confidence → `UNASSIGNED_MATTER` + surface in a "Needs assignment" list; a manual assignment saves a reusable rule (email/domain/custom-field → matter).

## Module layout (mirror `commands/crm/`)
`src-tauri/src/commands/docusign/`: `mod.rs`, `oauth.rs` (auth-code+PKCE, userinfo, refresh, keychain), `client.rs` (GET-only DocuSign HTTP: token-bucket + `x-ratelimit` aware; methods list_envelopes/get_envelope/list_recipients/list_documents/download_document/get_audit_events; **no write methods exist**), `source.rs` (trait seam `EsignSource` for offline tests), `model.rs` (Envelope/Recipient/Document/AuditEvent structs), `store.rs` (encrypted `.keepance/docusign-enc.db`: envelopes + audit + content hashes + cursors + fetched-vs-indexed + tombstones), `engine.rs` (object-level sync: date-window envelope pull → upsert → affected-matter set → render + index; single-flight; `docusign-sync-progress` event; bounded concurrency; repair), `render.rs` (envelope/event/document → text), `commands.rs` (`docusign_connect/disconnect/is_connected/sync/cancel/status/list_unassigned` + keychain + audit).
- Frontend: `src/platform/utils/docusign-commands.ts`, `src/features/docusign/*` (store + useDocusignSync + `OPEN_ESIGN_EVENT` citation panel showing the agreement + signing timeline), `src/features/settings/DocuSignConnect.tsx` (connect UI; honest copy). Register append-only in `commands/mod.rs` + `lib.rs`.

## Hard rules
**Read-only by code (GET-only allowlist; client cannot write/void/send).** Pass real `matter_id` or `UNASSIGNED_MATTER`. Chunk text encrypted only via the foundation/rag helpers. Cap indexing concurrency. Respect Local-only mode (egress guard covers e-sign-derived content — signed agreements are sensitive client data). Never invent an Agreement/Client entity — map to a Matter. Never rename `matter_id`. Do NOT modify the working mail/CRM paths (reuse the shared PKCE/OAuth helpers without mutating mail's behavior; clone where needed).

## Tests (TDD, robust)
- Rust: an `EsignSource` fake (mirror `FakeCrmSource`) over a fixture account (completed envelopes + recipients + audit events + a signed-PDF fixture): assert correct per-matter chunks via recipient-email mapping, ambiguous → unassigned + needs-assignment list, hash-unchanged envelopes skipped, audit events become event records, the read-only client exposes no write method (compile-time/structural). A round-trip integration test indexing one rendered envelope → encrypted `esign` chunk → retrievable (mirror `external_fixture_import.rs`). Date-window pagination + cursor persistence test.
- Frontend: Vitest for `buildEsignMatterMap` (email/name matching + needs-assignment) + docusign-commands wiring.
- Gate: `npm run typecheck` + new Rust tests + new Vitest green; existing mail/crm/rag tests still green.

## Live test (coordinate via coordinator — needs a DocuSign demo account/integration key + the Legion)
After gate-green: ping coordinator re: the demo integration key. Then drive the desktop app: connect the DocuSign demo account, send+sign a test envelope in the sandbox, sync, confirm the signed agreement + signing timeline appear in Ask/Client Map with `esign` citations.

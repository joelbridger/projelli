# CODEX BUILD BRIEF — Lantern Intake Wave 1, Lane B: Relay (backend)

You are a Codex build agent. Build exactly the scope below, TDD, commit on your branch. **Do NOT push. Do NOT touch files outside `backend/`.** Wrapper appends the DONE-EXIT sentinel.

> NOTE: Lane A has merged. Its wire types are in `src/platform/intake/intakeContract.ts` (frontend). You mirror them in `backend/`. Read that file first; keep the two in sync field-for-field.

## Context to read first
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §3 (endpoints, storage, honest metadata list — VERBATIM contract), §2 (key model, replay protection), §8 (T4/T9 threats).
- `docs/plans/lantern-plus/intake/W1-EXEC-PLAN.md` §3 Lane B.
- `docs/plans/lantern-plus/intake/RISKS.md` §7 (durable duplicate-submission_id rejection).
- **Reuse these real backend patterns (read them):**
  - `backend/src/server.ts` — manual `path`/`method` dispatch. Add your intake routes beside the `/matter/:id/...` block, same style. Note the `/matter/:id/...` sub-path parser.
  - `backend/src/lib/db.ts` — the single `SCHEMA` string + `Store` class (`bun:sqlite`). Append your tables to `SCHEMA`; add `Store` methods next to the `matter_updates` ones.
  - `backend/src/lib/crypto.ts` — `hmacHash`, `hmacEquals` (constant-time), `generateSecretToken`. Store only `HMAC(t_auth)`, never `t_auth`.
  - `backend/src/routes/seats.ts` + `backend/src/lib/services.ts` `validateSeatToken` — how seat-token auth works (Ed25519, `X-Seat-Token`). Advisor endpoints require it.
  - `backend/src/lib/matters.ts` `MAX_UPDATE_BYTES` + size-cap discipline — ciphertext is opaque; the size cap is the only shape check.
  - `backend/src/lib/http.ts` — `json`, `error`, `readJson`, rate-limit helpers.
  - An existing route test: `backend/test/matters.test.ts` — drives `Store` + service directly against `new Store(":memory:")`. Follow this harness. Run with `bun test`.

## Endpoints (new route group `backend/src/routes/intake.ts`, wired in `server.ts`)

**Advisor-authenticated** (`X-Seat-Token`, Ed25519-verified as `/seat/validate`; attach org context from JWT when present):
- `POST /intake` — create: store `{intake_id, seat/org identity, token_hash=HMAC(t_auth), expires_at, status='active', checklist_ciphertext, state_ciphertext, checklist_version=1}`.
- `PUT /intake/:id/checklist` — replace sealed checklist; bump `checklist_version`.
- `GET /intake/:id/inbox?cursor=` — list submitted items' envelopes since cursor (metadata + ciphertext refs only).
- `GET /intake/:id/blob/:blob_id` — download a ciphertext chunk.
- `POST /intake/:id/ack` — body lists acked submission/blob ids → **DELETE the acked ciphertext rows** (retention minimization; relay is a mailbox).
- `POST /intake/:id/revoke` — `status='revoked'`. `POST /intake/:id/extend` — push `expires_at`.

**Public** (`Authorization: Bearer t_auth`; constant-time HMAC compare; rate-limited per intake AND per IP; read no body until the token passes):
- `GET /intake/:id/bundle` — returns `{checklist_ciphertext_b64, state_ciphertext_b64, checklist_version, finalized_item_ids}`. `finalized_item_ids` comes from the server's OWN finalization records (never from the writable state — §2).
- `PUT /intake/:id/state` — save sealed resume state; **hard cap ~64 KiB**.
- `POST /intake/:id/item/:item_id/chunk` — one ciphertext chunk. Caps: **≤4 MiB/chunk, 100 MB/file, 500 MiB/intake total (defaults)**. Store keyed by **`(intake_id, item_id, submission_id, index)`** — NEVER item+index alone (two concurrent submissions to one open item must not collide on index 0).
- `POST /intake/:id/item/:item_id/submit` — finalize: body `{submission_id (plaintext), manifest_ciphertext_b64, wrapped_content_key_b64}`. Mark prior chunks for this submission bound; **reject duplicate `submission_id`** (durably — see below); record a finalization row.

## Hard requirements (these are the review's attack surface)
1. **Uniform neutral 410** for expired / revoked / unknown / wrong-token — same body, same status, AFTER the same constant-time token check. For unknown ids (no stored hash) compare against a FIXED DECOY HASH with the identical `hmacEquals` routine, so timing cannot distinguish "wrong token on a live intake" from "no such intake." Write a test proving all four paths are indistinguishable in shape.
2. **Store only `HMAC(t_auth)`**, never the raw token. Never store `client_name`, item labels, answers, or file names — those live only inside ciphertext the relay cannot read. IP/UA: rate-limit buckets in memory + access-log ceiling 24h; NOT durable columns.
3. **Durable duplicate-`submission_id` rejection** — a DB uniqueness constraint / row check, NEVER an in-memory Set (a restart must not reopen the replay window).
4. Ciphertext is opaque bytes; the only shape check is the size cap. Do not parse or validate blob contents.
5. Chunk keying prevents the two-device index-0 collision (test it).

## New tables (append to `SCHEMA` in `db.ts`)
`intakes` (intake_id PK, org/seat identity, token_hash, expires_at, status, checklist_ciphertext, state_ciphertext, checklist_version, created_at, revoked_at); `intake_chunks` (id, intake_id, item_id, submission_id, idx, ciphertext, size, created_at — UNIQUE(intake_id,item_id,submission_id,idx)); `intake_submissions` (intake_id, item_id, submission_id, manifest_ciphertext, wrapped_content_key, created_at — UNIQUE(intake_id,submission_id) for durable replay rejection, plus a finalization flag/row per item); `intake_state` handled on the `intakes` row. Add `Store` accessor methods for each.

## Tests — `backend/test/intake.test.ts` + `backend/test/intake-privacy-proof.test.ts` (bun test)
- **STANDING PRIVACY-PROOF TEST** (`intake-privacy-proof.test.ts`): drive an honest-client submission end to end through the Store/service, then dump EVERY stored row and blob and assert NONE contains a plaintext client value, file name, client name, or item label; and assert no `restricted`-tier fact ever ships outbound in a bundle. This test is a STANDING GATE — keep it green forever.
- Uniform-410 shape identical across expired/revoked/unknown/wrong-token (incl. the decoy-hash path).
- Ack deletes the acked ciphertext rows.
- Two concurrent submissions to one open item both persist (chunk keying by submission_id, no index-0 collision).
- Oversized chunk / oversized state rejected at the cap.
- Duplicate `submission_id` rejected, AND still rejected after a simulated `Store` reopen (durability).
- Bundle's `finalized_item_ids` derives from finalization records, not from a written state blob.
- Seat-token gate: advisor endpoints reject a missing/invalid seat token.

## Constraints
- TDD, real assertions. Match backend idiom (Bun, `bun:sqlite`, the `Store` + service split, `json`/`error` helpers).
- No new dependencies. Run `bun test` in `backend/` — all green — and `bunx tsc --noEmit` (or the repo's backend typecheck) clean before done.
- Commit on your branch. Do NOT push. Do NOT edit outside `backend/`.

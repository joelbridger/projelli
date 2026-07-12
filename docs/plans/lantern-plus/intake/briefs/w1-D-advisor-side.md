# CODEX BUILD BRIEF — Lantern Intake Wave 1, Lane D: Advisor-side (TS + a little Rust)

You are a Codex build agent. Build exactly the scope below, TDD, commit on your branch. **Do NOT push. Do NOT touch `backend/`, `intake-page/`, or `src/platform/intake/intakeCrypto.ts|types.ts|intakeLink.ts|intakeContract.ts` (Lane A owns those — import them).** Wrapper appends the DONE-EXIT sentinel.

> This is the ONLY Rust lane in Wave 1. Run at most ONE cargo compile at a time (the box serializes cargo on a shared target dir; a blocked job self-aborts). Build/test Rust deliberately, not in parallel with other cargo.

## Context to read first
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §5 (where decrypted data lands — the authoritative table), §2 (link lifecycle, regeneration re-seals both ciphertexts), §6 (link lifecycle), §9 (ClientFact rules — append-only supersede chains, one active per (matter_id,subject,kind)).
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §3 (New client → compose → send), §5 (per-client Onboarding tab), §2 (locked "New household" template).
- `docs/plans/lantern-plus/intake/W1-EXEC-PLAN.md` §3 Lane D.
- **Reuse these real patterns (read them):**
  - `src/features/matters/NewClientDialog.tsx` + `src/features/matters/matterManagerDialogHelpers.ts` (`clientFolderSegment`, `deriveNewClientFolderPath` at lines 53,73) — client creation + one-folder-per-client.
  - `src/features/matters/MatterHub.tsx` — `HUB_TABS` (~line 93). Add an Onboarding tab entry, shown when the client has an intake.
  - `src/platform/firm/MatterSyncClient.ts` — model `IntakeSyncClient` on it (inbox → decrypt → route → ack).
  - `src/platform/firm/firmKeychain.ts` — keychain service naming (`com.lantern.<domain>.<id>`, `matterService`). Intake keys go under `com.lantern.intake.<intake_id>`.
  - `src-tauri/src/commands/crm/store.rs` (SQLCipher store pattern, ~line 247) + `src-tauri/src/commands/crm/commands.rs` (audit pair machinery ~line 644,1126 — intent row before external effect, refuse if audit append fails) — model the facts store + audit on these.
  - `src-tauri/src/commands/vault/mod.rs` (keychain-held master secret precedent) + `src-tauri/crates/lantern-vault/src/format.rs` (KPV1 at-rest).
  - Import Lane A: `unwrapContentKey`, `openItemChunk`, `openManifest`, `verifySubmissionIntegrity`, `generateIntakeKeypair`, `buildLinkFragment`, `derivePageKey`, `deriveAuthToken` from `@/platform/intake/*`; and `matterCrypto`-style sealing for the checklist/state under `k_page`.

## Scope (build all)

### 1. Compose flow (`src/features/intake/` + extend `NewClientDialog`)
- Extend the New client path with a minimal **checklist editor** pre-loaded with the locked "New household" template: welcome card, DOB (typed), SSN (typed, restricted, masked), driver's license (doc_upload, two slots), income (guided + optional upload), spending (guided), what-happens-next card. Add / remove / reorder / re-word before send. This is a checklist editor, NOT a form builder (no drag canvas, no conditional logic).
- Review + send screen: link preview as the client will see it (their first name, firm brand), expiry shown plainly ("This link works for 30 days. You can extend or turn it off anytime."), `[Copy link] [Open email draft (mailto:)] [Copy text for SMS]`. Sending is copy-first (keeps the client's address off our server).

### 2. Link mint + controls
- On send: `generateIntakeKeypair()`; generate 256-bit link secret `s`; write the intake PRIVATE key + `s` to the OS keychain (`com.lantern.intake.<intake_id>`); seal the checklist + initial resume state under `k_page = derivePageKey(s)`; `POST /intake` to the relay with `HMAC`-able `t_auth` (send `deriveAuthToken(s).tokenB64`; relay stores the hash); build the link via `buildLinkFragment`.
- **Link controls — ALL ship in Wave 1** (the leaked-link answer ships with the first link): copy again, extend, revoke, **regenerate**. Regenerate mints a new `s` (new `t_auth`, new `k_page`) for the SAME intake + SAME keypair, kills the old link, and **re-seals BOTH `checklist_ciphertext` and `state_ciphertext` under the new `k_page`** (else the new link can't decrypt them — this re-seal is a Wave 1 gate; test it).

### 3. Minimal manual fact entry
- Advisor can type a value directly with `provenance.channel:'manual'`, `entered_by:<advisor id>`. This makes the client page's "call [advisor] and do it together" restricted-field fallback honest in Wave 1. (Full phone-walkthrough mode is Wave 5.)

### 4. `IntakeSyncClient` (`src/platform/intake/IntakeSyncClient.ts`, modeled on `MatterSyncClient`)
- Fetch inbox since cursor → for each submission: `unwrapContentKey` with the keychain private key → `openManifest` + `openItemChunk` each chunk → `verifySubmissionIntegrity(plaintextSid, manifest, chunkAADSids)` (reject + flag on mismatch — replay/relabel defense) → route by payload type → **ack ONLY after the local durable write succeeds** (ack-last: a crash between decrypt and write must re-deliver).
- Dedupe by the DECRYPTED manifest id. Flag duplicates + "new device" submissions (unfamiliar session marker) for the board; never silently overwrite a newer answer.

### 5. SQLCipher facts store (`src-tauri/src/commands/intake/`, CRM-store pattern) — RUST
- Typed secrets (SSN, DOB, DL refs) stored encrypted, keyed by `matter_id`. `ClientFact` rows: append-only with supersede chains (a correction is a NEW fact superseding the old, `superseded_by`); enforce ONE active fact per `(matter_id, subject, kind)`.
- Accessor enforces masking-by-sensitivity: `restricted` renders `•••-••-1234`, revealed only via an explicit reveal that WRITES AN AUDIT ROW (append-only encrypted audit store, CRM pattern). Export/copy of a restricted fact also audits.
- Every intake receipt writes an intent/outcome audit PAIR (intent = "item received, filing to folder/facts" BEFORE the effect; outcome = confirmed with file path / fact id). **Refuse the write if the audit append fails** (mirror the CRM engine).
- Tauri commands: `intake_fact_upsert`, `intake_fact_list(matter_id)` (masked), `intake_fact_reveal(fact_id)` (audits), `intake_fact_purge(matter_id, kind?)` (per-item delete + audit row — the QUESTIONS #4 retention control).

### 6. Filing + stores
- Documents → `WorkspaceService` → the client's folder under `Requests/onboarding/` (the §9a convention from day one; Wave 7 never re-files). Vault KPV1 at rest when the vault is on; nudge-once plainly when vault is off and the first intake lands.
- `src/platform/intake/intakeStore.ts` (Zustand): non-sensitive item states, timestamps, `fact_id` refs, provenance. **NO last-4 or any value fragment ever enters ordinary app state** — masked renderings are produced on demand by the facts-store accessor.
- `src/platform/intake/factsStore.ts`: the ONE accessor features read through (masking policy by tier). Features never query SQLCipher directly.

### 7. Onboarding tab v0 (`MatterHub` `HUB_TABS`)
- Shown when the client has an intake. Renders: the checklist with true item states + **provenance chips** ("typed by client", "entered by you", "manual"), masked facts (reveal writes audit), link controls (copy/extend/revoke/regenerate), received items with "view in folder" jump, and per-item purge. Light theme; governed by the UI-INTEGRATION-SPEC §5 (frontend-design polish + screenshots in the merge note).

## Tests
- **Vitest (TS):** IntakeSyncClient routing + ack-last (crash-before-write re-delivers); replay/duplicate flagging via `verifySubmissionIntegrity`; masking accessor never emits full value into ordinary state; **regeneration re-seals checklist+state so the new link decrypts and the old fails**; provenance chips.
- **`cargo test` (Rust):** facts store supersede chain (one active per key); masking; reveal writes an audit row; audit-append-failure REFUSES the write; purge deletes + audits. Run cargo SERIALLY.

## Constraints
- Never rename `matter`/`matter_id`. Light theme. User copy says client/household, no em dashes, no time estimates.
- No autonomous AI, no plaintext to localStorage, restricted values SQLCipher-only.
- TDD, real assertions. Match repo idiom (strict TS, `@/` alias, Zustand `use*Store`, the CRM Rust store shape).
- Before done: `npx vitest run src/platform/intake src/features/intake` green; `cargo test` for the new intake commands green (serialized); `npx tsc --noEmit` clean. Commit on your branch. Do NOT push.

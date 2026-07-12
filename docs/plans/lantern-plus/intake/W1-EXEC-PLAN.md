# Lantern Intake — Wave 1 Executable Plan

**Wave lead / reviewer:** Opus 4.8 · high (this session).
**Contract sources:** `WAVE-PLAN.md` (Wave 1 section), `ARCHITECTURE.md` (§2–§9a), `PRODUCT-DESIGN.md` (§6, §10), `RISKS.md` (claims discipline), `QUESTIONS-FOR-JAMESON.md` (all 5 decided).
**Branch:** program branch `lp/intake` (worktree `~/lp-intake`), off `lp/ux-simplify-v1` tip `3939b96c`. Lanes branch `lp/intake-w1-<slug>` off `lp/intake`, merge back `--no-ff`.
**Builders:** Codex lanes (`codex exec`/`codex-task`, own worktree, DONE-EXIT sentinel, liveness-watched). **Reviewers:** this session reads every diff + one `codex-review --base lp/intake` adversarial pass per lane from a *different* codex call. Codex never solo-reviews its own lane.

Goal (locked by the brief): an advisor presses **New client**, sends a link; the client completes DOB, SSN, license front/back, income, spending on their phone; everything round-trips E2EE; files land in the client's folder, typed facts in an encrypted store, checklist state shows on the client page.

---

## 0. Non-negotiables every lane inherits

- **E2EE bar is absolute for the link machinery.** The honest client sends only ciphertext; the relay holds no key to read anything. Any lane that cannot meet this STOPS and escalates to the coordinator — it never ships a server-readable path.
- Never rename `matter`/`matter_id`. Light theme. User copy says **client/household**, never "matter". No em dashes in client-visible copy. No time estimates anywhere.
- The **standing privacy-proof test** (WAVE-PLAN "Privacy proof is a standing gate") ships in Wave 1 and stays green forever after.
- Robust, no shortcuts (core product). TDD: one behavior test per unit, red → green.
- Claims discipline (RISKS §2): never "zero-knowledge", "bank-level", "military-grade", "SOC 2", "HIPAA compliant". The client headline "this page locks your information on your device; only [Firm] can unlock it" is permitted only while the page-integrity gate (Lane E) holds.

## 1. Execution order (the critical path)

```
Lane A (contracts + crypto)  ──► merges ALONE to lp/intake first
        │
        ├──► Lane B (relay)          ┐
        ├──► Lane C (client page)    ├─ dispatched IN PARALLEL once A lands
        ├──► Lane D (advisor-side)   │  (briefs rebased on A's real exports)
        └──► Lane E (hosting)        ┘
```

Lane A's types + crypto wrappers are the contract every other lane imports. Parallel fan-out of B/C/D/E is fine (8–12 codex jobs OK). **Only ONE cargo/Rust compile at a time on this box** — Lane D has the only Rust; serialize its cargo runs with any gate cargo run.

---

## 2. File structure (net-new; nothing here exists today — verified)

| Path | Lane | What |
|---|---|---|
| `src/platform/intake/types.ts` | A | `ClientFact`, `FactKind` registry (full, versioned), `FactValue`, `FormRequest`/`RequestItem` (§9a), `PdfPrefill`/`PrefillMode`, sensitivity tiers, `FACT_KIND_SENSITIVITY` map |
| `src/platform/intake/intakeContract.ts` | A | Relay wire contract (envelopes, manifest, chunk, bundle shapes) — mirrored by `backend/src/intakeContract.ts` |
| `src/platform/intake/intakeLink.ts` | A | Link fragment build/parse codec (`#v1.<b64 s>.<b64 pub65B>`) |
| `src/platform/intake/intakeCrypto.ts` | A | Intake sibling of `keyWrap`/`matterCrypto`: HKDF derivations, content-key wrap/unwrap, item-payload seal/open with chunk AAD, keypair gen, submission-integrity verify |
| `src/platform/intake/__tests__/*.test.ts` | A | Exhaustive round-trip + tamper vitest suite |
| `backend/src/routes/intake.ts` | B | Relay endpoints (§3) |
| `backend/src/intakeContract.ts` | B | Backend mirror of the wire contract |
| `backend/src/lib/db.ts` (append tables) | B | `intakes`, `intake_chunks`, `intake_submissions`, `intake_state` in the one SCHEMA string |
| `backend/test/intake.test.ts` + `backend/test/intake-privacy-proof.test.ts` | B | Bun tests incl. the standing privacy-proof gate |
| `intake-page/` (new static SPA workspace) | C | Mobile-first client page + Playwright/axe suite |
| `src/features/intake/*` | D | Advisor compose flow, link controls, Onboarding tab v0 |
| `src/platform/intake/IntakeSyncClient.ts`, `intakeStore.ts`, `factsStore.ts` | D | Sync-down, checklist state (Zustand), facts accessor |
| `src-tauri/src/commands/intake/` | D | SQLCipher facts store (CRM-store pattern), keychain writes |
| `intake-page/deploy/` + `infra/intake/` | E | Staged deploy + integrity check + headers |

---

## 3. Lane briefs (detailed briefs live in `briefs/w1-<lane>.md`)

Each lane brief contains: exact scope from WAVE-PLAN Wave 1 lane text; file paths; the tests it must write and pass; "commit on this branch, do NOT push, do NOT touch other lanes' files"; the DONE-EXIT sentinel. Briefs for B/C/D/E are finalized against Lane A's real exports the moment A merges.

### Lane A — Contracts + crypto core (TS, the only blocker)

**Modules** (all pure, WebCrypto-only, run outside Tauri; unwrap takes the private key as a parameter — keychain plumbing is Lane D, keeps A pure/testable):

1. **`types.ts`** — `ClientFact` verbatim from ARCHITECTURE §9. `FactKind` = the full versioned union incl. not-yet-collected kinds Schwab needs: `'dob' | 'ssn' | 'income_annual' | 'spending_monthly' | 'drivers_license' | 'address' | 'citizenship' | 'employer' | 'beneficiary'` (extensible). `FACT_KIND_SENSITIVITY` locks each kind's tier now (`ssn`,`drivers_license` → `restricted`; `income_annual`,`spending_monthly`,`dob` → `confidential`; rest → `standard`). `FormRequest`/`RequestItem` from §9a with `schema_version` (from Wave 1), `kind:'onboarding'|'standing'`, and the later item types (`pdf_fill`, `signature`) **declared now** so Waves 7–10 evolve additively. `PdfPrefill`/`PrefillMode` with the type-level invariant that `restricted` never gets `'visible_prefill'`.
2. **`intakeLink.ts`** — `buildLinkFragment(s, intakePubRaw65B)` → `v1.<b64url s>.<b64url pub>`; `parseLinkFragment(fragment)` → `{ version, s, intakePubRaw }` or a typed parse error. Round-trip + malformed-input tests.
3. **`intakeCrypto.ts`** — the crypto core, sibling of `keyWrap.ts`/`matterCrypto.ts` reusing their exact wire formats but with intake HKDF info + AAD:
   - `generateIntakeKeypair()` → `{ privateKey: CryptoKey, publicKeyRaw: Uint8Array(65) }` (ECDH P-256).
   - `derivePageKey(s)` = HKDF-SHA256(s, info `"intake/page/v1"`) → AES-256-GCM `CryptoKey`.
   - `deriveAuthToken(s)` = HKDF-SHA256(s, info `"intake/auth/v1"`) → 32 bytes; expose `authTokenB64` (bearer) + the server-side hint that `HMAC(t_auth)` is what the relay stores (relay does the HMAC; Lane A provides the token bytes).
   - `wrapContentKey(contentKeyB64, intakePubRaw65B)` / `unwrapContentKey(wrappedB64, intakePrivateKey)` — **same construction as `keyWrap.ts`** (ECDH ephemeral P-256 + HKDF + AES-256-GCM, identical 65B/16B salt/12B IV wire layout) but HKDF info `"intake/item/v1"` and GCM AAD `"intake/item/v1"`. Reuse the file's byte-layout helpers.
   - `sealItemChunk(contentKey, plaintext, {intakeId, itemId, submissionId, index})` / `openItemChunk(...)` — sibling of `matterCrypto.encryptUpdate`/`decryptUpdate` (`[1B ver][12B IV][ct+tag]`) with GCM AAD **exactly** `intake:<id>:item:<item_id>:submission:<sid>:chunk:<n>` so chunks can't be reordered, transplanted across items/intakes/submissions, or mixed between submissions.
   - `generateContentKey()`, `generateSubmissionId()`.
   - `verifySubmissionIntegrity(plaintextSid, sealedManifest, chunkAADs)` → asserts plaintext id === sealed manifest id === every chunk AAD's sid; any mismatch → rejected (this is the replay-relabel defense; the authoritative id is the sealed one).
4. **`intakeContract.ts`** — the wire types shared with the relay: `SubmissionEnvelope`, `SealedManifest` (file names, chunk hashes, content type, `submission_id` live *inside* the ciphertext), `ChunkUpload`, `BundleResponse` (sealed checklist + sealed state + `checklist_version` + per-item finalization flags), `StateBlob`.

**Exhaustive tamper suite (vitest) — all must pass:**
- Round-trip: wrap→unwrap content key; seal→open chunk; derive page key both sides; link build→parse.
- Wrong AAD fails (chunk opened with any altered `{itemId|submissionId|index|intakeId}` → auth_failed).
- **Cross-context both directions:** an `intake/item/v1`-wrapped blob must NOT unwrap under a matter context, and a matter-wrapped blob must NOT unwrap under intake context (assert failure both ways).
- **Chunk reorder / transplant:** chunk n opened as chunk m fails; chunk from submission X opened under submission Y fails; chunk from item P opened under item Q fails; chunk from intake I₁ opened under I₂ fails.
- **Duplicate `submission_id`** rejected by the integrity/dedupe helper.
- **Replay-relabel:** same ciphertext + manifest re-posted under a fresh plaintext `submission_id` → `verifySubmissionIntegrity` rejects on sealed-vs-plaintext id mismatch.
- Malformed/truncated blobs and bad base64 → typed error, never a throw that leaks.

**Merge = A alone to lp/intake, then dispatch B/C/D/E.**

### Lane B — Relay (backend TS, Bun + bun:sqlite)

Scope: WAVE-PLAN Lane B + ARCHITECTURE §3. New route group `routes/intake.ts` wired into `backend/src/server.ts` beside the matter routes (manual `path`/`method` dispatch pattern — see the `/matter/:id/...` block). New tables appended to the single `SCHEMA` string in `backend/src/lib/db.ts` with Store accessor methods (follow the `matter_updates` table + `Store` method style).

- **Advisor-authenticated** (seat token `X-Seat-Token`, Ed25519-verified as `/seat/validate` does; JWT additionally attached when present): `POST /intake`, `PUT /intake/:id/checklist`, `GET /intake/:id/inbox`, `GET /intake/:id/blob/:blob_id`, `POST /intake/:id/ack` (ack **deletes** the acked ciphertext), `POST /intake/:id/revoke` | `/extend`.
- **Public** (`Authorization: Bearer t_auth`; constant-time HMAC compare via the `hmacEquals` pattern in `backend/src/lib/crypto.ts`; rate-limited per intake + per IP): `GET /intake/:id/bundle`, `PUT /intake/:id/state` (~64 KiB cap), `POST /intake/:id/item/:item_id/chunk` (≤4 MiB/chunk, 100 MB/file, 500 MiB/intake default; keyed by `(intake,item,submission_id,index)` — never item+index alone), `POST /intake/:id/item/:item_id/submit` (finalize: sealed manifest + plaintext `submission_id` + wrapped content key; reject duplicate `submission_id`).
- **Uniform neutral 410** for expired/revoked/unknown/wrong-token after the same constant-time token check. Unknown ids compare against a fixed decoy hash with the same routine (no timing oracle).
- Relay stores only `HMAC(t_auth)` (never `t_auth`), never `client_name`, never item labels/answers/file names. IP/UA kept out of durable storage (24h access-log ceiling, in-memory rate buckets).
- **Durable** duplicate-`submission_id` rejection (DB-backed, never an in-memory set — RISKS §7).

**Bun tests incl. the STANDING PRIVACY-PROOF TEST** (`intake-privacy-proof.test.ts`): drive an honest-client submission through the relay, then dump every stored row/blob and assert it contains **no** plaintext client value, file name, client name, or item label, and that no `restricted`-tier fact ever ships outbound to the page. Plus: constant-time 410 uniformity across the four cases; ack deletes ciphertext; chunk keying prevents two-device index-0 collision; oversized blob rejected; duplicate submission_id rejected across a simulated restart.

### Lane C — Client page (new static SPA `intake-page/`)

Scope: WAVE-PLAN Lane C + PRODUCT-DESIGN §6 + §10. Self-contained static SPA — **no CDN, no third-party origin, no analytics**. Imports Lane A's crypto/link/contract modules (bundled in). Boot: parse fragment → derive `k_page`,`t_auth` → GET bundle → decrypt checklist+state → render.

- Mobile-first, **light theme**, firm name + accent from the *sealed* checklist (never from the URL). One item per screen; always-visible progress; camera-first capture for license (front/back = two slots, one item); masked SSN entry with `autocomplete` hints that discourage retention; guided question (number / range / "I don't know" as equal buttons); "Skip for now"; "Replace this answer" on completed items.
- **Write-only confirmations:** after submit, last-4 shows only in that session from memory; resume state stores only completion flags + generic confirmation (no last-4, no file names). Done/not-done rendered from the relay's finalization records (§2), never trusted from writable state. "provided by you just now" (local session) vs plain "provided".
- Chunked resumable upload (ask relay which chunk indexes exist; count only). Per-item submit discards content key + plaintext.
- **WebCrypto feature gate** at boot with sensitivity-routed fallback (documents → reply to advisor email; restricted fields → "call [advisor] and do it together"); `<noscript>` honest message; no degraded-crypto mode ever.
- Completion page v0 (what-happens-next, firm-authored placeholder).
- Copy rules: short sentences, no jargon, no em dashes, second person, firm name front and center (Lantern only in privacy-explainer footer).

**Playwright suite INCLUDING an automated axe accessibility pass** (WCAG basics gate Wave 1 — older clients are the target). Drives: boot+decrypt against a mocked/staged relay, complete all 5 items incl. camera-mock uploads, save/resume across reload, replace-answer, write-only (no secret re-readable after reload), old-browser fallback branch, axe = 0 serious/critical violations.

### Lane D — Advisor-side (TS + a little Rust; ONLY Rust lane)

Scope: WAVE-PLAN Lane D + ARCHITECTURE §5. Follows the CRM store pattern (`src-tauri/src/commands/crm/store.rs`) and MatterSyncClient pattern.

- **Compose flow:** extend `NewClientDialog` (`src/features/matters/`) with a minimal checklist editor pre-loaded with the locked "New household" template (welcome, DOB, SSN, license front/back, income, spending, what-happens-next). Add/remove/reorder/re-word before send.
- **Link mint + controls:** generate intake keypair + link secret `s` on the machine; write private key to OS keychain service `com.lantern.intake.<intake_id>` (vault VMK precedent, `firmKeychain` naming); build the link (Lane A codec); **copy again / extend / revoke / regenerate must all ship in Wave 1** (the leaked-link answer ships with the first link). Regeneration re-seals BOTH `checklist_ciphertext` and `state_ciphertext` under the new `k_page` (Wave 1 gate).
- **Minimal manual fact entry:** advisor types a value with `channel:'manual'` provenance — makes the client page's "call [advisor] and do it together" restricted-field fallback honest in Wave 1 (full phone mode is Wave 5).
- **`IntakeSyncClient`** (`src/platform/intake/`, modeled on `MatterSyncClient.ts`): inbox → unwrap content key with keychain private key → decrypt → route by payload type → **ack only after local durable write** (ack-last; crash re-delivers). Replay/duplicate flagging via Lane A's integrity verify; "new device" chip per unfamiliar session.
- **SQLCipher facts store** (`src-tauri/src/commands/intake/`, CRM-store pattern): typed secrets keyed by `matter_id`; append-only supersede chains; one active fact per `(matter_id, subject, kind)`; masking accessor (`•••-••-1234`) with click-to-reveal writing an audit row; every receipt writes an intent/outcome audit pair (refuse if audit append fails).
- **Files → `WorkspaceService`** → client folder under `Requests/onboarding/` (the §9a convention from day one, so Wave 7 never re-files); vault KPV1 at rest when vault on; nudge-once when vault off.
- **`intakeStore.ts`** (Zustand, non-sensitive: item states, timestamps, `fact_id` refs, provenance — no last-4/value fragment ever in ordinary state); **`factsStore.ts`** accessor (masking-by-tier policy; features never touch SQLCipher directly).
- **Onboarding tab v0** on `MatterHub` (`HUB_TABS`): checklist state list with provenance chips + masked facts + reveal-audits + link controls.

**Tests:** vitest for sync-routing/provenance/masking/regeneration-reseal + Rust `cargo test` for the facts store (supersede chain, masking, audit-refuse). **Serialize cargo with the gate.**

### Lane E — Hosting (infra, small, STAGED ONLY)

Scope: WAVE-PLAN Lane E + ARCHITECTURE §4 + §8 T3 + RISKS §3. **Staging relay + staging page only.** Production cutover of anything client-facing is NOT this lane's / Codex's call — flag to coordinator.

- Static page deploy pipeline + relay deploy config (sibling of the Calendly public-booking rail; identical headers/CSP/hosting conventions).
- Headers: CSP `default-src 'none'` + own bundle + relay API origin only; `connect-src` pinned to the relay origin; `Referrer-Policy: no-referrer`; no third-party origins ever.
- **Versioned bundle with published hashes + a deploy-time integrity check that FAILS the deploy if the served bundle differs from the signed manifest** (§8 T3 — Wave 1 gate, not roadmap). This is security-sensitive infra: same rigor as the relay.
- Confirm the URL fragment never appears in any relay/access log (VERIFY-LIVE).

---

## 4. VERIFY-LIVE register (Wave 1)

| # | Claim | How verified | When |
|---|---|---|---|
| V1 | Content key wrapped to intake pubkey is unreadable without the private key | Lane A tamper suite (green) + review reads the AAD/HKDF binding | Lane A merge |
| V2 | Relay storage holds no plaintext client value/name/label/file name | Standing privacy-proof test (green) + manual storage-dump inspection in review | Lane B merge |
| V3 | Uniform 410 gives no existence/timing oracle | Lane B constant-time test + decoy-hash review | Lane B merge |
| V4 | Client page reaches only the relay origin; fragment never logged | CSP review + Lane E deploy log check | Lane C + E |
| V5 | Older-client accessibility basics hold | Playwright axe pass = 0 serious/critical | Lane C merge |
| V6 | Full E2EE round trip on a real phone-sized browser against staged relay; decrypt-and-file on desktop | **Legion bench** (coordinated after WORKER-DONE) — complete all 5 items incl. camera uploads, verify facts+files land, screenshot | Post-merge bench |
| V7 | Real iOS Safari / Android Chrome camera capture | Legion bench | Post-merge bench |
| V8 | Real relay under TLS with production headers; fragment absent from logs | Lane E staged deploy check | Lane E |
| V9 | Keychain behavior for intake keys on real Windows (Credential Manager) | Legion bench | Post-merge bench |
| V10 | Regeneration re-seals checklist+state; old link dies, page still works on new link | Lane D vitest + bench | Lane D + bench |

## 5. Per-lane merge ritual

1. Codex lane finishes (DONE-EXIT:0), liveness-watched throughout.
2. **This session reads the full diff.** Batch all findings into ONE combined fix brief per lane (no drip-feed — [[feedback-batch-findings-one-fix-round]]).
3. **One `codex-review --base lp/intake "<lane risk list>" < /dev/null`** adversarial pass from a *different* codex call (E2EE attack prompt for A/B/C/E; mis-filing/masking attack for D).
4. Fold findings → re-verify.
5. `git merge --no-ff` the lane into `lp/intake`.
6. Run the gate: `npm run gate` (typecheck + i18n + vitest + ESLint + cargo). TS-only lanes (A/B/C/E) may skip cargo with a **logged reason**; Lane D requires cargo (serialized).
7. For Lane B also run `cd backend && bun test`. For Lane C also run the Playwright+axe suite.
8. Push `lp/intake` (`git push -u origin lp/intake`; `--no-verify` only if the diff is docs-only, otherwise let the hook run / run the gate first).
9. Update `W1-TRACKER.md` (lane status, HEAD SHA, review rounds, gate evidence). Print `LANE-MERGED: <slug> <sha>`.

## 6. Wave-1 done definition (WORKER-DONE gate)

All five lanes merged; `npm run gate` full tail-output shown green; backend `bun test` green; Playwright+axe green; the standing privacy-proof test green; `W1-TRACKER.md` updated; `lp/intake` pushed and `HEAD == origin/lp/intake`; git tree clean. Then print the evidence block, then `WORKER-DONE: lp/intake`. The Legion phone-browser bench (V6/V7/V9/V10) is coordinated separately AFTER WORKER-DONE — bench needs noted in the tracker.

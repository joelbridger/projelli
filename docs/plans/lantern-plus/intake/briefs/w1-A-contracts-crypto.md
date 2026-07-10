# CODEX BUILD BRIEF — Lantern Intake Wave 1, Lane A: Contracts + Crypto Core

You are a Codex build agent. Build exactly the scope below, TDD, and commit on your branch. **Do NOT push. Do NOT touch any file outside `src/platform/intake/`.** When finished, the wrapper appends the DONE-EXIT sentinel.

## Context you must read first (in the worktree you are running in)
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` — §2 (key model), §4 (client-page crypto), §9 (ClientFact schema, VERBATIM), §9a (FormRequest/RequestItem/PdfPrefill).
- `docs/plans/lantern-plus/intake/W1-EXEC-PLAN.md` — §3 Lane A (your authoritative task list) + §2 file structure.
- **The two constructions you are making intake siblings of — read them fully and REUSE their exact wire formats + byte-layout helpers:**
  - `src/platform/firm/keyWrap.ts` (ECDH P-256 + HKDF-SHA256 + AES-256-GCM key wrap; wire `[1B ver=1][65B ephemeral pub][16B salt][12B IV][ct+tag]`).
  - `src/platform/firm/matterCrypto.ts` (AES-256-GCM blob seal; wire `[1B ver=1][12B IV][ct+tag]`; epoch in AAD).
- These use the `buf()`/`bytesToB64`/`b64ToBytes` helpers and `getSubtle()`. Match that style. All WebCrypto, browser-compatible, runs outside Tauri, jsdom-test-safe (use the same `buf()` zero-offset trick).

## What "done" means: every module below exists, exported, with the full vitest suite GREEN.

### Module 1 — `src/platform/intake/types.ts`
- `ClientFact` interface **verbatim from ARCHITECTURE §9** (fact_id, matter_id [NEVER rename], subject, kind, value, sensitivity, provenance{channel,source_ref?,entered_by,confirmed_by?,at}, verification, status, superseded_by?).
- `type FactKind = 'dob'|'ssn'|'income_annual'|'spending_monthly'|'drivers_license'|'address'|'citizenship'|'employer'|'beneficiary'` (declare all now — Schwab needs address/citizenship/beneficiary even though intake v1 does not collect them).
- `type FactValue` = discriminated union `{ t:'date'|'string'|'money'|'range'|'doc_ref', v: ... }`.
- `type Sensitivity = 'restricted'|'confidential'|'standard'`.
- `const FACT_KIND_SENSITIVITY: Record<FactKind, Sensitivity>` — `ssn` & `drivers_license` → `restricted`; `income_annual`,`spending_monthly`,`dob`,`beneficiary` → `confidential`; `address`,`citizenship`,`employer` → `standard`.
- `FormRequest` + `RequestItem` from §9a with `schema_version:number` (Wave 1 = 1), `matter_id`, `kind:'onboarding'|'standing'`, `blueprint_ref?`, `items:RequestItem[]`. Declare ALL item types now: `typed_field`, `doc_upload`, `guided_question`, `readonly_card`, `pdf_fill` (with pdf_ref, field_map, prefill), `signature` (grade:'docusign'|'native_clicksign'). Give each a minimal but real field set (a friendly label, help text, required flag, per-person `subject`, and for typed_field a `fact_kind` + input format hint).
- `type PrefillMode='blank'|'hidden_confirm'|'visible_prefill'`. `interface PdfPrefill{field_id;fact_id?;fact_kind:FactKind;sensitivity:Sensitivity;mode:PrefillMode;value_page_ciphertext?}`.
- **Type-level + runtime invariant:** `restricted` sensitivity can NEVER be `'visible_prefill'`. Enforce with a validator `assertPrefillLegal(p: PdfPrefill): void` that throws on a restricted+visible_prefill combination, AND a test asserting it. (Waves 8+ use this; declare it now.)

### Module 2 — `src/platform/intake/intakeLink.ts`
- `buildLinkFragment(sB64: string, intakePubRaw65B: Uint8Array): string` → `"v1." + b64url(s) + "." + b64url(pub)"`.
- `parseLinkFragment(fragment: string): { version:1; s: Uint8Array; intakePubRaw: Uint8Array } | { error: string }` — strips a leading `#`, validates version, validates pub length === 65, decodes both. Never throws; returns `{error}` on malformed input.
- Tests: round-trip; leading `#`; wrong version; truncated pub; garbage base64.

### Module 3 — `src/platform/intake/intakeCrypto.ts`
All WebCrypto. Unwrap takes the private key as a **parameter** (keychain plumbing is a later lane; keep this pure/testable).
- `generateIntakeKeypair(): Promise<{ privateKey: CryptoKey; publicKeyRaw: Uint8Array }>` — ECDH P-256; `publicKeyRaw` is the 65-byte uncompressed point.
- `derivePageKey(s: Uint8Array): Promise<CryptoKey>` — HKDF-SHA256(ikm=s, salt=empty or a fixed zero salt — document choice, keep both sides identical, info=utf8`"intake/page/v1"`) → AES-256-GCM key (encrypt/decrypt).
- `deriveAuthToken(s: Uint8Array): Promise<{ tokenB64: string; tokenBytes: Uint8Array }>` — HKDF-SHA256(s, info=utf8`"intake/auth/v1"`) → 32 bytes. This is the bearer `t_auth`; the relay stores only `HMAC(t_auth)` (relay side — not your job; you just produce the token).
- `wrapContentKey(contentKeyB64: string, intakePubRaw65B: Uint8Array): Promise<string>` and `unwrapContentKey(wrappedB64: string, intakePrivateKey: CryptoKey): Promise<string>` — **identical construction + wire layout to `keyWrap.ts`** (ephemeral ECDH + HKDF + AES-256-GCM, `[1B ver][65B ephemeral pub][16B salt][12B IV][ct+tag]`) EXCEPT: HKDF info = utf8`"intake/item/v1"` and GCM AAD = utf8`"intake/item/v1"` (no matter epoch). Import helpers from a shared local copy or re-implement matching byte layout exactly.
- `sealItemChunk(contentKey: CryptoKey, plaintext: Uint8Array, ids: {intakeId:string; itemId:string; submissionId:string; index:number}): Promise<string>` and `openItemChunk(contentKey, blobB64, ids): Promise<{ok:true;data:Uint8Array}|{ok:false;reason:'malformed'|'bad_version'|'auth_failed'}>` — sibling of `matterCrypto` (`[1B ver=1][12B IV][ct+tag]`) with GCM AAD **exactly** the UTF-8 string `intake:<intakeId>:item:<itemId>:submission:<submissionId>:chunk:<index>`.
- `generateContentKey(): Promise<string>` (base64 raw AES-256). `generateSubmissionId(): string` (128-bit random hex/base64url).
- `interface SealedManifest { submission_id:string; item_id:string; content_type:string; file_names:string[]; chunk_hashes:string[]; chunk_count:number }`. `sealManifest(contentKey, manifest, ids)` / `openManifest(...)` seal it like a chunk (AAD chunk index = a reserved sentinel e.g. `manifest`).
- `verifySubmissionIntegrity(plaintextSid: string, sealedManifest: SealedManifest, chunkAADSids: string[]): { ok:true } | { ok:false; reason:string }` — asserts `plaintextSid === sealedManifest.submission_id` AND every entry of `chunkAADSids === sealedManifest.submission_id`. Any mismatch → `{ok:false}`. This is the replay-relabel defense.

### Module 4 — `src/platform/intake/intakeContract.ts`
Shared wire types (the relay in a later lane mirrors these): `SubmissionEnvelope`, `ChunkUpload {intake_id,item_id,submission_id,index,ciphertext_b64}`, `SubmitManifest {intake_id,item_id,submission_id,manifest_ciphertext_b64,wrapped_content_key_b64}`, `BundleResponse {checklist_ciphertext_b64,state_ciphertext_b64,checklist_version:number,finalized_item_ids:string[]}`, `StateBlob {ciphertext_b64}`. Keep them plain interfaces + no logic.

## The exhaustive tamper suite (`src/platform/intake/__tests__/`) — ALL must pass
Split into `link.test.ts`, `crypto.test.ts`, `types.test.ts`. Cover, at minimum:
1. Round-trip: content-key wrap→unwrap; chunk seal→open; manifest seal→open; page key derive both sides encrypts+decrypts; link build→parse.
2. **Wrong AAD:** open a chunk with any altered id field (intakeId | itemId | submissionId | index) → `auth_failed`.
3. **Cross-context, BOTH directions:** a blob wrapped with intake info `"intake/item/v1"` must NOT unwrap under a matter-style info string, and a matter-style-wrapped blob must NOT unwrap under intake info. (Construct a tiny local matter-style wrap using info `"lantern-matter-key-wrap:v1:epoch:1"` to prove the isolation.) Assert failure each way.
4. **Chunk reorder / transplant:** chunk index n opened as m fails; chunk from submissionX opened under submissionY fails; itemP→itemQ fails; intakeI1→intakeI2 fails.
5. **Duplicate submission_id** rejected by `verifySubmissionIntegrity` / a dedupe helper.
6. **Replay-relabel:** same ciphertext+manifest re-labeled with a new plaintext submission_id → `verifySubmissionIntegrity` returns `{ok:false}`.
7. Malformed/truncated blob + bad base64 → typed non-throwing result / typed error.
8. `assertPrefillLegal` throws on restricted+visible_prefill; passes on restricted+hidden_confirm.

## Constraints
- TDD: write the test, watch it fail, implement, watch it pass. Real assertions, no `expect(true)`.
- Match existing code idiom (strict TS, `@/` path alias, the `buf()` jsdom trick, typed errors).
- Do NOT add new dependencies. WebCrypto only. Everything runs under the repo's existing `vitest run` (jsdom env).
- Run `npx vitest run src/platform/intake` and `npx tsc --noEmit` before you consider yourself done; both must be clean for the intake files.
- Commit on your branch with a clear message. Do NOT push. Do NOT edit files outside `src/platform/intake/`.

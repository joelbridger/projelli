TASK: Lantern Intake Wave 5 Lane W5c — multi-advisor intake key sharing + org-admin escrow (E2EE-CRITICAL).

You are Codex (gpt-5.6), building in an isolated git worktree on branch `lp/w56-key-sharing` off `lp/intake-w56`. This is the single most security-critical lane of Waves 5+6. It will get the deepest adversarial review. Correctness over speed. NO shortcuts (this is core product).

## Read first (ground truth — do not skip)
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §2 (key model — the "Multi-advisor firms" paragraph is your exact spec), §3 (relay), §8 T1/T2/T6.
- `docs/plans/lantern-plus/intake/PRODUCT-DESIGN.md` §8 (phone mode context), §5.
- `docs/plans/lantern-plus/intake/W56-EXEC-PLAN.md` (non-negotiables).
- The PRECEDENT you mirror (read closely, you are building the intake sibling of this):
  - `src/platform/firm/matterKeyService.ts` — `publishMatterKeyToMembers`, `rotateMatterKeyLocally`, `obtainMatterKey`, `deviceSetFingerprint`, `autoRepublishHeldMatterKeys`, org-admin escrow in `eligibleDevices`.
  - `src/platform/firm/keyWrap.ts` — `wrapMatterKey`/`unwrapMatterKey` (ECDH P-256 + HKDF + AES-256-GCM, epoch+context bound into HKDF info and AAD).
  - `backend/src/routes/matterKeys.ts` — the publish/fetch endpoints + tables you mirror for intake.
  - `src/platform/firm/vaultClient.ts` (escrow precedent) and `src-tauri/src/commands/vault/mod.rs` (keychain VMK precedent).
  - Existing intake crypto you extend: `src/platform/intake/intakeKeychain.ts` (holds `private_jwk` at service `com.lantern.<firm-ns>.intake.<intake_id>`), `src/platform/intake/intakeCrypto.ts`, `src/platform/intake/IntakeSyncClient.ts` (unwraps content keys with the keychain private key — the code that a second advisor must be able to run after obtaining the shared key).

## Goal (plain)
Today only the advisor who created an intake can decrypt its submissions (private key sits in that one machine's keychain). This lane wraps the intake private key to every eligible matter-member device AND to org-admin devices (escrow), exactly the way matter keys are already shared — so a second advisor at the firm can decrypt one client's intake, and a departed advisor's in-flight intakes stay recoverable by the firm. The relay only ever stores ciphertext-wrapped keys; it never sees a raw private key.

## Deliverables

### 1. Client-side service — `src/platform/intake/intakeKeyShare.ts` (new, the intake sibling of matterKeyService)
- `publishIntakeKeyToMembers(client, intakeId, matterId, epoch)`: read the intake private key JWK from `intakeKeychain`, build the eligible device set (non-walled matter members + all org admins for escrow — reuse the SAME roster/escrow logic shape as `matterKeyService.eligibleDevices`; do NOT fork the roster rules), wrap the JWK to each device pubkey via the `keyWrap.ts` construction with an INTAKE-specific epoch+context binding, publish the wrapped blobs to the relay. Wrapped context MUST be distinct from matter-key context so an intake-wrapped blob can never unwrap under a matter context and vice versa (add a cross-context tamper test both directions).
- `obtainIntakeKey(client, intakeId, matterId)`: fetch the wrapped blob for this device, unwrap with the local device key, install the JWK into `intakeKeychain` for `intakeId` so `IntakeSyncClient` can run unchanged. Return null / honest failure if no blob for this device (wrong-member case).
- `deviceSetFingerprint` reuse + `autoRepublishHeldIntakeKeys` sibling for drift (member added/removed → re-wrap to the new set).
- Epoch semantics: mirror matter-key epoch. When a member is removed the firm bumps the epoch; you re-wrap the CURRENT intake private key to remaining members+admins under the new epoch; the ex-member's old wrapped blob is at the old epoch and must not unwrap the new-epoch material (HKDF info/AAD carries the epoch — a wrong-epoch unwrap MUST fail). The intake keypair itself does not rotate (submissions are sealed to it); only the WRAPPING epoch advances, exactly like `bumpMatterKeyEpoch` re-wraps the same underlying key.

### 2. Relay — `backend/src/routes/intake.ts` (extend) + tables in `backend/src/lib/db.ts`
- Mirror `matterKeys.ts`: `POST /intake/:id/keys` (advisor-auth: publish wrapped blobs {epoch, wrapped:[{user_id, device_id, wrapped_key_b64}]}) and `GET /intake/:id/keys` (return the wrapped blob for the calling device only). New table `intake_wrapped_keys` keyed by (intake_id, user_id, device_id, epoch), storing ONLY ciphertext-wrapped-key bytes + epoch + routing ids. Enforce: only the creating seat/org identity (and org members) may publish/fetch; a device outside the intake's org gets a uniform 404/410 (no oracle). The relay stores NOTHING it can decrypt.
- Reuse existing auth middleware (seat token + JWT org context) exactly as `matterKeys.ts` does. Do not invent a new auth path.

### 3. Rust — `src-tauri/src/commands/intake/` (minimal)
- If the intake private-key install/unwrap needs a keychain write command not already exposed, add it mirroring the vault/matter keychain command pattern. Prefer reusing existing `keychainSet/keychainGet` commands (`src/platform/utils/tauri-commands`) — only add Rust if genuinely required. Keep the Rust surface tiny.

### 4. Firm-tier gating
- Intake itself ships on all paid tiers; the SHARING/ESCROW feature is Firm-tier. Gate `publishIntakeKeyToMembers` and the share UI behind the existing firm-tier entitlement check (find how matter-key sharing / firm features are gated — reuse that exact predicate; do not invent a new entitlement). A solo/non-firm user's intake behaves exactly as today (single-machine decrypt) with no regression.

### 5. Wiring
- On intake create AND on matter roster/epoch change, publish the intake key to members (mirror `autoRepublishHeldMatterKeys` triggering). On a second advisor's sync, `obtainIntakeKey` runs before `IntakeSyncClient` so decrypt works. Remove/soften the ARCHITECTURE §10 "advisor machine lost (pre-Wave-5)" caveat where the code now covers it.

## TDD — write these tests FIRST, they define done (vitest + bun)
Client (`src/platform/intake/intakeKeyShare.test.ts`):
1. Round trip: publish intake key to a 2-member+1-admin device set → a DIFFERENT member device obtainIntakeKey → unwrap succeeds → the recovered JWK decrypts a real intake submission (exercise through `intakeCrypto`/IntakeSyncClient path, not just byte-equality).
2. Wrong-member: a device NOT in the matter roster and NOT an admin cannot unwrap (no blob issued; and if handed another member's blob, unwrap fails).
3. Cross-context BOTH directions: an intake-wrapped blob must not unwrap under a matter-key context; a matter-key-wrapped blob must not unwrap under the intake context.
4. Ex-member epoch: publish at epoch N → bump to N+1 re-wrapping to remaining members only → the removed member's epoch-N blob does NOT unwrap epoch-N+1 material; a wrong-epoch unwrap fails closed.
5. Escrow: an org-admin device (not a matter member) can obtain+unwrap (recovery of a departed advisor's intake).
6. Tamper: flip a byte in a wrapped blob → unwrap fails (auth tag). Transplant a blob from intake A onto intake B → fails.
7. Firm-tier gate: non-firm entitlement → publish is a no-op/blocked; single-machine decrypt still works (no regression).
Relay (`backend/tests/intake-keys.test.ts` or extend existing intake backend tests):
8. Publish then fetch returns only the calling device's blob; a foreign-org caller gets uniform 404/410 (oracle test).
9. Relay stores only ciphertext (assert the stored row has no plaintext JWK / no decryptable field).

## Non-negotiables
- The relay NEVER holds a key that decrypts intake content. If any code path would let it, STOP and write `COORDINATOR-ESCALATE:` in your final notes instead of shipping it.
- Reuse the matter-key roster/escrow/epoch RULES; do not fork subtly different ones (drift is a bug).
- `matter`/`matter_id` never renamed. Light theme + tokens for any UI. No em dashes in user-facing copy. Intent/outcome audit rows if any advisor-visible action (e.g. "shared this intake's key with the team") — mirror `audit_pair_id`.
- No new relay metadata beyond ARCHITECTURE §3's honest list except the wrapped-key routing ids, which are ciphertext-adjacent by design.

## Out of scope (do NOT build)
- Phone mode, welcome journey, KPI strip, relay rate-limit tuning, accessibility, IT-pack (other lanes own these).
- Any change to how submissions are sealed to the intake keypair (unchanged — you only share the private key that unwraps them).
- New UI beyond the minimal "share with team" affordance + the firm-tier gate; keep advisor UI changes small and in `src/features/intake/`.

## Verify before you finish
Run: `npx vitest run src/platform/intake/intakeKeyShare.test.ts` , `cd backend && bun test` (intake key tests), `npx tsc --noEmit`, `node scripts/eslint-gate.mjs` (or `npm run lint:gate`). Cargo only if you touched Rust: `cargo test -p lantern --lib commands::intake -- --test-threads=1` (ONE cargo compile at a time box-wide — if it self-aborts exit 144, retry once). Report exact pass/fail counts. Do not claim green without the command output.

When fully done and committed, print on its own line the distinctive phrase `W56-KEYSHARE-EPOCH-ESCROW-DONE` then `DONE-EXIT:0`. If blocked on an E2EE-safety decision, print `COORDINATOR-ESCALATE:` with the question and stop.

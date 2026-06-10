# Phase 1: Firm Desktop Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A firm can buy Firm seats, claim its org, activate, invite members by email, share a matter, see each other's edits to the shared matter notes converge live, enforce a cryptographic ethical wall, revoke a seat, and route inference through Assured, all self-serve in the app, all audited.

**Architecture:** Everything builds on shipped, tested plumbing: the live backend at api.keepance.com (org auth, Ed25519 seats, E2EE Yjs relay, zero-retention proxy; contract in `backend/src/contract.ts`), and the client firm modules (`src/modules/firm/`: FirmApiClient, MatterSyncClient, matterCrypto, firmKeychain, seatToken, firmEntitlement, assured routing; all wired and unit-tested). The two genuinely new pieces: (1) cross-member matter-key distribution (ECDH P-256 device keys + wrapped per-matter keys; the work `matterKeyService.ts` documents as deferred), and (2) LemonSqueezy purchase → org provisioning. Everything else is UI integration over existing APIs.

**Scope decision (flag to Jameson, do not relitigate here):** live collaboration in this phase = the shared matter notes document (Y.Text bound to CodeMirror) plus shared matter metadata, NOT live multi-user co-editing of .docx files. The docx-tree-as-CRDT model is proven by the P0 spike (5/5 convergence tests incl. tracked-change attribution) but `spikes/firm-sync/DECISION.md` explicitly gates production docx co-editing on design-partner validation with real redlines (risks R1/R2). It is the named next increment after launch, not silently dropped.

**Tech Stack:** Existing only, plus two approved additions: `y-codemirror.next` (Yjs↔CodeMirror 6 binding; yjs is already a dependency) and nothing else. Crypto is pure WebCrypto (ECDH P-256 + HKDF + AES-GCM); no new crypto dependency. Backend stays Bun + SQLite.

**Dev/test backend:** run locally (`cd backend && bun run src/index.ts` with a temp SQLite path + test env secrets; see backend/deploy/RUNBOOK.md for env names). NEVER develop against live api.keepance.com; one read-only staging smoke at the end.

**Gates (all merge points):** `npx tsc --noEmit`, `npm run test`, `cd src-tauri && cargo test`, `cd backend && bun test`, no em dashes in user-facing strings, first-person voice, light theme. No firm UI may leak into solo mode (no sign-in = exactly today's app).

---

## Contract-first interfaces (all tasks code against THESE)

### New backend endpoints (T1 implements; client tasks mock until ready)

```
POST /device/register        auth: Bearer access            {device_id, machine_id, label, pubkey_jwk}     -> {ok}
POST /org/users/devices      auth: Bearer + admin           {user_ids: string[]}                            -> {devices: [{user_id, device_id, pubkey_jwk, label}]}
POST /matter/:id/keys/publish auth: Bearer + (admin|owner)  {epoch, wrapped: [{user_id, device_id, wrapped_key_b64}]} -> {ok, stored}
POST /matter/:id/keys/fetch  auth: Bearer + X-Seat-Token    {device_id}                                     -> {epoch, wrapped_key_b64} | 403 (walled/non-member, fail closed) | 404 (none published for device)
POST /matter/mine            auth: Bearer + X-Seat-Token    {}                                              -> {matters: [{matter_id, client_name, status, key_epoch, role}]}   # member ∧ ¬walled only
POST /org/claim              auth: none                     {license_key, email, password, org_name?}       -> {org, user(admin), access_token, refresh_token} | 409 already claimed
POST /webhooks/lemonsqueezy  auth: X-Signature (HMAC, LS signing secret) -> 200; on subscription_created with the Firm variant: idempotently create org {plan:'practice', seat_limit: quantity>=3, status:'unclaimed'} + store license key hash. No emails sent; the buyer claims via /org/claim with the LS license key.
```

Wall/remove semantics: `matter/:id/members/remove` and `wall/set` already bump `key_epoch`; T1 extends them to DELETE all published wrapped keys for the removed/walled user and mark the epoch's published set stale so T2 re-wraps.

### New client modules (T2 implements; T3/T4 import)

```ts
// src/modules/firm/deviceKeys.ts
export async function getOrCreateDeviceKeypair(): Promise<{ deviceId: string; publicJwk: JsonWebKey }>; // private key non-extractable in keychain-backed storage (wrapped at rest via firmKeychain), deviceId stable per machine
export async function registerDevice(client: FirmApiClient): Promise<void>; // idempotent

// src/modules/firm/keyWrap.ts  (pure WebCrypto, ECDH P-256 ephemeral + HKDF-SHA256 + AES-256-GCM)
export async function wrapMatterKey(matterKeyB64: string, recipientPubJwk: JsonWebKey, epoch: number): Promise<string>; // epoch bound into HKDF info + GCM AAD
export async function unwrapMatterKey(wrappedB64: string, epoch: number): Promise<string>; // uses local device private key; throws typed error on wrong epoch/tamper

// src/modules/firm/matterKeyService.ts  (additions; existing API unchanged)
export async function publishMatterKeyToMembers(client, matterId, epoch): Promise<{ published: number; skippedWalled: number }>; // wraps current local key to every allowed member device (incl. all org admins = escrow) and POSTs keys/publish
export async function obtainMatterKey(client, matterId, seatToken): Promise<string | null>; // local keychain first, else keys/fetch + unwrap + store; null if 403/404 (caller shows "ask your admin to share access"). AMENDED 2026-06-10: gained the seatToken param because keys/fetch requires X-Seat-Token (this contract section originally contradicted the endpoint contract above).
```

### Matter linkage (T3; type change reviewed by all)

`src/types/matter.ts` Matter gains optional: `firmMatterId?: string; orgId?: string; role?: 'owner'|'editor'|'viewer'; shared?: boolean`. Sync status is RUNTIME state (a map in a new `src/stores/matterSyncStore.ts`), never persisted on the Matter.

### Shared notes doc shape (T4)

One Yjs doc per shared matter (the doc MatterSyncClient already syncs): `doc.getText('notes')` bound to CodeMirror; `doc.getMap('meta')` for `{ name, client_name, updated_by }`. Notes also mirror to disk as `<matter folder>/matter-notes.md` on save (read-only artifact of the synced truth, so solo tooling/search still sees it).

---

### Task 1: Backend: device keys, wrapped-key store, /matter/mine, /org/claim, LS webhook

**Files:** `backend/src/contract.ts`, `backend/src/routes/` (new: devices.ts, matterKeys.ts, claim.ts, webhooks.ts; extend matters.ts members/remove + wall/set), `backend/src/lib/db.ts` (tables: Device {device_id, user_id, org_id, machine_id, label, pubkey_jwk, created_at}; WrappedMatterKey {matter_id, epoch, user_id, device_id, wrapped_key_b64, published_by, created_at}; Org gains status 'unclaimed'|'active'; WebhookEvent {event_id, processed_at} for idempotency), mirror types into `src/modules/firm/contract.ts`, tests in `backend/test/`.

- [ ] TDD per endpoint: failing bun test → implement → green. Critical adversarial tests: keys/fetch returns 403 for walled member EVEN IF also listed as member (deny overrides allow); members/remove and wall/set purge that user's wrapped keys and bump epoch; /org/claim is single-use (second claim 409) and verifies the LS key hash; webhook handler verifies HMAC signature, is idempotent by event id, ignores non-Firm products, maps quantity (min 3, clamp) to seat_limit.
- [ ] /matter/mine respects member ∧ ¬walled and includes the caller's role.
- [ ] Keep ALL 104 existing backend tests green. `bun test` final run pasted in report.

### Task 2: Client crypto: device keys, key wrap, matterKeyService completion

**Files:** new `src/modules/firm/deviceKeys.ts`, `src/modules/firm/keyWrap.ts`; extend `src/modules/firm/matterKeyService.ts`, `src/modules/firm/FirmApiClient.ts` (methods for the new endpoints, mirroring existing style), `src/modules/firm/contract.ts`; tests `tests/unit/firm/deviceKeys.test.ts`, `keyWrap.test.ts`, `matterKeyDistribution.test.ts`.

- [ ] TDD. keyWrap round-trip; tamper/epoch-mismatch fails typed; wrap→publish→fetch→unwrap full flow against a MOCKED FirmApiClient (same mock style as existing firm tests); adversarial: walled member's obtainMatterKey returns null on 403 and NEVER stores a key; escrow: publish includes every org admin's devices; rotation: after epoch bump, old wrapped blobs fail unwrap (epoch in AAD) and publishMatterKeyToMembers re-publishes for the new epoch.
- [ ] Private device key handling: generate non-extractable where possible; persistence via firmKeychain service names (`com.keepance.device.<device_id>`); document the browser-fallback caveat exactly like firmKeychain does.

### Task 3: Shared-matter lifecycle UI (WS-1) + invite-by-email (WS-2 polish)

**Files:** `src/types/matter.ts`, `src/stores/matterStore.ts` (link fields), new `src/stores/matterSyncStore.ts` (runtime sync status), `src/components/matter/MatterManagerDialog.tsx` (Share with my firm; Open shared matters; member roster with emails; invite-by-email = createUser-if-needed + addMatterMember + publishMatterKeyToMembers; leave/unshare; wall badges), `src/components/matter/MatterScopeSelector.tsx` (sync badge), `src/components/firm/FirmAdminConsole.tsx` (invite-by-email instead of raw user-id input; show emails), locales en/es/de (ALL firm strings move to i18n here), audit events via the existing audit service (matter_shared, member_invited, wall_set, key_published, seat_revoked).

- [ ] Share flow: createMatter (backend) → link local matter → getOrCreateMatterKey → registerDevice → publishMatterKeyToMembers → start sync. Open-shared flow: /matter/mine → pick → obtainMatterKey (null → friendly "ask your admin" state, fail closed) → create/link local matter → start sync.
- [ ] Firm UI hidden entirely without an active firm session (solo regression test). Walled members show wall badge to admins; a walled member never sees the matter in /matter/mine (asserted in tests with mocked client).
- [ ] Component tests per dialog state; i18n parity test extended to firm namespace.

### Task 4: Live shared notes (WS-3, scoped) + two-client convergence e2e

**Files:** new `src/components/matter/MatterNotesEditor.tsx` (CodeMirror 6 + y-codemirror.next binding to `doc.getText('notes')`, presence cursors via y-awareness if trivial, else skip), wiring in MatterManagerDialog or a matter notes tab (follow existing editor-mounting patterns in MainPanel), `src/modules/firm/MatterSyncClient.ts` only if a small hook is missing (it exposes doc + callbacks already), mirror-to-disk on save via WorkspaceService, dep add `y-codemirror.next`, tests: unit (binding mounts, local edit produces Yjs update, remote update re-renders) + `tests/e2e/firm-collaboration.spec.ts` (TWO Playwright contexts against `npm run dev` + LOCAL backend via the `/api/firm` vite proxy: user A shares matter + invites B, B opens it, A types into notes, B sees it (and vice versa), wall blocks C, revoked B degrades gracefully). Mark the e2e to SKIP cleanly when the local backend env var is absent so the default suite stays green; the campaign runs it explicitly.

- [ ] Convergence assertion is content-based (both editors show identical text after settle), not event-count based.

### Task 5: Purchase → provision client + LS dashboard + Assured E2E + staging smoke

**Files:** `src/components/firm/FirmSignIn.tsx` (add the claim-org path: "I just bought Keepance Firm" → license key + email + password + org name → /org/claim → signed in as admin → activate seat), locales, `docs/operations/2026-06-10-firm-provisioning.md` (runbook: webhook config, claim flow, ops org-creation fallback).

- [ ] LS dashboard (Chrome automation via chrome-cdp, session per memory gotchas): add per-seat quantity (min 3) to the Keepance Firm product/variant AND register a second webhook pointing at https://api.keepance.com/webhooks/lemonsqueezy with the signing secret stored in the backend env. If the dashboard defeats automation, write the exact 2-minute manual steps into the runbook and flag NEED-JAMESON in the report.
- [ ] Assured E2E against the LOCAL backend: set a managed Anthropic key (the server holds a real one in its env; use it only against the local proxy), confidentiality=assured, send a chat, assert the request hit /assured/infer, the response streamed, and the egress indicator showed the Assured wording.
- [ ] Staging smoke against LIVE api.keepance.com, read-only + additive only: /healthz, seat-pubkey, then full exit-gate against LOCAL backend only.
- [ ] Deploy note: the live backend needs the new tables/endpoints; prepare the deploy (systemd restart per backend/deploy/RUNBOOK.md) but DO NOT touch the live service until the orchestrator says so (it gates with Jameson's release go).

## Exit gate (orchestrator runs, scripted)

Two fresh profiles + local backend: simulated LS webhook → org unclaimed → claim → admin activates seat → invites member (second context) → member activates → admin shares matter → both edit notes, converge → admin walls a third user (key fetch 403 + purge proven) → revokes member seat (member degrades, data intact) → Assured inference through local proxy → audit log shows the whole story. All gates green; solo-mode regression (fresh profile, no firm: zero firm UI).

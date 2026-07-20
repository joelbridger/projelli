# Keepance Firm Platform Backend

The server side of **Keepance 3.0's firm tier**: user identity/auth + per-org
licensing with real, enforced, revocable seats. It replaces today's honor-system
per-machine license check (a JWT in `localStorage`, with a `seats` number nobody
counted) with org-scoped, signed, revocable **seat tokens** under a
server-enforced `seat_limit`.

This implements **all 3 chunks** of the firm backend defined in
[`../spikes/firm-sync/DECISION.md`](../spikes/firm-sync/DECISION.md):

1. **Identity + licensing** ← built
2. **Matter ACL + ethical walls + E2EE CRDT sync relay** ← built (see
   [§4](#matter-acl--ethical-walls-decisionmd-4) +
   [the relay](#e2ee-sync-relay-decisionmd-1) below)
3. **Assured zero-retention inference proxy** ← built (the firm managed-inference
   + DPA option; see [the assured proxy](#assured-zero-retention-inference-proxy-decisionmd-5) below)

> **Solo/local mode is unaffected.** The accountless, local-first, BYOK
> experience is still the default and **never talks to this server.** Everything
> here is opt-in for firm customers (DECISION.md §2, tier 1 vs tier 2).

---

## Stack

- **Runtime:** [Bun](https://bun.sh) + TypeScript (strict). Matches the other
  `~/services/*` Bun services and the existing `license-validator`.
- **HTTP:** `Bun.serve` with a flat `(method, path)` router. No framework — the
  API surface is small.
- **Storage:** **SQLite via Bun's built-in `bun:sqlite`** — zero external deps,
  runs locally with nothing to install. WAL mode + an `IMMEDIATE`-transaction
  seat-limit check so concurrent activations can't both slip past the limit.
  - **Production note:** ship this on **Postgres**, not SQLite. The SQL is
    deliberately vanilla and all DB access is funnelled through the typed
    `Store` class in [`src/lib/db.ts`](src/lib/db.ts), so the port is mechanical
    (swap the driver + the `activateSeat`/`transferSeat` transactions to
    `SELECT ... FOR UPDATE` / `SERIALIZABLE`). The in-memory rate limiter
    (`src/lib/http.ts`) would also move to Redis or the reverse proxy.

---

## Run it

```bash
cd backend
bun install

# 1) Generate a seat-token keypair (Ed25519). Prints PEMs + escaped env lines.
bun run keygen

# 2) Configure
cp .env.example .env
#   - paste the printed SEAT_PRIVATE_KEY_PEM / SEAT_PUBLIC_KEY_PEM into .env
#   - set AUTH_SECRET to `openssl rand -hex 48`
#   (Skip this in a throwaway dev run: the server auto-generates ephemeral
#    secrets and warns. Tokens then won't survive a restart.)

# 3) Start
bun run start          # http://127.0.0.1:5190
# or: bun run dev      # watch mode

# Health check
curl -s localhost:5190/healthz
```

To exercise the full API immediately, set the `BOOTSTRAP_*` vars in `.env`
(creates an org + admin + license key on first boot and prints the key once),
or call `POST /admin/org` (below).

### Tests

```bash
bun test          # 52 tests across crypto / auth / licensing / full HTTP lifecycle
bun run typecheck # tsc --noEmit, strict
```

Tests use a deterministic env (fixed `AUTH_SECRET`, a per-run Ed25519 keypair,
`:memory:` DB) set by `test/setup.ts`, wired in via `bunfig.toml` `[test].preload`.
The HTTP test boots the real `Bun.serve` server on an ephemeral port.

---

## Auth model (chosen + why)

- **Email + password**, hashed with **bcrypt (cost 12)** via Bun's built-in
  `Bun.password` — no dependency, constant-time verify. (argon2 is equally fine;
  bcrypt chosen as the most widely-reviewed default. Magic-link was the
  alternative; password is simpler and fully self-contained for local testing.)
- **Short-lived access JWT** (HS256, signed with `AUTH_SECRET`, default 1h) +
  **long-lived refresh token** (opaque 256-bit random, **stored only as a keyed
  hash**, rotated on every use with reuse-detection → an old refresh token is
  rejected once rotated). Sent as `Authorization: Bearer <access_token>`.
- **No secret ever hits disk in the clear.** Passwords are bcrypt hashes;
  refresh tokens and license keys are stored as keyed SHA-256 hashes; the seat
  private key lives in env, never the DB or repo.
- **Desktop storage:** the client puts the access + refresh tokens in the **OS
  keychain** (`com.keepance.user.<user_id>`, DECISION.md §2), **never
  `localStorage`** — explicitly fixing the weakness the current `useLicense.ts`
  calls out.
- **Production identity (DECISION.md §2):** the email+password path here covers
  small firms; larger firms use **OIDC/SAML SSO** (Okta/Entra/Google) via a
  standard OAuth device/PKCE flow in the system browser. The token issuance +
  seat model below is unchanged — SSO just swaps how `/auth` produces a verified
  user. That federation layer is a follow-up, not chunk 1.

---

## Licensing data model (DECISION.md §3)

`src/lib/db.ts` / `src/lib/types.ts`:

| Entity | Role |
|---|---|
| **Org** | the license holder: `plan`, `packs[]`, `seat_limit`, `status` (active/suspended). The unit of purchase. |
| **User** | belongs to an org: `role` (admin/member), `status` (active/deprovisioned). |
| **Seat** | a **signed, revocable binding of `(user_id, machine_id)`** consuming one of the org's seats. `status` active/revoked, `last_seen` (heartbeat). |
| **LicenseKey** | one or more per org; stored as a **keyed hash** (`KEEP-XXXX-XXXX-XXXX-XXXX` shown once at issuance). |
| **Revocation** | append-ish tombstones with reason for each revoked seat. |
| **AuditEvent** | **append-only** log of every license/identity action (activate, rejected-over-limit, revoke, deprovision, transfer, heartbeat, ...). Never updated/deleted. |
| RefreshToken | hashed, rotating, revocable (auth plumbing, not in the §3 sketch). |

**Key properties (all enforced, not honor-system):**

- **`seat_limit` is enforced server-side and fails closed.** The N+1 machine
  gets **HTTP 409** *with the current seat list* so an admin can revoke/transfer.
  The COUNT→INSERT runs in an `IMMEDIATE` transaction → no two concurrent
  activations both slip past the limit.
- **Machine binding** = the `(user_id, machine_id)` pair. Re-activating the same
  pair is idempotent (reuses the seat). Same user on a *new* machine needs a
  free seat or it's a 409.
- **Seat tokens are asymmetrically signed (Ed25519).** The client embeds only
  the **public** key and verifies authenticity + expiry **offline**, and can
  never mint its own. Periodic online `/seat/validate` catches revocations the
  offline check can't see.
- **Offline grace:** seat tokens are 30-day JWTs (configurable). Beyond grace
  with no successful validate, the client degrades to free tier — never
  hard-locks mid-work (same posture as today's validator).
- **Revoke / deprovision / transfer are first-class and audited.** Deprovision
  revokes **all** the user's seats + refresh tokens and is the hook where chunk
  2/3 will stop releasing per-matter keys (DECISION.md §4 — marked with a `NOTE`
  in `routes/admin.ts`).

---

## API

Base URL in dev: `http://127.0.0.1:5190`. Full typed shapes:
[`src/contract.ts`](src/contract.ts) (dependency-free; copy/import into the
desktop repo to wire the client).

### Open
| Method · Path | Body | Returns |
|---|---|---|
| `GET /healthz` | — | `{ ok, service, version }` |
| `GET /.well-known/seat-pubkey` | — | the Ed25519 **public** PEM the client embeds |

### Auth
| Method · Path | Body | Returns |
|---|---|---|
| `POST /auth/login` | `{ email, password }` | `{ user, access_token, refresh_token, ... }` |
| `POST /auth/refresh` | `{ refresh_token }` | rotated `{ access_token, refresh_token, ... }` |
| `POST /auth/logout` | `{ refresh_token }` | `{ ok: true }` (idempotent) |
| `GET /auth/me` | — *(Bearer)* | `{ user, org }` |

### Licensing / seats (client-facing core)
| Method · Path | Auth | Body | Returns |
|---|---|---|---|
| `POST /org/activate` | Bearer | `{ license_key, machine_id, machine_label? }` | `{ token, tier, packs, seats, seat_id, expires_at }` · **409** `{ error:"seat_limit_exceeded", seats:[...] }` |
| `POST /seat/validate` | none¹ | `{ seat_token }` | `{ valid:true, tier, packs, seats, seats_used, ... }` / `{ valid:false, reason }` |
| `POST /seat/heartbeat` | none¹ | `{ seat_token }` | same as validate + bumps `last_seen` |

¹ The seat token *is* the credential (asymmetrically signed); these are called
on a timer without necessarily holding a fresh access JWT. They return only
entitlement metadata, never secrets. Both also accept the legacy `{ token }`
field name for drop-in compatibility with today's `/validate`.

### Admin (Bearer access token, `role: admin`, same-org only)
| Method · Path | Body |
|---|---|
| `POST /org/seats` | — → list seats (who / machine / `last_seen` / `inactive`) |
| `POST /org/seat/revoke` | `{ seat_id, reason? }` |
| `POST /org/user/deprovision` | `{ user_id }` → revokes all their seats + tokens |
| `POST /org/seats/transfer` | `{ from_seat_id, to_user_id, to_machine_id, to_machine_label? }` |
| `POST /org/users` | `{ email, password, role? }` → create a member |
| `GET\|POST /org/audit` | — → recent license/identity audit events |

### Provisioning (billing-driven)
| Method · Path | Authentication | Body |
|---|---|---|
| `POST /admin/org` | `Authorization: Bearer <ADMIN_PROVISION_SECRET>` | `{ name, plan, packs?, seat_limit, admin_email, admin_password }` → creates org + admin + initial license key (returned **once**) |

`/admin/org` is protected twice. The application requires a dedicated global
operations credential before it reads the body, and the edge still blocks all
`/admin/*` traffic. The credential is separate from `AUTH_SECRET` and user JWTs:
an organization admin cannot provision another organization. If
`ADMIN_PROVISION_SECRET` is empty, the route is locked closed.

### Matters + ethical walls (chunk 2; Bearer access token, `role: admin`, same-org)
| Method · Path | Body |
|---|---|
| `POST /org/matters` | `{ client_name }` → create a matter (201) |
| `POST /org/matters/list` | — → `{ matters: [...] }` |
| `POST /matter/:id/archive` | — → archive |
| `POST /matter/:id/members/add` | `{ user_id, role? }` → add member (+ `key_release` hint) |
| `POST /matter/:id/members/remove` | `{ user_id }` → remove (**bumps `key_epoch`** → rotate) |
| `POST /matter/:id/members/list` | — → `{ members, walls, key_epoch }` |
| `POST /matter/:id/wall/set` | `{ user_id, reason? }` → **raise a screen** (**bumps `key_epoch`**) |
| `POST /matter/:id/wall/clear` | `{ user_id }` → lift a screen (does **not** re-grant membership) |

### E2EE sync relay (chunk 2; any firm member — access JWT + active seat + `member ∧ ¬walled`)
| Method · Path | Auth | Body / Query | Returns |
|---|---|---|---|
| `POST /matter/:id/updates` | Bearer + `seat_token` (body) | `{ blob_id, ciphertext_b64, seat_token, key_epoch? }` | `{ ok, cursor, blob_id, key_epoch, duplicate }` · 201 new / 200 dup · **403** walled/non-member · **404** cross-org · **413** over cap |
| `GET /matter/:id/updates` | Bearer + `?seat_token=` | `?since=<cursor>` | `{ updates:[{cursor, ciphertext_b64, ...}], cursor, latest_cursor, has_more }` |
| `GET /matter/:id/sync` *(WS)* | `?seat_token=` + `?access_token=`² | — | live `update` frames + an initial backlog; access-gated **before** upgrade |

² The browser `WebSocket` API can't set an `Authorization` header, so the relay
accepts the short-lived access JWT via `?access_token=` **only on the relay
endpoints** (`authenticateRelay`). The HTTP relay keeps using the header.

### Assured zero-retention inference proxy (chunk 3; DECISION.md §5)
| Method · Path | Auth | Body / Headers | Returns |
|---|---|---|---|
| `POST /assured/infer` | Bearer + `X-Seat-Token` | Headers: `X-Provider`, `X-Model`, `X-Stream?`. **Body = provider-native payload** | the provider response **streamed back verbatim** + `X-Keepance-No-Retention: true` + `X-Keepance-Request-Id` · **401** bad/missing seat · **409** no managed key · **502/504** upstream error/timeout |
| `POST /assured/keys/set` | Bearer · `admin` | `{ provider, api_key }` | `{ ok, provider, key_last4 }` (key encrypted at rest; never returned) |
| `POST /assured/keys/list` | Bearer · `admin` | — | `{ keys:[{provider, key_last4, updated_at, updated_by}] }` |
| `POST /assured/keys/delete` | Bearer · `admin` | `{ provider }` | `{ ok, provider, deleted }` |
| `POST /assured/billing` | Bearer · `admin` | — | `{ rows: BillingMeta[] }` — **metadata only** (ids, model, token counts, status, latency, ts) |

See [the assured proxy section](#assured-zero-retention-inference-proxy-decisionmd-5) below for how the zero-retention guarantee is enforced + proven.

**The relay is a dumb pipe (DECISION.md §1).** It stores `{matter_id, blob_id,
ciphertext, author_seat, key_epoch, created_at}` — **opaque bytes it never
parses, decodes, hashes, or logs.** `ciphertext_b64` is a client-encrypted Yjs
update; the relay never holds the per-matter key and the only shape check is a
**1 MiB size cap** (a sanity bound, not content inspection). Pushes are
idempotent on `(matter, blob_id)`; `since`-cursor catch-up returns updates
strictly after the cursor, ascending. Every relay access (push/pull/connect) is
gated by the §4 predicate and **audited on both grant and denial**
(`matter.access.granted` / `matter.access.denied`).

#### Matter ACL + ethical walls (DECISION.md §4)
The server is the source of truth for `MatterMember` + `EthicalWall`. One
predicate, computed in one place (`src/lib/matters.ts → resolveAccess`),
fail-closed:

```
allowed = (member ∨ org-admin) ∧ ¬walled        # deny-overrides-allow
```

- **Default deny** — no `MatterMember` row ⇒ no access.
- **An ethical wall wins outright** — a screened user is blocked even if
  mistakenly added as a member or holding the admin role. A walled user's relay
  push/pull is 403 and their WebSocket upgrade is refused.
- **Cross-org is 404** (never confirm another org's matter exists).
- Walls + membership changes are append-only **audited** (the audit trail is
  itself the compliance artifact).

#### Where per-matter key release/rotation hooks in (for the desktop task)
The relay stores only ciphertext; the per-matter content key is **client-held**
and released **out of band** into the OS keychain
(`com.keepance.matter.<matter_id>`, §2) — only to `member ∧ ¬walled`. The server
tracks a **`key_epoch`** per matter (starts at 1) and bumps it at exactly three
points, each emitting a `matter.key.rotate` audit event:

| Server action | Effect | Desktop key-release service must… |
|---|---|---|
| `POST /matter/:id/members/add` | response carries `key_release` (`release_to_member` \| `blocked_walled`) | **release** the current-epoch key to the new member's keychain (iff not walled) |
| `POST /matter/:id/members/remove` | `key_epoch++` | **stop** releasing to the removed user; **rotate** + re-release the new key to remaining members |
| `POST /matter/:id/wall/set` | `key_epoch++` | **stop** releasing to the screened user; **rotate** + re-release to everyone else |
| `POST /org/user/deprovision` (chunk 1) | — | **stop** releasing all matter keys to that user (existing `NOTE` hook in `routes/admin.ts`) |

Updates carry the `key_epoch` they were sealed under, so a removed/walled user's
old key cannot decrypt updates pushed after the bump (DECISION.md §4 layer 2 —
the cryptographic teeth). The server never sees the key; rolling the actual
crypto is the desktop task's job.

---

## Security posture

- Passwords bcrypt-hashed; refresh tokens + license keys keyed-hashed at rest.
- Access JWTs HS256-signed; seat tokens Ed25519-signed. JWT verify pins `alg`
  (rejects `alg:none` / algorithm-confusion) and compares signatures in
  constant time.
- All inputs validated (email regex, ≥12-char passwords capped at 200 to bound
  bcrypt cost, plan/pack allow-lists, 64 KB body cap).
- Auth endpoints (login/refresh) are **IP rate-limited** (fixed window, default
  10/min) → 429.
- Cross-org access is blocked on every admin action (the actor's `org_id` must
  match the target).
- Append-only audit log of license events.
- No secrets in the repo: `.env` is gitignored, only `.env.example` is committed;
  the seat private key is generated by `bun run keygen` and lives in env.
- Binds `127.0.0.1` by default; the reverse proxy's `/admin/*` block remains the
  outer layer and application authentication remains the inner layer.

---

## Assured zero-retention inference proxy (DECISION.md §5)

The **firm option** for managed AI inference + a DPA, as an alternative to pure
BYOK. A firm seat sends a provider-native inference request; the proxy attaches
the **org's managed provider key** (one per org+provider, encrypted at rest),
forwards the request body **straight to the provider as an opaque pass-through**,
and **streams the response back** — persisting only non-content metadata. BYOK
stays the default and the strongest story; this is the "one bill + a DPA +
we-operate-it" path for firms that want it.

### How the no-body-persistence guarantee is enforced (by construction)

The whole value is that the proxy is *architecturally incapable* of persisting
prompts/completions. That's enforced in code, not by discipline:

1. **`OpaqueBody` (a newtype with no content accessor).** The prompt bytes are
   wrapped in `src/lib/assured-types.ts → OpaqueBody`. It holds the bytes in a
   true `#private` field, exposes **no** `.text()`/`.json()`, and its
   `toString`/`toJSON`/`util.inspect` hooks all return
   `"[OpaqueBody <redacted: zero-retention>]"`. So if anyone ever hands a body to
   a logger or `JSON.stringify`, they get a redaction marker — never the prompt.
   The only egress is `take()`, one-shot, straight into the upstream `fetch`.
2. **Token counts come from the provider, not the body.** `src/lib/assured.ts →
   scanUsage` reads a **tee'd** copy of the *response* stream, extracts only the
   provider's integer `usage` counts (Anthropic/OpenAI/Google shapes), and
   discards every chunk of text. We never read the prompt or completion to count
   tokens.
3. **The only durable write is metadata.** `BillingMeta` (and the
   `inference_billing` table) have **no field/column** capable of holding a body
   — just `{request_id, org_id, seat_id, provider, model, input_tokens,
   output_tokens, status, latency_ms, ts}`. There is deliberately no
   `store.save(body)` and no `console.log(body)` anywhere on the path; failures
   log only `redactTarget()` (provider + endpoint, never the key, never the body).

> **Transient-memory note (honest).** The prompt bytes are read into memory for
> the duration of one request (the irreducible minimum §5 describes), wrapped in
> `OpaqueBody`, and dropped when the upstream request completes. We buffer rather
> than re-stream the inbound upload purely for runtime robustness (a streamed
> upload whose upstream aborts mid-flight can wedge the response in this Bun
> version); it is the same transient RAM, never written anywhere. The **response**
> is a true pass-through stream.

### How the guarantee is PROVEN (the falsifiable guard test)

`test/assured-proxy.test.ts` runs a full round-trip against a **local fake
provider** (no real API calls) and asserts:

- A unique high-entropy **sentinel** string is fed as the prompt and echoed back
  in the completion. After the request completes, the sentinel appears in
  **neither the DB** (every table/column, including BLOBs + hex, is dumped and
  scanned) **nor any captured server log** (all `console.*` are intercepted for
  the request's duration, including the fire-and-forget usage scan + billing
  write). The billing row exists and is **metadata-only** (asserted key set).
- A **static** check that the data-path source never calls `req.text()`/
  `req.json()` on the inference body, carries it only via `OpaqueBody` →
  `take()`, and has no body-interpolating `console.*` call.

The guard is *meaningful*: deliberately adding a `console.log(prompt)` makes the
sentinel test fail (verified). This is the "here is the code; there is no write
path for bodies, and here's the test that proves it" artifact §5 calls for — a
firm's IT can run `bun test` themselves.

### Managed keys + billing

- **One managed key per (org, provider)**, set by an admin via
  `POST /assured/keys/set`. Stored **encrypted at rest** (AES-256-GCM under a
  server master key derived from `MANAGED_KEY_SECRET` via HKDF — see
  `crypto.encryptSecret`). The plaintext is encrypted before it touches storage,
  **never returned** (only `key_last4`), and **never logged**. Decrypted into
  transient memory only to attach the provider auth header for one request.
- **Auth + limits:** valid access JWT **+** active, org-bound seat (reuses
  chunk-1 `verifyActiveSeat` — a leaked seat alone can't be used cross-user). A
  seat can only use **its own org's** managed key. Per-IP rate limit; an upstream
  **timeout** severs a hung provider (→ 504); client **abort** propagates upstream
  (streaming abort supported). Every inference is audited (`assured.infer` /
  `assured.infer.rejected`) — metadata only.

### Caveat the firm must understand (inherent to any proxy)

The **upstream provider still receives the prompt in plaintext** — that is
unavoidable for a proxy that has to speak to the model at all. Our guarantee is
that *Keepance* retains nothing. For end-to-end zero retention the firm must also
configure **provider-side ZDR / no-training** on the managed account (Anthropic
ZDR, OpenAI ZDR/no-train, Google no-train), backed by the **DPA**. The proxy
stamps `X-Keepance-No-Retention: true` per response as a customer-verifiable
signal. A firm that won't accept *any* plaintext exposure should use BYOK-direct
with their own provider DPA — and we say so.

---

## What the next chunks + the desktop wiring need

**Desktop client wiring (a later task):**
- Point `src/hooks/useLicense.ts` at this server. Activation becomes: firm sign-in
  → `POST /org/activate` (Bearer + `machine_id`) → store the returned seat token
  **in the OS keychain, not `localStorage`**. The existing reader already
  understands `{ token, tier, packs, seats, expires_at }`.
- Replace the weekly `/validate { token }` with `POST /seat/validate { seat_token }`
  and add a periodic `POST /seat/heartbeat`. Embed the Ed25519 **public** key
  (from `/.well-known/seat-pubkey` / shipped at build) to verify seat tokens
  offline between checks. Keep the offline-grace + degrade-to-free behavior.
- An **admin UI** calls `/org/seats`, `/org/seat/revoke`, `/org/user/deprovision`,
  `/org/seats/transfer`, `/org/users`, `/org/audit`.
- Types are in `src/contract.ts` — import/copy them.

- **Sync relay client (chunk 2 — now built server-side):** drive a Yjs doc per
  open matter document; on local change, encrypt the Yjs update under the
  per-matter key and `POST /matter/:id/updates`; on startup/reconnect, `GET
  /matter/:id/updates?since=<lastCursor>` and apply; keep a live `GET
  /matter/:id/sync` WebSocket for fan-out (advance `since` to each frame's
  `cursor`). The relay handles ciphertext only — encryption/decryption + the
  per-matter key live entirely client-side.
- **Per-matter key management (the one crypto piece left):** implement
  release/rotation at the four hooks in
  [the key-release table](#where-per-matter-key-releaserotation-hooks-in-for-the-desktop-task)
  above. The server already tracks + bumps `key_epoch` and audits rotations; the
  desktop holds the keys in `com.keepance.matter.<matter_id>` and re-keys on a
  bump. Define admin escrow (a firm admin recovers a matter if an attorney
  leaves — escrow the matter key to an org master key) here too (R9).

- **Assured-proxy client (chunk 3 — now built server-side):** for firms on the
  managed-inference tier, route the existing provider calls through
  `POST /assured/infer` instead of calling the provider directly. Send the access
  JWT + `X-Seat-Token` + `X-Provider`/`X-Model` headers and the provider-native
  body; stream the response back as today. BYOK-direct stays the default; this is
  opt-in. An **admin UI** sets the org's managed keys via `/assured/keys/*` and
  reviews usage via `/assured/billing`. Types are in `src/contract.ts`.

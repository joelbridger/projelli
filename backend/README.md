# Keepance Firm Platform Backend

The server side of **Keepance 3.0's firm tier**: user identity/auth + per-org
licensing with real, enforced, revocable seats. It replaces today's honor-system
per-machine license check (a JWT in `localStorage`, with a `seats` number nobody
counted) with org-scoped, signed, revocable **seat tokens** under a
server-enforced `seat_limit`.

This is **chunk 1 of 3** of the firm backend defined in
[`../spikes/firm-sync/DECISION.md`](../spikes/firm-sync/DECISION.md):

1. **Identity + licensing** ← *this service*
2. CRDT sync relay (E2EE update blobs) — later
3. Assured zero-retention inference proxy — later

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
| Method · Path | Body |
|---|---|
| `POST /admin/org` | `{ name, plan, packs?, seat_limit, admin_email, admin_password }` → creates org + admin + initial license key (returned **once**) |

> **`/admin/org` is the one endpoint a deployment must protect at the network
> layer.** In production it is driven by the LemonSqueezy billing webhook behind
> a loopback-only reverse proxy (same trust model as the legacy validator's
> `/webhook`). It has no in-app auth gate because there is no admin to authorize
> the very first org. Do **not** expose it publicly.

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
- **Not deployed.** Built + tested locally only. Binds `127.0.0.1` by default;
  a reverse proxy + TLS + the `/admin/org` network gate are a later, gated step.

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

**Chunk 2 — CRDT sync relay:** authenticate seats here (reuse the access token /
seat token), then fan out **opaque E2EE CRDT blobs** keyed by `(matter_id,
doc_id)` only to `member ∧ ¬walled` seats. Same trust class: ciphertext only.
The relay needs: a "is this seat valid right now" check (reuse `/seat/validate`)
and per-matter membership (the `MatterMember`/`EthicalWall` tables from §4 —
*not* built here; this chunk stopped at Org/User/Seat).

**Chunk 3 — assured zero-retention proxy:** authenticate firm seats (reuse this
service's tokens), attach the firm's provider credential, stream through with
**no body write path** (type-enforced), metadata-only billing logs. Reuses the
org/seat identity established here.

**Per-matter keys + ethical walls (§4):** the `deprovision` handler is already
the hook to stop releasing matter keys (see the `NOTE` in `routes/admin.ts`).
Adding `Matter`, `MatterMember`, `EthicalWall` + the key-release service is the
natural next slice once chunk 2 needs them.

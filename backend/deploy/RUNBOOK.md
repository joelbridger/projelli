# Keepance firm backend — production deploy runbook (`api.lanternplatform.app`)

**Status:** prepared, **NOT executed**. Nothing in here has touched live infra.
This is the exact ordered one-pass procedure to bring the firm backend up at
**https://api.lanternplatform.app**, additively, without disturbing the existing
`licenses.lanternplatform.app` validator.

**Target host:** the home server (same box as `license-validator`, Caddy, and the
Cloudflare tunnel). Deploy posture mirrors `license-validator` exactly:
Bun + `Bun.serve`, binds `127.0.0.1`, Caddy terminates TLS and is the only caller,
systemd-hardened.

| Fact | Value |
|---|---|
| Service name | `keepance-backend.service` (system unit) |
| Repo checkout | `/home/jameson/lantern/backend` |
| Loopback port | **5194** (5190/5191/5193 were already occupied; 5194 verified free 2026-06-09) |
| Env file (real secrets) | `/etc/keepance-firm-backend.env` (root:jameson, chmod 640) |
| Persistent DB | `/home/jameson/services/keepance-firm-backend/data/keepance-firm.sqlite` |
| Public hostname | `api.lanternplatform.app` → tunnel → Caddy:8080 → 127.0.0.1:5194 |
| Tunnel id | `d4e16129-ddc2-4189-be59-009ebc3f7f6d` |
| Health endpoint | `GET /healthz` → `{"ok":true,"service":"keepance-firm-backend","version":"0.1.0"}` |

> **Pre-verified (no live infra touched):** `bun run typecheck` clean,
> `bun test` = **104 pass / 0 fail**, and a throwaway-port boot with the generated
> `.env.production` returned a healthy `/healthz` and served `/.well-known/seat-pubkey`.

> **⚠️ Coexistence guarantee.** Every step below is additive. The `@licenses` Caddy
> block (5181), the `licenses.lanternplatform.app` tunnel ingress, and the
> `license-validator.service` are **never modified**. If anything goes wrong, the
> rollback in §H removes only the new `api.lanternplatform.app` surface.

---

## A. Install deps + build

The backend is pure TypeScript run directly by Bun (no compile/bundle step).
"Build" = install deps and prove it typechecks + tests green on the deploy host.

```bash
cd /home/jameson/lantern/backend

# Make sure the checkout is on the intended ref (the firm backend lives on keepance-3.0
# until 3.0 merges to the default branch).
git -C /home/jameson/lantern rev-parse --abbrev-ref HEAD    # expect: keepance-3.0

# Deterministic install from the committed lockfile.
/home/jameson/.bun/bin/bun install --frozen-lockfile

# Gates (evidence before flipping anything on):
/home/jameson/.bun/bin/bun run typecheck     # tsc --noEmit, must be clean
/home/jameson/.bun/bin/bun test               # must be 104 pass / 0 fail
```

> There are **no runtime npm dependencies** (`dependencies: {}` — only `@types/bun`
> + `typescript` as devDeps), so nothing extra ships. `bun run src/server.ts` is the
> whole runtime.

---

## B. Drop in the production env file (real secrets)

The repo's gitignored `backend/.env.production` already contains real, generated
secrets (a strong `AUTH_SECRET`, a dedicated `MANAGED_KEY_SECRET`, and a fresh
Ed25519 seat keypair). Install it to the system path the unit reads, with the same
ownership/permissions as `/etc/license-validator.env` (`root:jameson`, `640`).

```bash
# Copy the generated secrets file into place (it already has PORT=5194 + the right DB_PATH).
sudo install -o root -g jameson -m 640 \
  /home/jameson/lantern/backend/.env.production \
  /etc/keepance-firm-backend.env

# Verify (should show -rw-r----- root jameson):
ls -la /etc/keepance-firm-backend.env
```

> **If you'd rather generate the secrets fresh on the host instead of copying:**
> ```bash
> cd /home/jameson/lantern/backend
> cp .env.production.example /tmp/firm.env
> # AUTH_SECRET + MANAGED_KEY_SECRET:
> echo "AUTH_SECRET=$(openssl rand -hex 48)"        # paste into /tmp/firm.env
> echo "MANAGED_KEY_SECRET=$(openssl rand -hex 48)" # paste into /tmp/firm.env
> # Seat keypair (prints escaped single-line SEAT_PRIVATE_KEY_PEM / SEAT_PUBLIC_KEY_PEM):
> bun run keygen                                     # paste both into /tmp/firm.env
> sudo install -o root -g jameson -m 640 /tmp/firm.env /etc/keepance-firm-backend.env && shred -u /tmp/firm.env
> ```
> If you regenerate the **seat keypair**, the desktop client must ship the new
> PUBLIC key (`GET /.well-known/seat-pubkey`) — keep server + client in lockstep.

### Create the writable data directory (the unit's only ReadWritePaths)

```bash
sudo -u jameson mkdir -p /home/jameson/services/keepance-firm-backend/data
```

---

## C. Install + start the systemd unit

```bash
# Install the prepared unit (it is a SYSTEM unit, modeled on license-validator.service).
sudo install -o root -g root -m 644 \
  /home/jameson/lantern/backend/deploy/keepance-backend.service \
  /etc/systemd/system/keepance-backend.service

sudo systemctl daemon-reload
sudo systemctl enable --now keepance-backend.service

# Verify it's running and bound to loopback 5194:
systemctl status keepance-backend.service --no-pager
journalctl -u keepance-backend.service -n 30 --no-pager   # expect: "listening on http://127.0.0.1:5194"
ss -tlnp 'sport = :5194'                                   # expect one 127.0.0.1:5194 LISTEN

# Loopback health check (before the public route exists):
curl -s http://127.0.0.1:5194/healthz ; echo
# expect: {"ok":true,"service":"keepance-firm-backend","version":"0.1.0"}
```

---

## D. Add the Caddy block + reload

Insert the prepared host block **inside** the existing `:8080 { ... }` site block,
right after the `@licenses handle { ... }` block (~line 66). Source:
`deploy/Caddyfile.snippet`.

```bash
# Back up the live Caddyfile first (matches the existing .bak-<epoch> convention):
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%s)
```

Then edit `/etc/caddy/Caddyfile` and paste this block after the `@licenses` block
(do NOT modify the `@licenses` block itself):

```caddy
    # api.lanternplatform.app — Keepance firm backend (Bun systemd service; loopback-only)
    @firmapi host api.lanternplatform.app
    handle @firmapi {
        reverse_proxy 127.0.0.1:5194
        header {
            X-Content-Type-Options "nosniff"
            X-Frame-Options "DENY"
            Referrer-Policy "no-referrer"
        }
    }
```

```bash
# Validate config BEFORE reloading (catches typos without dropping live traffic):
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Graceful reload (no dropped connections; existing hosts unaffected):
sudo systemctl reload caddy
# (or: sudo caddy reload --config /etc/caddy/Caddyfile)

# Caddy is reachable only via loopback:8080; you can't curl api.lanternplatform.app yet
# (DNS/tunnel come next), but you can confirm the route resolves with a Host header:
curl -s -H 'Host: api.lanternplatform.app' http://127.0.0.1:8080/healthz ; echo
# expect the same healthz JSON, now proxied through Caddy.
```

---

## E. Add the Cloudflare tunnel ingress + DNS + restart the tunnel

Source: `deploy/cloudflared-ingress.snippet.yml`.

```bash
# Back up the live tunnel config (matches the existing .bak.<epoch> convention):
sudo cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak.$(date +%s)
```

Edit `/etc/cloudflared/config.yml` and add this line to the `ingress:` list,
**above** the final `- service: http_status:404` catch-all (place it next to the
other keepance.com hostnames):

```yaml
  - hostname: api.lanternplatform.app
    service: http://localhost:8080
```

Add the DNS record (one proxied CNAME → the tunnel). Easiest is the cloudflared CLI:

```bash
# Creates/repoints the proxied CNAME api.lanternplatform.app -> <tunnel-id>.cfargotunnel.com:
sudo cloudflared tunnel route dns d4e16129-ddc2-4189-be59-009ebc3f7f6d api.lanternplatform.app
```
(or add it by hand in the Cloudflare dashboard: CNAME `api` →
`d4e16129-ddc2-4189-be59-009ebc3f7f6d.cfargotunnel.com`, **Proxied**.)

Apply the ingress change by restarting the tunnel:

```bash
# cloudflared runs as a system service on this host:
sudo systemctl restart cloudflared
systemctl status cloudflared --no-pager
journalctl -u cloudflared -n 20 --no-pager   # confirm it picked up the new ingress, no errors
```

> The tunnel restart briefly re-establishes all hostnames (keepance.com, licenses.*,
> etc.). It's the same single tunnel process; expect a sub-second blip on existing
> sites and then everything (including the new host) is up.

---

## F. Verify end-to-end

```bash
# 1) Public health through the full path (DNS -> tunnel -> Caddy -> 5194):
curl -s https://api.lanternplatform.app/healthz ; echo
# expect: {"ok":true,"service":"keepance-firm-backend","version":"0.1.0"}

# 2) Seat public key is served (the client embeds/verifies against this):
curl -s https://api.lanternplatform.app/.well-known/seat-pubkey | head -1
# expect: -----BEGIN PUBLIC KEY-----

# 3) TLS terminates at Cloudflare's edge (cert valid, HTTP/2):
curl -sI https://api.lanternplatform.app/healthz | head -5

# 4) Confirm the EXISTING validator is still healthy and untouched:
curl -s https://licenses.lanternplatform.app/healthz 2>/dev/null || \
  curl -sI https://licenses.lanternplatform.app/ | head -3
```

> **Caddy catch-all caveat (house rule):** always check the response **body**, not
> just a 200 — a wrong host-match can fall through to Caddy's `respond "Site not
> found" 404`. Step F1 asserts the healthz JSON body specifically.

---

## G. Point the desktop client at the production backend (the one-line cutover)

The client's firm base URL is centralized in **one file**:
`src/modules/firm/firmConfig.ts`. The production constant currently reads
`https://firm.keepance.com`; the deploy-readiness doc and this deployment use
**`https://api.lanternplatform.app`**. Reconcile it:

```diff
- const PROD_FIRM_API_BASE = 'https://firm.keepance.com';
+ const PROD_FIRM_API_BASE = 'https://api.lanternplatform.app';
```

That single constant feeds **both** `getFirmApiBase()` (all HTTP calls:
`FirmApiClient`, `assuredInference`) **and** `getMatterSyncSocketUrl()` (the WS
relay URL derives from it), so the one line covers every firm endpoint. No other
client change is needed for the URL cutover.

Two related items that belong with the 3.0 version bump (per the deploy-readiness
doc, gated to go-live — **not** part of standing up the backend):
- **CSP `connect-src`** in `src-tauri/tauri.conf.json` must include
  `https://api.lanternplatform.app` (and the matching `wss://api.lanternplatform.app` if the CSP
  enumerates WebSocket origins) so the packaged app may reach the backend.
- Verify `src/modules/firm/firmConfig.ts` `FIRM_APP_VERSION` (`'3.0.0'`) matches the
  release version.

> For staging/QA against the live backend without rebuilding, set
> `VITE_FIRM_API_BASE=https://api.lanternplatform.app` at build time — it overrides the
> constant (resolution order: env override → dev proxy → prod constant).

---

## H. Rollback (removes ONLY the new api.lanternplatform.app surface)

Each layer is independently reversible; `licenses.lanternplatform.app` (5181) and
`license-validator.service` are never modified, so solo/v2.5 licensing is
unaffected throughout.

```bash
# 1) Stop + disable the firm backend:
sudo systemctl disable --now keepance-backend.service
sudo rm /etc/systemd/system/keepance-backend.service
sudo systemctl daemon-reload

# 2) Remove the Caddy block (restore the backup taken in §D) + reload:
sudo cp /etc/caddy/Caddyfile.bak-<EPOCH> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy

# 3) Remove the tunnel ingress (restore the backup from §E) + restart:
sudo cp /etc/cloudflared/config.yml.bak.<EPOCH> /etc/cloudflared/config.yml
sudo systemctl restart cloudflared

# 4) (Optional) remove the DNS record api.lanternplatform.app in the Cloudflare dashboard.
#    Leaving it is harmless once the ingress is gone (it just 404s at the tunnel).

# 5) Secrets/data persist on disk for a clean retry. To fully tear down:
sudo rm -f /etc/keepance-firm-backend.env
sudo rm -rf /home/jameson/services/keepance-firm-backend/data   # destroys the firm DB — back it up first

# 6) Revert the client cutover if it was shipped:
#    set PROD_FIRM_API_BASE back to its prior value in src/modules/firm/firmConfig.ts.
```

> **Back up the firm DB before any risky change:**
> `cp -a /home/jameson/services/keepance-firm-backend/data /home/jameson/services/keepance-firm-backend/data.bak-$(date +%s)`
> (B2 backups already cover `~/services` patterns.)

---

## I. Post-launch scale items (NOT launch blockers)

Both are mechanical and tied to the **same trigger**: moving off a single home-server
instance (multi-instance / a VPS for a firm SLA or a security review that wants the
infra off a residential IP). For the launch cohort (~first 10 firms), the
home-server + SQLite path is adequate and reversible.

- **SQLite → Postgres.** All DB access funnels through the typed `Store` class in
  `src/lib/db.ts`; the SQL is deliberately vanilla. The port swaps the driver and
  upgrades the two concurrency-sensitive transactions (`activateSeat`,
  `transferSeat`) from SQLite's `IMMEDIATE` transaction to Postgres
  `SELECT … FOR UPDATE` / `SERIALIZABLE`, preserving the "two concurrent activations
  can't both exceed `seat_limit`" guarantee.
- **In-memory rate limiter → Redis (or the reverse proxy).** `src/lib/http.ts` ships a
  fixed-window in-memory limiter (auth 10/min, assured proxy 120/min). Fine for one
  instance; move to Redis or push the limit to Caddy when running multi-instance.
- **In-memory sync-ticket store.** The single-use WS sync tickets are held in process
  memory; same single-instance assumption. Multi-instance ⇒ move to Redis with the
  rate limiter.

---

*Prepared 2026-06-09. No live infra was modified to produce this runbook; the only
side effects were generating local secrets into the gitignored `backend/.env.production`
and a throwaway-port boot smoke test.*

---

## §K — SECURITY: /admin/* blocked at the edge (2026-06-11, VG-6b finding)

**Incident:** `POST https://api.lanternplatform.app/admin/org` was reachable from the public internet, unauthenticated, and minted a Firm org + admin user + a valid license key (`handleCreateOrg`, `routes/admin.ts:171` — no `requireAdmin`, by design "billing-webhook driven behind a loopback allowlist"). But the `@firmapi` Caddy block was a blanket `reverse_proxy 127.0.0.1:5194` with no path filter, so the assumed loopback allowlist never existed at the edge. Blast radius: free self-provisioned Firm tier + a foothold into the `/assured/*` zero-retention proxy (provider-key/quota abuse). No existing-customer data exposed (0 orgs; E2EE + cross-org isolation intact).

**Fix (live 2026-06-11):** added inside the `@firmapi` handle block, before the reverse_proxy:
```caddy
@admin path /admin/*
respond @admin 403
```
Backup: `/etc/caddy/Caddyfile.bak-admin-block-20260611-115444`. Validated + `systemctl reload caddy`. Verified from the edge: `/admin/org` POST → 403, `/admin/seats` → 403, `/healthz` → 200, `/.well-known/seat-pubkey` → 200, `/org/claim` → 400 (reaches app), `/webhooks/lemonsqueezy` → 401 (reaches app). Normal provisioning is unaffected (LS webhook creates unclaimed orgs → buyer self-activates via `/org/claim`).

**Defense in depth added in the application:** `POST /admin/org` now requires
`Authorization: Bearer <ADMIN_PROVISION_SECRET>` before its body is read. The
edge 403 remains in place as the outer layer. An empty application secret locks
the route closed; generate this value independently from `AUTH_SECRET` before a
future deployment. The Assured exercise reads it from its off-repo credential
file and sends it only to the loopback route.

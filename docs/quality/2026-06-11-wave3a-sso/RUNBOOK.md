# Wave 3a SSO — Live OIDC Verification Runbook

Date: 2026-06-11  
Scope: End-to-end OIDC relying-party verification against Dex (real IdP), happy path + authenticate-only rejection  
IdP used: Dex v2.46.0 (`ghcr.io/dexidp/dex:latest`)  
Backend: Advisor Prep Hero firm backend (`backend/src/server.ts`) at PORT=5192

---

## Prerequisites

- Docker available on host
- Bun 1.3.4+ on host
- Python 3 with `bcrypt` (`pip install bcrypt`)
- Port 5192, 5556 free on host (adjust if occupied)
- Advisor Prep Hero backend repo at `/home/jameson/keepance/backend`

---

## Step 1: Generate bcrypt password hash for Dex

```bash
python3 -c "
import bcrypt
h = bcrypt.hashpw(b'Password123!', bcrypt.gensalt(rounds=10, prefix=b'2a'))
print(h.decode())
"
```

Note the output (a `$2a$10$...` hash).

---

## Step 2: Write Dex config

Replace `<BCRYPT_HASH>` with the hash from step 1.

```bash
mkdir -p /tmp/dex-test
python3 << 'PYEOF'
bcrypt_hash = "<BCRYPT_HASH>"
config = f"""issuer: http://127.0.0.1:5556/dex

storage:
  type: memory

web:
  http: 0.0.0.0:5556

enablePasswordDB: true

staticClients:
  - id: keepance-test
    secret: keepance-test-secret
    name: Advisor Prep Hero
    redirectURIs:
      - http://172.20.0.1:5192/auth/sso/callback

staticPasswords:
  - email: jane@weston.test
    hash: "{bcrypt_hash}"
    username: jane
    userID: aaaabbbb-1111-2222-3333-444455556666
  - email: nobody@weston.test
    hash: "{bcrypt_hash}"
    username: nobody
    userID: bbbbcccc-2222-3333-4444-555566667777
"""
with open('/tmp/dex-test/config.yaml', 'w') as f:
    f.write(config)
PYEOF
```

Notes:
- `redirectURIs` uses `172.20.0.1` (Docker bridge gateway) because the callback must be reachable from inside the Chrome Docker container. The backend binds to `0.0.0.0:5192`, so `172.20.0.1:5192` reaches it.
- `issuer` stays `http://127.0.0.1:5556/dex` because the backend (on host) reaches Dex at `127.0.0.1:5556`. The loopback issuer exemption in `isLoopbackIssuer()` permits this.
- Dex uses `--network host` so it binds on the actual host interfaces, reachable from the Docker gateway.

---

## Step 3: Start Dex

```bash
docker rm -f dex-sso-test 2>/dev/null || true
docker run -d --name dex-sso-test \
  --network host \
  -v /tmp/dex-test/config.yaml:/etc/dex/config.yaml:ro \
  ghcr.io/dexidp/dex:latest \
  dex serve /etc/dex/config.yaml
sleep 2
docker logs dex-sso-test
```

Verify discovery:
```bash
curl -s http://127.0.0.1:5556/dex/.well-known/openid-configuration | python3 -m json.tool
```

Expected: JSON with `issuer`, `authorization_endpoint`, `token_endpoint`, `jwks_uri`, and `"RS256"` in `id_token_signing_alg_values_supported`.

---

## Step 4: Start the firm backend

```bash
rm -f /tmp/keepance-sso-verify.sqlite

PORT=5192 \
HOST=0.0.0.0 \
AUTH_SECRET=$(openssl rand -hex 48) \
SSO_CALLBACK_BASE=http://172.20.0.1:5192 \
DB_PATH=/tmp/keepance-sso-verify.sqlite \
BOOTSTRAP_ORG_NAME="Weston LLP" \
BOOTSTRAP_ADMIN_EMAIL="admin@weston.test" \
BOOTSTRAP_ADMIN_PASSWORD="adminpassword123" \
BOOTSTRAP_PLAN=practice \
BOOTSTRAP_SEAT_LIMIT=5 \
bun run src/server.ts > /tmp/keepance-sso-backend.log 2>&1 &

sleep 3
cat /tmp/keepance-sso-backend.log
curl -s http://127.0.0.1:5192/healthz
```

Note: `HOST=0.0.0.0` is required so Chrome (in Docker, reaching backend via `172.20.0.1:5192`) can reach it. `SSO_CALLBACK_BASE` must match the `redirectURIs` in Dex config.

---

## Step 5: Seed member and configure SSO via API

```bash
# Login as admin
curl -s -X POST http://127.0.0.1:5192/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@weston.test","password":"adminpassword123"}' > /tmp/admin_login.json

ADMIN_TOKEN=$(python3 -c "import json; print(json.load(open('/tmp/admin_login.json'))['access_token'])")

# Create jane as member
curl -s -X POST http://127.0.0.1:5192/org/users \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{"email":"jane@weston.test","password":"TempPass123!","role":"member"}'

# Configure SSO
curl -s -X POST http://127.0.0.1:5192/org/sso/config/set \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -d '{
    "provider": "generic",
    "issuer": "http://127.0.0.1:5556/dex",
    "client_id": "keepance-test",
    "client_secret": "keepance-test-secret",
    "enabled": true
  }'
```

Expected from config/set: `{"ok":true,"redirect_uri":"http://172.20.0.1:5192/auth/sso/callback"}`

---

## Step 6: Drive the happy-path flow via curl

The Chrome Docker container can reach the backend and Dex via the gateway IP (172.20.0.1), but the final `sso_code` redirect goes to `http://127.0.0.1:<loopback_port>/` which the Chrome container cannot reach (its own loopback has no listener). For the server-side verification, drive the flow via curl.

```bash
# 1. Get auth_url
curl -s -X POST http://127.0.0.1:5192/auth/sso/start \
  -H 'Content-Type: application/json' \
  -d '{"email":"jane@weston.test","loopback_port":49777}'
# Capture auth_url and state

# 2. Navigate to auth_url, get Dex login page (extract form state from HTML)
AUTH_URL="<auth_url from above>"
curl -s -c /tmp/dex_cookies.txt -L "$AUTH_URL" > /tmp/dex_login_page.html
DEX_STATE=$(grep -oP 'state=\K[a-z0-9]+' /tmp/dex_login_page.html | head -1)

# 3. POST login credentials to Dex
curl -s -c /tmp/dex_cookies.txt -b /tmp/dex_cookies.txt \
  -D /tmp/login_headers.txt \
  -X POST "http://127.0.0.1:5556/dex/auth/local/login?back=&state=${DEX_STATE}" \
  -d "login=jane%40weston.test&password=Password123%21" > /dev/null
# Extract HMAC and approval state from Location header

HMAC="<from Location header>"
APPROVAL_STATE="<same as DEX_STATE>"

# 4. GET approval page + POST to grant access, capture the redirect to backend callback
curl -s -c /tmp/dex_cookies.txt -b /tmp/dex_cookies.txt \
  -D /tmp/approval_headers.txt \
  -X POST "http://127.0.0.1:5556/dex/approval?hmac=${HMAC}&req=${APPROVAL_STATE}" \
  -d "req=${APPROVAL_STATE}&approval=approve" > /dev/null
# Location: http://172.20.0.1:5192/auth/sso/callback?code=...&state=...

CODE="<from Location header>"
STATE="<from Location header>"

# 5. Call backend callback - it verifies id_token (iss/aud/exp/nonce/RS256/JWKS) and 302s to loopback
curl -s -D /tmp/callback_headers.txt \
  "http://127.0.0.1:5192/auth/sso/callback?code=${CODE}&state=${STATE}"
# Location: http://127.0.0.1:49777/?sso_code=...

SSO_CODE="<from Location header>"

# 6. Exchange sso_code for LoginResponse
curl -s -X POST http://127.0.0.1:5192/auth/sso/exchange \
  -H 'Content-Type: application/json' \
  -d "{\"sso_code\":\"${SSO_CODE}\"}"
# Expected: {user: {email:"jane@weston.test",...}, access_token:..., refresh_token:...}
```

For a Chrome-driven visual test (when Chrome is on the SAME machine as the backend, not Docker-isolated):
1. Start the harness: `bun run /tmp/sso-desktop.ts jane@weston.test 49777 http://127.0.0.1:5192`
2. Navigate the auth_url in Chrome, fill `jane@weston.test` / `Password123!`, submit, approve the Grant Access screen
3. The Dex consent redirects to the backend callback, which issues a 302 to `127.0.0.1:49777`, where the harness captures the sso_code
4. The harness auto-exchanges and prints the LoginResponse

---

## Step 7: Negative tests

### Replay used sso_code
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:5192/auth/sso/exchange \
  -H 'Content-Type: application/json' \
  -d '{"sso_code":"<already-used-code>"}'
# Expected: 401
```

### Garbage sso_code
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:5192/auth/sso/exchange \
  -H 'Content-Type: application/json' \
  -d '{"sso_code":"garbage-not-a-real-code"}'
# Expected: 401
```

### Callback-level rejection (suspended/unknown user)
```bash
# Suspend the user in SQLite, then run a fresh flow through Dex:
python3 -c "
import sqlite3
conn = sqlite3.connect('/tmp/keepance-sso-verify.sqlite')
conn.execute(\"UPDATE users SET status='suspended' WHERE email='jane@weston.test'\")
conn.commit(); conn.close()
"
# Run full flow steps 1-5 above for jane@weston.test but skip start (needs to pre-seed state)
# The callback returns 302 to loopback with ?sso_error=no_matching_account
# and audit_events gets a sso.login.rejected row with detail={"reason":"org_or_status"}
```

### SSO unavailable for unknown email
```bash
curl -s -X POST http://127.0.0.1:5192/auth/sso/start \
  -H 'Content-Type: application/json' \
  -d '{"email":"nobody@weston.test","loopback_port":49778}'
# Expected: {"error":"sso_unavailable","detail":"SSO is not available for this email. Ask your firm admin."}
```

### Secret never returned in config/get
```bash
curl -s -X POST http://127.0.0.1:5192/org/sso/config/get \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
# Expected: has_secret:true but NO client_secret field in response
```

---

## Step 8: Clean up

```bash
docker rm -f dex-sso-test
pkill -f 'bun run.*server.ts' 2>/dev/null || true
rm -f /tmp/keepance-sso-verify.sqlite /tmp/dex_cookies*.txt /tmp/harness*.log
```

---

## Networking note (Docker test environment)

The Chrome browser on this server runs inside the `jameworld-chrome` Docker container on the `compose_jameworld-internal` network (bridge, gateway `172.20.0.1`). The Dex container uses `--network host` and the backend binds to `0.0.0.0`. From Chrome's perspective:

- Dex is reachable at `http://172.20.0.1:5556/dex` (host Dex via gateway)
- Backend is reachable at `http://172.20.0.1:5192` (host backend via gateway)
- `127.0.0.1:*` in Chrome = the container's own loopback (no listeners there)

In production (real desktop client on the user's machine):
- Everything runs on one machine, so `127.0.0.1` is consistent throughout
- The loopback capture port is bound by the Rust desktop app, not a Docker container

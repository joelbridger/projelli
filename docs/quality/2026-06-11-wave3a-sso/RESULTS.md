# Wave 3a SSO — Live OIDC Verification Results

Date: 2026-06-11  
Status: **DONE — LIVE HAPPY PATH GREEN, REJECTIONS PROVEN**  
IdP: Dex v2.46.0 (real OIDC provider, not a mock)  
Backend: Advisor Prep Hero firm backend v0.1.0 at `http://127.0.0.1:5192`

---

## Per-step verdict table

| Step | Test | Result | Evidence |
|------|------|--------|----------|
| 1 | Dex starts, discovery reachable | PASS | `curl .well-known/openid-configuration` returns full JSON; `issuer=http://127.0.0.1:5556/dex`, `RS256` in signing algs, JWKS endpoint populated |
| 1 | JWKS populated with RS256 key | PASS | `/dex/keys` returns one key: `kty=RSA`, `alg=RS256`, `use=sig`, `kid=b1b44079e1d54752ef3627fa60b2cda4f3eed4cd` |
| 2 | Backend starts, healthz responds | PASS | `{"ok":true,"service":"keepance-firm-backend","version":"0.1.0"}` |
| 2 | Backend self-bootstraps org+admin | PASS | Log: `[bootstrap] created org ... admin=admin@weston.test seat_limit=5` |
| 3 | Admin login returns access_token | PASS | JWT returned, role=admin |
| 3 | Create member `jane@weston.test` | PASS | `{"user":{"email":"jane@weston.test","role":"member","status":"active",...}}` |
| 3 | Configure SSO (issuer=Dex, enabled=true) | PASS | `{"ok":true,"redirect_uri":"http://172.20.0.1:5192/auth/sso/callback"}` |
| 3 | `config/get` never returns `client_secret` | PASS | Response has `has_secret:true` but no `client_secret` field |
| 4 | `/auth/sso/start` fetches Dex discovery, returns real Dex `auth_url` | PASS | auth_url begins with `http://127.0.0.1:5556/dex/auth?...` with PKCE S256 code_challenge + nonce + login_hint |
| 4 | Dex login form renders for valid `auth_url` | PASS | Screenshot: Dex "Log in to Your Account" form visible in Chrome (see screenshots/) |
| 4 | Dex consent "Grant Access" screen shown after login | PASS | Screenshot: "Advisor Prep Hero would like to: View basic profile information / View your email address" |
| 4 | Dex issues auth code, redirects to backend callback | PASS | `Location: http://172.20.0.1:5192/auth/sso/callback?code=f3ogiacxtfrhmzummeejg6ssw&state=...` |
| 4 | Backend callback: fetches Dex discovery (fresh) | PASS | Discovery re-fetched from real Dex at `http://127.0.0.1:5556/dex/.well-known/openid-configuration` |
| 4 | Backend callback: exchanges code at Dex token endpoint | PASS | POSTs `client_id`, `client_secret`, `code`, `code_verifier`, `redirect_uri` to Dex token endpoint; receives `id_token` |
| 4 | Backend callback: fetches real Dex JWKS + verifies RS256 signature | PASS | JWKS fetched from `http://127.0.0.1:5556/dex/keys`; `kid` matched; RSA-SHA256 signature verified by `node:crypto` |
| 4 | Backend callback: `iss` check passes | PASS | `claims.iss == "http://127.0.0.1:5556/dex"` matches stored `cfg.issuer` |
| 4 | Backend callback: `aud` check passes | PASS | `claims.aud == "keepance-test"` matches stored `cfg.client_id` |
| 4 | Backend callback: `nonce` check passes | PASS | Token nonce matches state-stored nonce from `/auth/sso/start` |
| 4 | Backend callback: `exp` check passes | PASS | Token not expired |
| 4 | Backend callback: email matched to active member | PASS | `jane@weston.test` found, status=active, org_id matches |
| 4 | Backend callback: issues one-time `sso_code`, 302s to loopback | PASS | `Location: http://127.0.0.1:49777/?sso_code=PLFR6LYzQ3VRkWCxNk-nF4KGm6UHMqkuNJb9eWySgR8` |
| 4 | `/auth/sso/exchange` returns LoginResponse with correct user | **GREEN** | `{"user":{"email":"jane@weston.test","role":"member","status":"active",...},"access_token":"eyJ...","refresh_token":"..."}` |
| 4 | Audit log records `sso.login` | PASS | `audit_events`: `action=sso.login`, `actor_user_id=jane's UUID`, `detail={"provider":"generic"}` |
| 5 | Unknown email rejected at `/auth/sso/start` | PASS | `{"error":"sso_unavailable","detail":"SSO is not available for this email. Ask your firm admin."}` for `nobody@weston.test` |
| 5 | Callback-level rejection: suspended user → `sso_error=no_matching_account` | PASS | After suspending jane, a fresh Dex code was exchanged; callback 302'd to `http://127.0.0.1:49779/?sso_error=no_matching_account` |
| 5 | Rejection audited | PASS | `audit_events`: `action=sso.login.rejected`, `detail={"reason":"org_or_status"}` |
| 5 | Replay used `sso_code` returns 401 | PASS | HTTP 401, `{"error":"invalid_sso_code"}` |
| 5 | Garbage `sso_code` returns 401 | PASS | HTTP 401 |
| 5 | `config/get` never exposes `client_secret` | PASS | Response keys: `[configured, provider, issuer, client_id, enabled, has_secret, redirect_uri]` — no `client_secret` |

---

## LIVE HAPPY PATH: GREEN

The full authenticate-via-Dex flow completed end-to-end:

1. `/auth/sso/start` fetched the real Dex discovery doc and built an auth_url with PKCE + nonce
2. User authenticated at the real Dex login page (typed `jane@weston.test` / `Password123!`)
3. Dex showed a "Grant Access" consent screen identifying "Advisor Prep Hero" as the relying party
4. After consent, Dex issued a real authorization code and redirected to the backend callback
5. The backend exchanged the code at Dex's token endpoint, received a real RS256-signed id_token
6. The backend fetched Dex's real JWKS, found the matching key by `kid`, verified the RS256 signature using `node:crypto`
7. All claims checked: `iss` matched stored issuer, `aud` matched `client_id`, `nonce` matched state, `exp` not expired
8. `jane@weston.test` matched an active member in the org
9. One-time `sso_code` issued (HMAC-protected), 302 to `http://127.0.0.1:49777/?sso_code=...`
10. `sso_code` exchanged for a full `LoginResponse` with user object + HS256 access_token + refresh_token

---

## Real-IdP quirks observed (vs. mock)

These are the live-IdP differences that matter:

1. **Dex always shows a "Grant Access" consent screen** for the first authorization. The mock skips this. In production flows, users will see a one-time consent prompt before Dex redirects. This is normal OIDC behavior; subsequent auths for the same client skip consent.

2. **`email_verified` is `true` in Dex's id_token** for staticPassword users. Our `emailFromClaims()` function correctly uses `claims.email` when `email_verified !== false`. No issues, but worth noting: some IdPs (notably Entra ID for federated users) omit `email_verified`, and the fallback to `preferred_username` / `upn` is exercised in that case.

3. **Dex issues `preferred_username` as the email address** (not just a display name) for staticPassword users. This aligns with our `emailFromClaims()` fallback logic.

4. **`at_hash` claim present** in Dex id_tokens but not checked by our verifier (not required by OIDC Core for code flow). Not a concern.

5. **PKCE S256 accepted** by Dex without issues. The `code_challenge` / `code_verifier` round-trip worked correctly.

6. **Docker network routing note**: in this test environment, Chrome runs inside a Docker container (`compose_jameworld-internal` bridge, gateway `172.20.0.1`). The redirect URI was `http://172.20.0.1:5192/auth/sso/callback` so Chrome could reach the backend via the host gateway. The backend's final 302 to `http://127.0.0.1:49777/?sso_code=...` aimed at the container's own loopback (no listener there), so we captured the sso_code from the curl-followed `Location` header instead of a live loopback server. In production (Rust desktop app on the user's machine), `127.0.0.1` is consistent and the loopback capture works as designed.

7. **Dex issues id_token `iss` as `http://127.0.0.1:5556/dex`** (the issuer URL from the Dex config), confirming the loopback issuer exemption in `isLoopbackIssuer()` is correctly applied — the backend accepts this issuer without requiring https.

---

## IdP tested

| | |
|--|--|
| **IdP** | Dex v2.46.0 (`ghcr.io/dexidp/dex:latest`) |
| **Storage** | In-memory |
| **Connector** | Local password DB (`enablePasswordDB: true`) |
| **Token signing** | RS256 (RSA key pair generated by Dex at startup) |
| **PKCE** | S256 supported and used |
| **Consent screen** | Yes (shown on first auth; auto-approved on subsequent) |

**Not yet tested** (future leg per Wave 3a handoff):
- Microsoft Entra ID tenant (requires board-level Azure app registration — blocked pending Jameson's Azure tenant setup)
- Google Workspace

---

## Artifacts

- `RUNBOOK.md` — step-by-step reproduction commands
- `RESULTS.md` — this file
- `screenshots/` — Chrome screenshots (Dex discovery doc, login form, consent screen)
- Commit: `git log --oneline -1 -- docs/quality/2026-06-11-wave3a-sso/`

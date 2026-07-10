# Lantern Intake Staging Hosting

Status: staged pipeline only. Nothing here deploys production, and there is no
production command in this folder.

This lane owns the static-page hosting rail and the deploy-time integrity gate.
Lane B owns the relay routes. Lane C owns the real client page. The small page
under `intake-page/src/` is only a staging shell so this rail can be tested now.

## Hosts

| Surface | Staging origin | Notes |
| --- | --- | --- |
| Intake page | `https://intake-staging.lanternplatform.app` | Static bundle only. |
| Intake relay | `https://intake-relay-staging.lanternplatform.app` | Reverse proxy to Lane B relay on loopback. |

The page CSP pins `connect-src` to the relay origin only. No CDN, font host,
analytics host, tag manager, or other third-party origin is allowed.

## Required Environment

For dry-run:

```bash
npm run intake:deploy:staging:dry-run
```

Dry-run builds a signed local bundle with a temporary throwaway signing key,
serves it from `127.0.0.1`, verifies all served hashes, prints the manifest and
bundle version, and changes no staging or production host.

For real staging only:

```bash
export INTAKE_STAGING_RELAY_ORIGIN=https://intake-relay-staging.lanternplatform.app
export INTAKE_STAGING_BASE_URL=https://intake-staging.lanternplatform.app
export INTAKE_STAGING_WEB_ROOT=/var/www/lantern-intake-staging
export INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PATH=/etc/lantern-intake/manifest-signing-private.pem
export INTAKE_MANIFEST_VERIFY_PUBLIC_KEY_PATH=/etc/lantern-intake/manifest-signing-public.pem
npm run intake:deploy:staging
```

The real staging command refuses targets whose host and web-root path do not
clearly say staging, stage, or test.

## What The Deploy Does

1. Copies `intake-page/src/` into `intake-page/dist/staging/releases/<version>/`.
2. Replaces the relay-origin and CSP placeholders.
3. Hashes every page asset with SHA-256.
4. Writes `manifest.json` with every asset hash, one top-level bundle hash, and
   an Ed25519 signature.
5. For real staging, copies that release into the staging web root.
6. Fetches the served candidate version at `/_releases/<version>/` and verifies
   every served byte before `current` is repointed.
7. Repoints `current`, fetches the served `manifest.json` and every served asset
   again, and rolls back `current` if the final check fails.
8. Exits non-zero if any served byte differs from the signed manifest.

That final step is the Wave 1 gate from `ARCHITECTURE.md` T3 and `RISKS.md`
section 3. A changed bundle must fail the deploy, not warn.

## Headers

The static page must serve these security headers:

- `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src https://intake-relay-staging.lanternplatform.app; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; worker-src 'self'; manifest-src 'self'`
- `Referrer-Policy: no-referrer`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- strict `Permissions-Policy`

The relay staging block carries the same no-referrer, no-sniff, no-frame, and
permissions hardening. It also allows CORS from the staging page origin only.

## Fragment Logging Check

The secret part of an intake link is after `#`. Browsers do not send that part
to any server. The check in this folder proves that with a local HTTP server and
also scans the staged Caddy snippets for risky URL reconstruction patterns:

```bash
npm run intake:fragment-check
```

VERIFY-LIVE note: after the real staging hosts exist, check both Caddy access-log
files while opening a URL with a test fragment. The logged request should show
only the path, never the fragment. Keep access-log retention at 24 hours for the
relay, matching the intake architecture.

## Staging Config Files

- `Caddyfile.intake-page-staging.snippet`
- `Caddyfile.intake-relay-staging.snippet`
- `cloudflared-ingress.staging.snippet.yml`

These are additive snippets. They are not complete server config files and must
be inserted into the existing Caddy and Cloudflare tunnel setup by the wave lead.

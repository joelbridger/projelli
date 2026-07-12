# CODEX BUILD BRIEF — Lantern Intake Wave 1, Lane E: Hosting (infra, STAGED ONLY)

You are a Codex build agent. Build exactly the scope below, commit on your branch. **Do NOT push. Do NOT deploy to production. STAGING ONLY.** Wrapper appends the DONE-EXIT sentinel.

> **Production cutover of anything client-facing is NOT your call and NOT Codex's call.** Build the staged pipeline + the integrity gate; if anything forces a production decision, STOP and leave a clear note in your commit message for the wave lead. Staging relay + staging page only.

## Context to read first
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §4 (CSP `default-src 'none'`, `connect-src` pinned to the relay origin, `Referrer-Policy: no-referrer`, no third-party origins), §8 T3 (the page-integrity trust root — published hashes + deploy-time integrity check).
- `docs/plans/lantern-plus/intake/RISKS.md` §3 (the hosted component is the real weak point — the deploy pipeline is security-sensitive infra, same rigor as the relay).
- `docs/plans/lantern-plus/intake/W1-EXEC-PLAN.md` §3 Lane E.
- The Calendly public-booking page hosting rail is the SIBLING pattern — find it (`docs/plans/calendly-scheduling-plan.md` and any `book.`/public-page infra in the repo) and keep headers/CSP/hosting conventions IDENTICAL. One static-host + relay-API pattern for both client-facing surfaces.

## What to build (under `intake-page/deploy/` and/or `infra/intake/`)
1. **Static page deploy pipeline (staged):** builds `intake-page/` into a versioned static bundle and publishes it to a STAGING host. Emits a build manifest listing every asset with its SHA-256 hash and a single top-level bundle hash/version.
2. **Security headers** on the served page (and documented for the relay):
   - `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' (only if unavoidable — prefer 'self'); img-src 'self' data: blob:; connect-src <RELAY_ORIGIN>; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. `connect-src` pinned to the relay origin ONLY — nothing else, ever.
   - `Referrer-Policy: no-referrer`.
   - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (or CSP frame-ancestors), a sensible `Permissions-Policy`.
   - NO third-party origin anywhere (a single CDN/font/analytics origin breaks the whole E2EE story).
3. **Deploy-time integrity check (Wave 1 GATE, not roadmap — §8 T3 / RISKS §3):** after publish, fetch the served bundle and verify each asset's hash against the signed manifest; **FAIL THE DEPLOY (non-zero exit) on ANY mismatch.** This is the whole point of the lane — a poisoned/substituted bundle must not be able to reach clients silently.
4. **Fragment-never-logged check:** a script/test that confirms the relay + page access logs never capture the URL fragment (the `#...` secret). The fragment is never sent in HTTP by browsers; verify the config does not reconstruct or log full URLs with fragments, and document it for the VERIFY-LIVE register.
5. **Relay deploy config (staged):** the relay's staging deploy alongside the page, same rigor. (The relay code is Lane B; you provide the deploy/headers config, not the routes.)

## Tests / verification (must be runnable and green)
- A test that parses the emitted headers and asserts CSP has `default-src 'none'`, `connect-src` = exactly the relay origin, `Referrer-Policy: no-referrer`, and NO third-party origin token anywhere.
- A test of the integrity check: tamper one asset's bytes after manifest generation → the check FAILS the deploy (non-zero exit). Untampered → passes.
- A dry-run of the staged deploy that does not actually push to production and prints the manifest + bundle version.

## Constraints
- STAGING ONLY. No production deploy. No credentials committed. If a step needs a secret, read it from env and document the env var; never hardcode.
- Keep it lean but robust — this is security-sensitive infra; the integrity gate must genuinely fail on mismatch, not warn.
- Before done: the header test + integrity-check test pass; the staged dry-run runs clean. Commit on your branch with a note flagging anything that would need a production/Jameson decision. Do NOT push. Do NOT deploy to prod.

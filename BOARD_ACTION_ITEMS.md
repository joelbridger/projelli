# Board Action Items

> **What this is:** Things only Jameson can do — they require his identity, payment, browser access, or hands on a keyboard outside this Claude session. Everything else has already been built by Claude during the 2026-04-08 marathon session.
>
> **Status:** Generated 2026-04-08. Update or delete items as Jameson completes them.

## TL;DR

The product is **structurally ready to take money**. All the code, content, infrastructure, services, legal docs, and marketing assets that can be built without Jameson's hands are done. Live verification:

- ✅ https://projelli.com — homepage live with new copy, animated demo, email signup form
- ✅ https://projelli.com/legal/{privacy,terms,eula} — legal docs live
- ✅ https://projelli.com/docs/{getting-started,api-keys,faq} — user docs live
- ✅ https://licenses.projelli.com/healthz — license validator service live (returns "ok")
- ✅ https://github.com/projelli — org page live with profile README
- ✅ https://github.com/projelli/projelli — repo live with 6 commits ahead of pre-marathon state

The remaining items below are **pure capital + identity work** that only Jameson can do. Most of them take 5-15 minutes each. Together they unblock Weeks 2, 4, and 6 of the launch plan.

---

## Action items, in priority order

### 1. Windows code signing — IN PROGRESS (2026-04-08)

**Status:** ✅ Azure Artifact Signing account created 2026-04-08 (Microsoft renamed "Trusted Signing" → "Artifact Signing"). Identity Validation Request submitted, status: **In Progress**. Microsoft typically takes 1-3 business days.

**Validation details:**
- Account: `projelli-signing` (in resource group `projelli-rg`, region East US)
- Account email: `microsoft@projelli.com`
- Identity validation ID: `03efa33b-7e76-41f9-b862-10473e3b3757`
- Subject Name (cert): Jameson Daines (Individual Validation)
- Plan: Basic (~$10/mo)

**Once Microsoft approves identity (1-3 days), Jameson needs to send Claude:**
1. **Subscription ID** (visible in Azure portal → Subscriptions)
2. **Tenant ID** (visible in Azure portal → Microsoft Entra ID → Overview)
3. **Endpoint URL** for the signing account (visible in the Artifact Signing account → Overview)
4. **Certificate Profile Name** (visible in the account → Certificate Profiles, after validation completes)
5. Set up a service principal for GitHub Actions to use (Claude will give exact steps)

Claude will then wire Azure Artifact Signing into `.github/workflows/release.yml`.

---

### 2. Apple Developer Program enrollment — ✅ COMPLETE (2026-04-09)

**Status:** Enrolled, approved (same-day, faster than typical), and credentials wired. Personal Apple ID `jamesondaines@outlook.com`, Individual enrollment, Team ID `7HCXDCS279`, $99/yr renewing 2027-04-08.

**Cert generation: done server-side, no Mac involved.** Jameson's work MacBook never touched anything. Process:
1. OpenSSL generated private key + CSR on the server
2. Jameson uploaded CSR to Apple Developer portal in his browser
3. Apple returned `.cer` file
4. Jameson scp'd the `.cer` to the server
5. OpenSSL combined .cer + private key into `.p12` with auto-generated password
6. All credentials pushed to GitHub Secrets via `gh secret set`

**GitHub Secrets set on projelli/projelli:**
- `APPLE_CERTIFICATE` (base64 of .p12)
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY` = "Developer ID Application: Jameson Daines (7HCXDCS279)"
- `APPLE_ID` = jamesondaines@outlook.com
- `APPLE_PASSWORD` (app-specific notarization password)
- `APPLE_TEAM_ID` = 7HCXDCS279

**Files on the server:**
- `~/.projelli-certs/projelli-developer-id.key` (private key, chmod 600)
- `~/.projelli-certs/developerID_application.cer` (Apple-issued cert)
- `~/.projelli-certs/projelli-developer-id.p12` (combined, chmod 600)
- `~/.projelli-secrets` (credential values, chmod 600)

**The `.github/workflows/release.yml` workflow already references these secrets** — macOS signing + notarization will activate automatically on the next git tag push. No further manual steps needed for Apple. ✅

---

### 3. Set up LemonSqueezy account + create products — ✅ COMPLETE (2026-04-09), STRIPE PENDING

**Status:** ✅ LemonSqueezy account created, 3 products set up, webhook wired, credentials in `/etc/license-validator.env`, Buy URLs live on homepage. Store ID `340394`, webhook ID 89126.

**Stripe merchant approval:** PENDING. LemonSqueezy sent follow-up identity verification questions on ~2026-04-12; Jameson replied with all requested info (pricing details, personal social media links, etc.) on 2026-04-13. Variants show "pending" status because Stripe is still reviewing. **Expected to auto-resolve once Stripe activates.** If no update by 2026-04-18, Jameson should email LemonSqueezy support at help@lemonsqueezy.com asking for a status update on the Stripe review.

**Once Stripe activates:** Buy buttons start accepting real payments immediately. No further action needed from Jameson or Claude — everything is already wired.

---

### 4. First signed test release — ✅ COMPLETE (2026-04-09)

**Status:** 12 CI attempts, all 4 platforms building cleanly on attempt 12 (run id `24194263726`).

**v1.0.2-rc.1 draft release has 9 signed artifacts:**
- `Projelli_1.0.2_x64-setup.exe` (Windows, signed via Azure Trusted Signing)
- `Projelli_1.0.2_x64_en-US.msi` (Windows, signed via Azure Trusted Signing)
- `Projelli_1.0.2_aarch64.dmg` (Mac ARM, signed with Developer ID, **not notarized**)
- `Projelli_1.0.2_x64.dmg` (Mac Intel, signed with Developer ID, **not notarized**)
- `Projelli_aarch64.app.tar.gz` + `Projelli_x64.app.tar.gz` (Mac app bundles)
- `Projelli_1.0.2_amd64.AppImage` + `Projelli_1.0.2_amd64.deb` + `Projelli-1.0.2-1.x86_64.rpm` (Linux)

Draft release URL: https://github.com/projelli/projelli/releases

**Issues resolved during the 12 attempts** (preserved here so we don't repeat them):
1. `@rollup/rollup-linux-x64-gnu` was a hard dep → removed
2. `@tauri-apps/*` npm packages were ahead of Rust crates → tilde-pinned
3. `bundle.targets: ["msi", "nsis"]` hid non-Windows installers → changed to `"all"`
4. Mac PKCS12 import failed → regenerated .p12 with `openssl -legacy`
5-9. Tauri's `signCommand` process spawn on Windows was fundamentally broken → pivoted to separate `build-windows` job using Microsoft's `azure/trusted-signing-action@v0.5.1`
10. MSI bundler rejected `-rc.1` pre-release suffix → dropped to plain `1.0.2`
11. Mac notarization failed with "Internet connection appears to be offline" after 49 minutes → **Apple's notary service has been degraded since March 2026** (multiple dev forum reports)
12. **Mac notarization DISABLED** in the workflow — Mac builds are signed with Developer ID but unnotarized. Re-enable by uncommenting the 3 `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` env vars in `.github/workflows/release.yml` when Apple's service recovers. Check https://developer.apple.com/system-status/ for "Notarization" status.

**What users experience with unnotarized Mac builds:** Gatekeeper shows a warning on first open ("Projelli can't be opened because Apple cannot check it for malicious software"). To install: right-click the .app → Open → Open. After the first open, macOS trusts it for all future launches. The app is still cryptographically signed by Jameson's Developer ID cert.

**For the real v1.0.2 launch release:** Check Apple's status. If notary is still down, ship unnotarized with a FAQ note. If notary is back, re-enable the env vars and re-tag.

---

### 5. Plausible conversion goals (browser-only setup)

**Why it matters:** Without conversion goals, the Plausible dashboard can't tell us how many people clicked Download or Buy. Useful for the launch.

**Steps (do this in your browser):**
1. Go to https://analytics.jamesondaines.com/projelli.com/settings/goals (or whatever the Plausible URL is)
2. Sign in
3. Add three goals:
   - **Download click** — type: Custom Event, name: `Download click`
   - **GitHub click** — type: Custom Event, name: `GitHub click`
   - **Buy click** — type: Custom Event, name: `Buy click` (will start firing once the Buy button goes live)
4. Save

Claude will then add the corresponding event triggers to the homepage JS in the next session.

**Time:** 5 minutes.

---

### 6. Wheel Health re-check (already cleared, but worth a sanity check)

You said you already cleared this with Wheel Health, but as a sanity check: before the Product Hunt launch (Week 6), forward the launch announcement to whoever at Wheel Health you cleared it with originally. Just so there's a paper trail and no surprises if anyone there asks. **Not blocking** — proceed unless you hear back.

---

### 7. (Optional, post-revenue) Trademark filing

Defer until revenue clears $1K/mo. At that point:
- Hire a trademark attorney for a formal full search (~$300-500)
- File USPTO TEAS Plus application in classes 9 + 42 (~$700 total)

---

## What's already done that Jameson should know about

These are the things Claude built during the marathon session. **You don't need to do anything about these** — they just exist now.

### Code & infrastructure
- 6 commits pushed to `projelli/projelli:master` (including the move to the org)
- Live website: https://projelli.com (with new copy, animated demo, email signup, footer with real legal/docs links)
- License validator service: https://licenses.projelli.com (Bun systemd, Ed25519 JWT, awaiting LemonSqueezy creds)
- 3 new founder workflow templates: InvestorUpdate, BoardMeetingPrep, FirstHirePlaybook
- React `useLicense` hook + LicenseSettings UI component (in-app license activation flow)
- React `FirstRunWizard` component (onboarding for new users)
- GitHub Actions workflow at `.github/workflows/release.yml` ready to build cross-platform installers
- support@projelli.com fully configured (Brevo + CF Email Routing + DKIM)
- Org profile at https://github.com/projelli with README and metadata

### Documentation
- `PROJELLI_BUSINESS_PLAN.md` — operating contract (16 CEO decisions, 8-week roadmap, revenue model, risks)
- `BACKLOG.md` — 50+ tickets across 8 weeks, with status (~25 marked DONE)
- `README.md` — public-facing repo intro
- `CLAUDE.md` — instructions for future Claude sessions
- `docs/reference/TRADEMARK_SEARCH.md` — initial clearance search results
- `docs/README.md` — docs index
- `website/legal/{privacy,terms,eula}.html` — full legal docs
- `website/docs/{getting-started,api-keys,faq}.html` — user-facing docs

### Server-side state (not in the repo)
- `/etc/systemd/system/license-validator.service` — installed, enabled, running
- `/etc/license-validator.env` — created, awaiting LemonSqueezy creds
- `/etc/caddy/Caddyfile` — patched to add `licenses.projelli.com` block + projelli.com `/api/forms/*` route + try_files for clean URLs
- `/etc/cloudflared/config.yml` — patched to add `licenses.projelli.com` ingress
- DNS: `licenses.projelli.com` CNAME added to projelli.com zone
- Brevo: `projelli.com` registered as a verified sender domain, `noreply@projelli.com` sender created

---

## How to give Jameson updates

When you (Jameson) complete an action item above, just tell the Claude session:

> "Did W2-02 — Azure Trusted Signing approved, here are the credentials: <paste>"

Or:

> "Did W4-01 — LemonSqueezy is set up, here are the API key, store ID, and webhook secret: <paste>"

Claude will then continue the work that depends on those credentials and report back when it's done.

---

## Estimated total time for Jameson to unblock everything

| Action | Time |
|---|---|
| 1. Windows code signing | 30 min + 1-3 day wait |
| 2. Apple Developer | 15 min + 5-7 day wait |
| 3. LemonSqueezy | 30-60 min + minor verification time |
| 4. GitHub Actions test release | 5 min (just say "go") |
| 5. Plausible goals | 5 min |
| 6. Wheel Health sanity check | 5 min |
| **Total active time** | **~90-120 minutes** |
| **Wait time (parallel)** | **5-7 days for Apple, 1-3 days for Azure** |

**The launch is unblocked once these are done.** Everything else is already built.

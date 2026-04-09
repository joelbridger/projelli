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

### 3. Set up LemonSqueezy account + create products

**Why it matters:** This is what actually takes money. Until LemonSqueezy is set up, the Buy button on the website can't go live.

**Steps:**
1. Go to https://www.lemonsqueezy.com/ → Sign up
2. Complete the merchant onboarding (business name, tax info, bank account for payouts)
   - You can set this up as an individual sole proprietor — no LLC required for v1
   - LemonSqueezy is the merchant of record, so they handle VAT/sales tax for you
3. Create a Store called "Projelli"
4. Create 3 products:
   - **"Projelli Pro"** — One-time, $49 USD. Description: "All AI providers, all 15 templates, unlimited workspaces. 1 year of updates."
   - **"Projelli Lifetime"** — One-time, $99 USD. Description: "Everything in Pro + updates forever + commercial use license."
   - **"Projelli Founder's Launch"** — One-time, $29 USD. Same as Lifetime but with a quantity cap of 100. Description: "Lifetime tier at the launch price. First 100 buyers only."
5. For each product, enable **License Keys** (Settings → License Keys → enable, set activation limit to 3 devices per key)
6. Get your API key: Settings → API → Create API Key → copy it
7. Get your Store ID: visible in the URL of your store
8. Set up a webhook: Settings → Webhooks → Add webhook
   - URL: `https://licenses.projelli.com/webhook`
   - Events: `subscription_cancelled`, `order_refunded`, `license_key_updated`
   - Copy the webhook signing secret
9. Send Claude: API key, store ID, webhook secret, and the 3 product Buy URLs (you'll get these from each product's "Share" button)

Once Jameson sends the credentials, Claude will:
- Set them in `/etc/license-validator.env` and restart the service
- Update the homepage Pricing section to point at the real Buy URLs
- Test the full money flow end-to-end with a $0 test product (LemonSqueezy supports this)

**Time:** 30-60 min for the setup + identity verification.
**Spend:** $0 to set up. LemonSqueezy takes ~5% per sale.

---

### 4. Trigger the first GitHub Actions release

**Why it matters:** The CI workflow is in `.github/workflows/release.yml` but hasn't been run yet. Pushing a tag triggers a full Win+Mac+Linux build. The first run will probably reveal small issues (missing config, etc.) that need fixing — better to find them now.

**Steps:**
1. From this Claude session, ask Claude to push a test tag:
   ```
   tag a test release v1.0.2-test and watch the actions
   ```
2. Claude will run `git tag v1.0.2-test && git push origin v1.0.2-test` and then monitor the Actions run via `gh run list` and `gh run view`
3. If anything fails, Claude diagnoses and fixes
4. Once a clean test build runs, the tag can be deleted and a real `v1.0.2` tag created

This requires no Jameson hands at all — just authorization to do it. Claude is waiting on Jameson to say "do the test release."

**Time:** ~5 minutes of Jameson saying yes; ~30 minutes of Claude work to debug whatever the first run reveals.

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

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

### 1. Procure Windows code signing certificate (~$10/mo or $160/yr)

**Why it matters:** Without this, the Windows installer triggers SmartScreen warnings on every install. Conversion drops massively. This is #1 because it blocks shipping a sellable Windows release.

**Path A (recommended): Azure Trusted Signing — ~$10/month**
1. Go to https://azure.microsoft.com/en-us/products/trusted-signing
2. Sign up for an Azure account if you don't have one (free trial available, no charge for the first year on most services)
3. Enable Trusted Signing
4. Verify your identity (Microsoft does the OV verification for you — typically 1-3 business days)
5. Once approved, you'll get a signing endpoint + credentials
6. Send the credentials to Claude — Claude will wire them into the GitHub Actions workflow

**Path B (fallback): SSL.com OV cert — ~$160/year**
1. Go to https://www.ssl.com/certificates/microsoft-authenticode/
2. Buy a 1-year OV (Organization Validation) Authenticode cert (~$160-200)
3. Complete the OV verification (proof of identity, organization documents)
4. Download the .pfx file and password
5. Send both to Claude

**Time:** 30 min for the application + 1-3 business days for verification.
**Spend:** $10/mo (Azure) or $160/yr (SSL.com). Both within the approved budget.

---

### 2. Apple Developer Program enrollment ($99/year)

**Why it matters:** Required for macOS builds. Without it, the Mac app triggers Gatekeeper warnings on first run. This is #2 because Mac users are 70%+ of indie hackers.

**Steps:**
1. Go to https://developer.apple.com/programs/enroll/
2. Sign in with your Apple ID (or create one)
3. Choose "Individual" enrollment (not "Organization" — much faster)
4. Pay $99
5. Apple verifies your identity (typically 5-7 business days)
6. Once approved, send Claude:
   - Your Team ID
   - An app-specific password (https://appleid.apple.com/account/manage → App-Specific Passwords)
   - Generate a Developer ID Application certificate via Xcode or developer.apple.com/account/resources/certificates
   - Export the cert as a .p12 file with a password
   - Send the .p12 + password to Claude

Claude will then wire the macOS signing + notarization into the GitHub Actions workflow.

**Time:** 15 min for the application + 5-7 days for approval.
**Spend:** $99/yr. Within the approved budget.

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

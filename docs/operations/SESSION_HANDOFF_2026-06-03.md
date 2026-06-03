# Session Handoff: 2026-06-03

> **READ FIRST.** Supersedes `SESSION_HANDOFF_2026-06-02.md`. Full memory: `~/.claude/projects/-home-jameson/memory/project_keepance_v2_1_release.md`.

---

## TL;DR

The site and download flow are fully overhauled. v2.1.3 is built and almost published — Intel Mac had a transient network error on the first run; a rerun is in progress (CI run 26910191623, queued ~2026-06-03T21:27Z, ~60 min). **The product and infrastructure are ready. The only thing that moves the needle is Jameson approving the 7 reviewer drafts at `crm.jameworld.com`.** Nothing I can do unblocks that.

**Operating directives (unchanged):**
- **No autonomous public posting.** Jameson posts from his accounts.
- **No autonomous app release** without explicit go.
- **Never change LS store slug** (`projelli`).
- **Never remove** `LEMONSQUEEZY_API_KEY` or `LEMONSQUEEZY_API_KEY_2` from the validator env.
- **CRM sends are gated.** All cold outreach queues as drafts at `crm.jameworld.com` for approval. `--auto` only for cleared flows.

---

## DONE this session (2026-06-03)

### Download flow — complete overhaul

**Problem:** The free trial button was bolted onto the Personal pricing card with inline CSS — misaligned, too long, linked to the GitHub releases page (no direct installer). macOS and Linux users had no download path at all.

**What shipped:**
- **`/download/` page** created (`website/download/index.html`): 3-platform card grid (Windows/macOS/Linux), OS auto-detection highlights + swaps ARM/Intel Mac on the fly, Intel Mac and RPM alt links, 3-step "After you install" guide, footer. Uses `keepance-nav.v4.js` for nav injection (same as all other subpages).
- **Homepage consolidated:** All download CTAs (hero button, nav CTAs, trial-banner) now link to `/download/`. The 4-platform inline pill section was removed entirely. Single canonical download path; version URLs live in one file only.
- **SmartScreen guidance added:** `/download/` has an amber callout box explaining the Windows reputation system, the exact 2-step bypass ("More info → Run anyway"), and that the publisher name is real/verifiable. Homepage trial-banner has a one-line Windows note.
- **Practice card cleaned:** Redundant "Download free trial →" link removed from Practice card footer.

**Research backing (102-agent deep research run, adversarially verified):**
- EV certs no longer bypass SmartScreen (since 2024 — don't buy one).
- Azure Artifact Signing = identical to OV, no accelerated reputation.
- macOS is fine: Keepance is notarized, Gatekeeper friction is minimal.
- SmartScreen clears on its own as downloads accumulate (weeks + hundreds of installs). Communication is the only fix.

### v2.1.3 — brand polish app release (CI in progress)

**What changed in the app:**
- **App icons:** All Tauri icon assets (`icon.png`, `icon.ico`, `icon.icns`, all size variants) regenerated from the Keepance shield PNG. The jellybean from Projelli was still showing in Windows taskbar, title bar, and installer.
- **Accent color:** `hsl(6 100% 72%)` coral → `hsl(210 73% 15%)` navy (`#0A2540`) in both light and dark mode (`src/styles/globals.css`). All primary buttons, focus rings, highlights.
- **Tour step 4:** "Pricing Strategy, Competitor Analysis, Weekly Review" → "Client Intake, Matter Summary, Weekly Client Update" — now reflects the actual ICP.

**Build status:**
- Run `26910191623` (the rerun after RGBA fix):
  - ✅ Windows
  - ✅ Linux (ubuntu-22.04)
  - ✅ macOS ARM (aarch64)
  - ⏳ macOS Intel (x86_64) — **RERUN IN PROGRESS** (transient curl HTTP/2 error on crates.io, not a code issue, first rerun queued)
- First build attempt failed because ImageMagick stripped alpha channel on small PNGs. Fixed with `-type TrueColorAlpha -define png:color-type=6`. All PNG icons verified RGBA via Pillow.
- **Do NOT update `/download/` page URLs to v2.1.3 until ALL 4 platform assets are confirmed in the GitHub release.** Check: `gh release view v2.1.3 --repo keepance/keepance --json assets`.

---

## PENDING — priority order

### 1. Jameson: approve reviewer drafts at `crm.jameworld.com` (HIGHEST LEVERAGE)
Drafts #8-14 have been queued since yesterday. 3 legal (Elefant, Jennifer Case, Sharon Nelson), 2 tax (Wells, Tankersley), 2 advisor (Derek Tharp/Kitces, Emma Foulkes). Domain warming: approve 2-3 per day, not all at once. **This is the only action that matters right now.** A single "yes" from one reviewer → named testimonial → social proof → every other channel opens.

### 2. Jameson: founder bio verification
"Eight years at Samsung, AstraZeneca, Tesla, University College London" is live on homepage + press kit, unverified. A lawyer reviewing the outreach will Google it before responding. Verify → update copy to match.

### 3. Me: update `/download/` page URLs once v2.1.3 Intel Mac build lands
Check CI run `26910191623` status: `gh run watch 26910191623 --repo keepance/keepance`. When all 4 pass: `gh release view v2.1.3 --repo keepance/keepance --json assets` to confirm asset names, then sed-update `website/download/index.html` (4 URLs + 1 version string), deploy, commit.

### 4. Me: add SmartScreen note to CRM post-purchase email template
The reviewer-attorney/cpa/advisor-cold templates don't mention the Windows prompt. The purchase receipt email (if it exists) should say: "Windows will show a security prompt the first time — click 'More info' then 'Run anyway'." Short, reassuring, before they hit it.

### 5. Jameson: CI Node.js 20 deprecation (June 16 deadline)
GitHub Actions is forcing Node.js 24 on June 16. The `release.yml` uses `actions/checkout@v4`, `actions/setup-node@v4`, `actions/cache@v4` — all currently running on Node.js 20. Need to pin these to Node.js 24-compatible versions (typically `@v4` or `@v5` depending on the action). Low urgency until June 10, then becomes a build blocker. I can fix this autonomously anytime.

### 6. Warm contacts
Any personal contacts Jameson can send — even non-ICP — I'll queue warm outreach drafts.

---

## Key IDs / quick reference (unchanged)

- LS store: `#340394` (slug: `projelli`, display: "Keepance")
- Products: Personal `1101937`, Professional `1101955`, Practice `1101967`
- Checkout URLs: Personal `4df43939`, Professional `78ee592e`, Practice `b4c6865f`
- Founding discount: `FOUNDING` code on Professional → $99/yr (100-redemption cap)
- Validator: `https://licenses.projelli.com/webhook` (port 5181), two API keys in `/etc/license-validator.env`
- Live webhook: `106297` (test_mode:false, 9 events)
- CRM: port 5191, `crm.jameworld.com`, sender `jameson@keepance.com` (sender id 89)
- Pending reviewer drafts: #8-14 at `crm.jameworld.com`
- v2.1.3 CI rerun: `gh run watch 26910191623 --repo keepance/keepance`

---

## Never
- No autonomous app release or `infra/deploy.sh` without explicit go.
- Never change LS store slug (`projelli`).
- Never remove either LEMONSQUEEZY_API_KEY or _2 from the validator env.
- Never send a cold CRM email without Jameson approving the draft.
- No autonomous public posting.

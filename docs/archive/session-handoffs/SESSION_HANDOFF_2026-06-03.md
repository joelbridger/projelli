# Session Handoff: 2026-06-03

> **READ FIRST.** Supersedes `SESSION_HANDOFF_2026-06-02.md`. Full memory: `~/.claude/projects/-home-jameson/memory/project_keepance_v2_1_release.md`.

---

## TL;DR

v2.1.3 is shipped (all 4 platforms live; download flow + SmartScreen guidance done). **DIRECTIVE CHANGE 2026-06-03:** Jameson commissioned a full **V2 overhaul** of the website and software and ordered **no outreach of any kind until the entire overhaul is complete and verified to a "perfect" bar.** Reviewer drafts are paused; do not raise them as a priority. Governing docs: `docs/strategy/2026-06-03-vertical-persona-audit.md` and `docs/strategy/2026-06-03-keepance-v2-overhaul.md` (definition of done). Locked decisions: BYOK stays (no managed key); the advisor pack is a committed build (4th vertical); zero users today.

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
- macOS is fine: Advisor Prep Hero is notarized, Gatekeeper friction is minimal.
- SmartScreen clears on its own as downloads accumulate (weeks + hundreds of installs). Communication is the only fix.

### v2.1.3 — brand polish app release (CI in progress)

**What changed in the app:**
- **App icons:** All Tauri icon assets (`icon.png`, `icon.ico`, `icon.icns`, all size variants) regenerated from the Advisor Prep Hero shield PNG. The jellybean from Projelli was still showing in Windows taskbar, title bar, and installer.
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

### 1. Build the V2 overhaul (the ONLY priority until done)
All outreach is paused by Jameson's direction until the website and software are overhauled to a "perfect" bar. Work the 11 workstreams in `docs/strategy/2026-06-03-keepance-v2-overhaul.md` (Phase 0 first). **Do not raise reviewer-draft approval** (drafts #8-14 stay queued, untouched, at crm.jameworld.com) until the overhaul is complete and verified. Greenlit workstreams run subagent-driven; commercial deploy/release stays gated on Jameson's explicit go.

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

- LS store: `#340394` (slug: `projelli`, display: "Advisor Prep Hero")
- Products: Personal `1101937`, Professional `1101955`, Practice `1101967`
- Checkout URLs: Personal `4df43939`, Professional `78ee592e`, Practice `b4c6865f`
- Founding discount: `FOUNDING` code on Professional → $99/yr (100-redemption cap)
- Validator: `https://licenses.projelli.com/webhook` (port 5181), two API keys in `/etc/license-validator.env`
- Live webhook: `106297` (test_mode:false, 9 events)
- CRM: port 5191, `crm.jameworld.com`, sender `jameson@keepance.com` (sender id 89)
- Pending reviewer drafts: #8-14 at `crm.jameworld.com`
- v2.1.3 CI rerun: `gh run watch 26910191623 --repo keepance/keepance`

---

## V2 Overhaul — audit + proposal written (awaiting greenlight)

On 2026-06-03 a full vertical-persona audit and a systematic V2 overhaul proposal were written. Two docs, cross-linked:
- `docs/strategy/2026-06-03-vertical-persona-audit.md` — site + app reviewed as 5 practitioner lenses (general attorney, patent attorney, CPA/EA, consultant, RIA). Core diagnosis: "a developer-grade tool wearing a professional's suit." Most issues are communication/unsurfaced capability, not missing capability.
- `docs/strategy/2026-06-03-keepance-v2-overhaul.md` — 11 workstreams (A–K), phased roadmap (Phase 0 = pre-reviewer-scale, mostly cheap/high-trust copy + 2 existential surfacing fixes), traceability matrix proving every finding is covered.

**Status:** proposal only, nothing built or deployed. Awaiting Jameson's direction on: (1) managed-key question [recommend keep BYOK], (2) advisor pack go/no-go [recommend message-only now], (3) whether to complete Phase 0 before scaling reviewer outreach [recommended]. Execution, when greenlit, defaults to subagent-driven; commercial deploy/release stays gated.

## Never
- No autonomous app release or `infra/deploy.sh` without explicit go.
- Never change LS store slug (`projelli`).
- Never remove either LEMONSQUEEZY_API_KEY or _2 from the validator env.
- Never send a cold CRM email without Jameson approving the draft.
- No autonomous public posting.

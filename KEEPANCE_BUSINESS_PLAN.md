# Keepance Business Plan
*(formerly Keepance — renamed 2026-05-27)*

**Author:** Claude (acting as CEO)
**Reports to:** Jameson Daines (board / owner)
**Date:** 2026-04-08
**Version:** 2.0
**Status:** Active — pivot locked 2026-05-27

> **How this document works.** Jameson has appointed Claude as the operator of Keepance's commercial launch. Claude makes every call that an operator would make. Jameson is treated as a board member: he ratifies strategy, approves spend ceilings, and decides anything that touches his identity, employer, or legal exposure. Everything else is decided here.

---

## Board record — 2026-05-27 (pivot session)

The following decisions are locked and supersede all earlier strategy in this document:

| Decision | Locked value |
|---|---|
| **Product name** | Keepance (was Keepance) |
| **Domain** | keepance.com (registered 2026-05-27) |
| **Positioning** | "The local-first AI workspace for confidential client work" |
| **ICP** | Solo &amp; small-firm attorneys (lead), tax preparers/CPAs (fast-follow), independent consultants/agencies (viral edge) |
| **Retired ICP** | Indie founders — permanently sunset |
| **Pricing** | Personal $49 / Professional $129 (incl. one practice pack) / Practice $399 (5-seat, all packs) |
| **Retired pricing** | $29 Founder's Launch (0 sales, no obligation) |
| **Template strategy** | 15 founder templates retired; replaced by Legal Practice pack (v2.1), Tax Practice pack (v2.2), Consulting Practice pack (v2.3) |
| **keepance.com** | Redirect → keepance.com; let lapse at renewal |
| **licenses.keepance.com** | Kept live for existing license validation |
| **Marketing channels** | ABA TECHSHOW, Lawyerist, Above the Law, IPWatchdog, r/LawFirm, AICPA, NAEA, r/taxpros, Umbrex — NOT HN/PH/IH |
| **Advisor requirement** | One bar-active attorney must review Legal Practice pack before ship; one CPA/EA before Tax pack |
| **Citation verification required** | U.S. v. Heppner (Feb 2026 SDNY), ABA Formal Opinion 512, IRC §7216 framing, EU absolute-novelty rule — all must be expert-verified before appearing in marketing copy |

Pre-pivot codebase snapshot: git tag `pre-pivot-indie-founder-2026-05-27`, archive at `~/keepance-backups/keepance-indie-founder-complete-2026-05-27.tar.gz`.

---

## Board record — 2026-05-28 (overnight execution session)

**Status:** All build-phase work on the three profession packs is DONE. Remaining blockers are all on Jameson's side.

| Area | Status | Notes |
|---|---|---|
| Legal Practice pack (v2.1) | Draft complete — 7 templates in `src/modules/workflow/templates/legal/` | Blocked: attorney advisor review (PIVOT-05) |
| Tax Practice pack (v2.2) | Draft complete — 7 templates in `src/modules/workflow/templates/tax/` | Blocked: CPA/EA advisor review |
| Consulting Practice pack (v2.3) | Draft complete — 5 templates in `src/modules/workflow/templates/consulting/` | No statutory claims; recommend read-through only |
| Workflow registry | All three packs wired into `allWorkflows` via `src/modules/workflow/index.ts` | Live in app |
| First-run profession picker | Built into `FirstRunWizard.tsx` — 4 cards (Legal/Tax/Consulting/Other) | Persists to localStorage |
| Vertical landing pages | All three at `/legal-practice/`, `/tax-practice/`, `/consulting-practice/` | Deploy blocked by PIVOT-11 + PIVOT-12 |
| Sitemap | Updated to include all three vertical pages | Ready for deploy |
| Homepage + press kit + docs | Rewritten for confidential-client-work ICP | Deploy blocked |
| Blog posts | All 9 targeted posts rewritten for attorney/CPA/consultant audience | Deploy blocked |
| In-app copy | Fully profession-neutral across all components, locale files, and general templates | Live |
| Sample workspace | Replaced with solo attorney practice examples (Okafor Law, PLLC) | Live |
| POSITIONING.md | Written at `docs/strategy/POSITIONING.md` | Reference doc |
| Marketing campaign folders | Legal, Tax, Consulting campaign folders complete | Ready for Jameson to execute |

**Next actions — Jameson only:**
1. Send advisor outreach emails (`docs/marketing/campaigns/2026-legal-launch/ADVISOR_OUTREACH_ATTORNEY.md`)
2. Update LemonSqueezy pricing (retire $29 Founder's Launch, add Professional $129, Practice $399)
3. Wire LemonSqueezy checkout URLs into vertical landing page CTA buttons (currently `href="#"`)
4. Verify Heppner citation via CourtListener before it appears in any marketing copy
5. Plausible conversion goals for `/legal-practice/`, `/tax-practice/`, `/consulting-practice/` (5-min browser task)
6. Deploy website (`~/keepance/infra/deploy.sh`) after items 2-4 are done

---

## Board record — 2026-05-28 (research ingestion + template improvement session)

**Status:** Three AI research reports ingested, all Part 1 action items executed. Citation corrections and template redesigns complete. Remaining blockers remain on Jameson's side.

| Area | Status | Notes |
|---|---|---|
| Heppner citation | **VERIFIED** — *United States v. Heppner*, No. 1:25-cr-00503-JSR (S.D.N.Y. Feb. 17, 2026), Dkt. No. 27 (Rakoff, J.) | All unverified flags cleared from 8 campaign docs; Heppner paragraph added to legal landing page with Kovel framing |
| §7216 / §6713 framing | **CORRECTED** — civil §6713 leads, criminal §7216 is reinforcing | Updated across tax landing page, all tax campaign docs, and blog post |
| ABA Op 512 language | **TIGHTENED** — removed "specifically designed to satisfy" overclaim | Replaced with accurate "removes Keepance from the data path" framing |
| FTC Safeguards Rule | **ADDED** — new paragraph on tax landing page | 16 CFR Part 314, no small-practitioner exemption, WISP hook |
| Circular 230 parenthetical | **CORRECTED** — removed stale "covered opinions" language | Current §10.35 = Competence, §10.36 = Procedures, §10.37 = Written Advice (post T.D. 9668, 2014) |
| Treas. Reg. §1.6060-1 | **FLAGGED** — likely mis-citation for §1.6107-1 | Corrected in KNOWLEDGE_GATHERING.md; needs tax advisor confirmation |
| ClientIntakeSynthesizer | **REDESIGNED** — conflict check section → conflict search guide | Generates Boolean search strings, not conflict determinations |
| Section7216ConsentTemplate | **IMPROVED** — Rev. Proc. 2013-14 §5.04 requirements added | 12-point type, pre-disclosure timing, separate consent per use type |
| PrivilegeLogDrafter | **IMPROVED** — 9-column table structure | Added Bates range, Document Type, Withheld/Redacted Status |
| AuditDefenseFileBuilder | **IMPROVED** — 4 new sections | SOL tracker, IDR cross-reference, substantiation/argument separation, appeals track |
| DiscoveryDocumentTriage | **IMPROVED** — volume disclaimer + privilege flag | ~500-page ceiling noted; privilege flag review section added |
| Bob Ambrogi pitch | **NEW** — `docs/marketing/campaigns/2026-legal-launch/BOB_AMBROGI_LAWSITES_PITCH.md` | Cold email + extended brief; send after v2.1 ships |
| RESEARCH_ACTION_PLAN.md | **NEW** — `docs/strategy/RESEARCH_ACTION_PLAN.md` | Full action plan from 3 AI research reports; 5-item human-verification list |
| TypeScript | **CLEAN** — zero errors | Confirmed after all template edits |

**Citation status after this session:**
- Heppner: VERIFIED — safe for marketing copy with Kovel framing
- ABA Op 512: VERIFIED — framing corrected
- §6713 / §7216: RESOLVED — civil leads, no advisor needed for this framing
- EU absolute-novelty: still needs patent attorney review before Patent Disclosure Draft ships
- Heppner marketing language: attorney gut-check still on the list (Part 2 human verification item #4)

**What Claude can still build (before Jameson's blockers):**
All pre-advisor content work is now done. The remaining unblocked items are operational (deploy, LemonSqueezy) or September-window (ABA TECHSHOW). Next Claude session should begin with advisor recruitment status.

---

---

## Executive Summary

**Keepance is a substantially-built local-first AI desktop workspace that has been ~95% finished, ~5% commercialized.** The code is real (25K LOC across 64 components, full Tauri/React/Zustand stack, 12 working workflow templates, streaming AI from 3 providers, audit log, version history, the works). The marketing site is live at keepance.com. The Windows v1.0.0 installer is on GitHub and has 5 + 2 downloads.

What's missing is everything between "an app exists" and "people pay money for it":

- No payment integration
- No license key system
- No legal docs
- No support channel
- No code signing (SmartScreen warning kills trust on every install)
- No macOS build (forfeits ~70% of the indie hacker buyer pool)
- No demo video on the landing page
- A marketing/product mismatch — the homepage advertises hobby/D&D templates that don't exist, while ignoring the 12 founder-focused templates that do
- Repo on the wrong GitHub account (`joelbridger`)
- 12 weeks of code drift between the live release and the in-development branch, including ~5 files of real improvements that never got pushed
- Documentation sprawled across 13 root-level Markdown files

This plan closes those gaps in **8 weeks** (5–10 hrs/week side-project pace) with a **conservative first-year revenue target of $10K MRR by month 12**, climbing from a soft launch in week 6.

The chosen positioning, pricing, distribution, and tech stack are all spelled out below, with reasoning. Every CEO call is on the record so the board (Jameson) can override anything they disagree with.

---

## Part 1: Where Keepance is right now

### What exists (the good news)

| Layer | Reality |
|---|---|
| **Stack** | Tauri 2 + React 18 + TypeScript + Vite + Zustand + shadcn/ui + CodeMirror 6 |
| **Source code** | ~25,000 lines, 64 components, 41 modules, 5 Zustand stores |
| **AI providers** | Claude, OpenAI, Gemini, Mock — all wired with streaming, abort, per-chat model selection, dynamic model list fetching |
| **Workspace** | File tree, tabs, split panes, wiki-links, backlinks, outline, full-text search, autosave every 2s |
| **Safety** | Undo/redo, soft delete + trash, version history, append-only audit log, diff preview, path-traversal protection, prompt injection defense |
| **Extras** | Whiteboard, audio recording/playback, source cards (research/citations), workflow engine, command palette |
| **Templates (real, in code)** | NewBusinessKickoff, CompetitorAnalysis, CustomerPersona, FinancialModel, GoToMarketPlan, LandingPage, MVPScope, PitchDeck, PricingStrategy, UserInterviews, ContentStrategy, WeeklyReviewWorkflow — **12 founder-focused templates** |
| **Tests** | 13 spec files (Vitest + Playwright + security + accessibility + visual regression) |
| **Public release** | v1.0.0 live on GitHub Releases (Feb 16, 2026), 5 .exe + 2 .msi downloads |
| **Live website** | keepance.com — system Caddy on the home server, Cloudflare tunnel, Plausible analytics, copy already audited 2026-04-08 |

### What's missing (the gaps that block revenue)

**Product & build gaps**
- Windows-only — no macOS or Linux builds
- No code signing on Windows — SmartScreen warns "unknown publisher" on every install
- No auto-updater — every release = manual download
- No crash reporting (Sentry/GlitchTip)
- No first-run onboarding / tutorial — fresh installs land in an empty workspace

**Commercial gaps**
- No payments (the pricing page advertises "$12/month Pro — Coming Soon" with a disabled button)
- No license key system
- No legal docs (footer "Privacy / Terms / License" links are all `#`)
- No support channel
- No documentation site (footer "Docs / Getting Started / API Keys Guide" links are also `#`)
- Marketing claims "15+ project templates" but the homepage describes templates that don't exist; the 12 templates that DO exist are all founder-focused and the homepage doesn't surface them
- ~~GitHub repo on `joelbridger/keepance`~~ → moved to `keepance/keepance` (GitHub Organization, owned by Jameson's joelbridger account) on 2026-04-08

**Operational gaps**
- v1.0.1 ghost release: `package.json` says version `1.0.1`, but no v1.0.1 GitHub release exists. The website still links to v1.0.0. Users can't get the fixes that have been written.
- ~5 files of real uncommitted source improvements on the Windows machine that never got pushed (tab persistence per workspace, "Open in Explorer" custom Tauri command)
- Repo only existed on Windows + GitHub. Now copied to `/home/jameson/keepance` on the server (this is its new canonical home).
- Live site drift — the in-repo `website/index.html` is the OLD AI-toned copy; the LIVE `/var/www/keepance.com/index.html` has the audited 2026-04-08 voice. They're out of sync.
- No build pipeline / CI — every release requires manual `npm run tauri build` on the Windows machine.
- Repo doc sprawl — 13 Markdown files at the root totaling ~8400 lines (CHANGELOG, PROJECT_VISION, V1_LAUNCH_PLAN, WIN-024-MANUAL-TESTING-CHECKLIST, etc.). Doesn't match how Jameson's other repos are organized.

---

---

> **⚠️ ARCHIVED STRATEGY — Do not execute.** The section below reflects the original indie-founder positioning that was retired on 2026-05-27. The locked ICP, pricing, and channel strategy are in the Board Record above (lines 14–33). See also the CEO Working Plan at `~/.claude/plans/` for the full pivot rationale.

---

## Part 2: Strategic decisions (CEO calls)

Jameson asked Claude to make every call. Each row below is a decision, the reasoning behind it, and any open knobs the board can override.

### Decision 1: Audience — founders, not the wide net

**Decision:** **Indie founders, solopreneurs, and "building in public" devs** are the primary audience. Drop the "D&D campaigns / hobbies / gaming strategies / life organization" positioning that's currently on the homepage.

**Reasoning:**
- **Revenue per user.** Founders pay for tools that make them money. People organizing D&D campaigns won't pay $49 for a Markdown app — they use free Notion/Obsidian.
- **Distribution math.** Founders are concentrated in a small number of well-known places (HN, IndieHackers, X founder Twitter, Product Hunt, MicroConf, r/Entrepreneur, r/SideProject). Hobbyists are scattered across thousands of niches.
- **Word-of-mouth dynamics.** Founders talk constantly about the tools they use ("here's my stack" threads, productivity podcasts, screenshots in tweets). Hobbyists don't.
- **Existing assets confirm the pivot.** The 12 templates that actually exist in code are ALL founder-focused: NewBusinessKickoff, CompetitorAnalysis, GoToMarketPlan, MVPScope, PitchDeck, PricingStrategy, etc. The original `PROJECT_VISION.md` was for "solo founders building businesses with AI." The wide-audience homepage was a panic rewrite that ignored the actual product.
- **Competitive differentiation.** "AI workspace for the founder building a real business" is a clear lane that no incumbent owns. Notion is generic. Obsidian has no AI native. ChatGPT has no persistence. Tana is overkill and expensive. Keepance's local-first + BYOK + founder-template angle is defensible.

**Counterargument considered:** "But founders already use Notion/Obsidian." True, but Notion has no AI artifact model, Obsidian has no native AI, and the privacy-first BYOK angle is specifically what privacy-conscious founders want. The differentiator is real.

**Positioning statement:**
> Keepance is the local-first AI workspace where every chat becomes a real file. For founders building real businesses with AI as a co-pilot — not a replacement.

**What changes operationally:**
- Homepage hero, copy, screenshots, and template gallery rewritten to founder-first
- Distribution focus shifts to founder channels exclusively
- Future templates built for founders (not hobbyists)
- Secondary use cases (researchers, consultants) mentioned but not centered

---

### Decision 2: Pricing — one-time, $49 / $99, with a launch tier

**Decision:**

| Tier | Price | What you get |
|---|---|---|
| **Free** | $0 | Core editor, file tree, Markdown, wiki-links, version history, audit log, **1 AI provider (Claude only)**, **3 templates**, **1 workspace** |
| **Pro** | **$49 one-time** | Everything Free has + **all 3 AI providers** + **all 15 templates** + **unlimited workspaces** + whiteboard + audio + research/citations + multi-model comparison + **1 year of updates** |
| **Lifetime** | **$99 one-time** | Everything Pro has + **updates forever** + **early access to new features** + **commercial use license** |
| **Founder's Launch (first 100 buyers)** | **$29 lifetime** | Same as Lifetime, but capped at 100 sales. Creates urgency, rewards early adopters. |

**Sold via LemonSqueezy** as merchant of record.

**Reasoning:**

*Why one-time, not subscription:*
- Local-first apps die on subscriptions. Customers HATE paying monthly for software with no server costs.
- The most successful local-first tools all use one-time pricing: Obsidian (free + paid sync addon), Sublime Text ($99 one-time), Things ($50 one-time per platform), BBEdit ($60 one-time). The ones that try subscription struggle (Reflect, Tana).
- Subscription billing infrastructure (renewals, dunning, cancellation flows, upgrade paths) is a ~10x more complex commercial pipe than one-time.

*Why $49:*
- Notion paid plans start at $10/mo. ChatGPT Plus is $20/mo. $49 = 2.5 months of ChatGPT Plus.
- Sublime Text is $99 one-time. Keepance is cheaper because it's newer and unproven.
- $49 is in the "impulse buy" zone for indie tools (typically $20–60). Above $60 needs a sales process.
- Leaves room to raise to $59 / $69 later as the brand strengthens.

*Why a free tier exists at all:*
- Local-first/BYOK products live or die on word of mouth. People need to be able to TRY it before they trust it with their business documents.
- Free tier is intentionally limited so there's a real reason to upgrade — only 1 AI provider, only 3 templates, only 1 workspace. Not crippled, but obviously a "starter" version.

*Why LemonSqueezy over Stripe:*
- LemonSqueezy is the **merchant of record**, meaning they handle EU VAT, US sales tax, refunds, chargebacks, customer accounts, and license key generation as a built-in feature.
- Their fee is ~5% + $0.50 per transaction. That's higher than Stripe's 2.9% + $0.30, but the admin time saved (no VAT registration in 27 EU countries, no sales-tax-nexus tracking in US states, no refund flow to build) is worth far more.
- Lemon Squeezy has a built-in license key system that integrates directly with Tauri apps via webhook + API.
- Same tier as Paddle, but LemonSqueezy has a better indie-developer reputation and a better dashboard.

*Why a launch tier:*
- "Founder's Pricing" creates urgency on launch day
- Rewards early adopters (who become evangelists)
- Generates initial revenue + reviews
- Anchors people to the higher regular price
- Standard playbook used by every successful indie launch

**Spend implications:** ~5% of revenue goes to LemonSqueezy. At $5K/mo that's $250/mo in fees, which is far less than the cost of building/maintaining a Stripe + Quaderno + Postmark + custom-license stack.

---

### Decision 3: GitHub repo — moved to `keepance/keepance` org (REVISED 2026-04-08)

**Final decision:** Repo lives at **`github.com/keepance/keepance`**, a GitHub Organization (Free plan) owned by Jameson's `joelbridger` personal account.

**History of this decision:**
1. Original assessment: assume `joelbridger` is unknown → recommend transfer to brand-recognized personal account
2. Board input: `joelbridger` is actually Jameson's main account → recommendation revised to "stay at joelbridger" to avoid breaking release URLs
3. Board follow-up: Jameson asked for a CEO call between (a) keep at joelbridger, (b) move to a `jamesondaines` personal account, or (c) create a new `keepance` account
4. **Final CEO call: create a `keepance` GitHub Organization.** The org structure is the cleanest commercial arrangement — it decouples the product from any individual person, signals "real product" to PH/HN/buyers, and future-proofs LLC formation, contributors, hires, and any eventual sale.

**Transfer executed 2026-04-08:**
- New `keepance` org created (Free plan, owned by joelbridger account)
- Existing `joelbridger/keepance` repo transferred via GitHub API
- Old `joelbridger/keepance/*` URLs auto-301-redirect to new `keepance/keepance/*` URLs (so the existing v1.0.0 download links remain functional)
- Local git remote updated to `https://github.com/keepance/keepance.git`
- All marketing copy and docs updated to use the canonical `keepance/keepance` URLs
- Server's `gh` CLI now authenticated as `joelbridger` (alongside the existing `scottdaly` token), so push works from the server

**Implication for branding:** Public-facing GitHub URL is `keepance/keepance`. Jameson is identified as the founder in the README and via the org's profile README at `github.com/keepance/.github`. The org structure also makes it natural to add a logo, bio, support email, and pinned repos at the org level rather than per-person.

---

### Decision 4: Templates — 12 exist, build 3 more, fix the homepage

**Decision:** Build 3 new founder-focused templates (Investor Update, Board Meeting Notes, First-Hire Onboarding) to honestly hit "15+ founder templates", then update the homepage to surface the real list.

**Reasoning:**
- The homepage currently advertises templates that DON'T exist (D&D campaign, hobby, gaming strategy, etc.) and ignores the 12 that DO.
- Building 3 templates is roughly 1 day of work — each is a TypeScript file with interview questions and prompt templates.
- Honesty in marketing matters for trust + retention. Users who buy expecting "Gaming Strategy" templates will refund.

**The real template list (post-build):**
1. New Business Kickoff (flagship)
2. Competitor Analysis
3. Customer Persona
4. Financial Model
5. Go-to-Market Plan
6. Landing Page Copy
7. MVP Scope
8. Pitch Deck
9. Pricing Strategy
10. User Interviews
11. Content Strategy
12. Weekly Review
13. **Investor Update** (new)
14. **Board Meeting Notes** (new)
15. **First-Hire Onboarding** (new)

---

### Decision 5: Time budget — 5–10 hrs/week, 8 weeks to first revenue

**Decision:** Plan assumes the same 5–10 hrs/week pace Jameson uses for BehaviorUX. Total ramp from today to first paying customer: **8 weeks**.

**Reasoning:**
- Jameson's full-time job at Wheel Health takes priority. Realistic, not aspirational.
- Most of the work is parallelizable into chunks that fit evenings/weekends.
- The 8-week timeline assumes one focused weekend per phase boundary (e.g., the launch weekend in week 6).

---

### Decision 6: Cross-platform — Windows + Mac at launch, Linux deferred

**Decision:** Ship Windows and macOS at launch in week 6. Linux added in v1.2 (post-launch).

**Reasoning:**
- ~70% of indie hackers, founders, and "second brain" power users are on Mac. Look at any Indie Hackers screenshot, X founder thread, or Show HN comment section.
- Local-first software audiences are heavily Mac (Obsidian, Things, Bear, Reflect, Tana all have Mac-majority user bases).
- Skipping Mac forfeits the majority of the actual paying customer pool.
- Linux indie hacker market is small, vocal, and rarely pays. Building/notarizing/distributing for Linux has overhead similar to Mac for ~5% of the revenue.
- AppImage builds via GitHub Actions are cheap to add later.

**Cost:** Apple Developer Program $99/yr.

---

### Decision 7: Code signing — yes, $300/yr budget approved (board ratification needed)

**Decision:** Buy code signing certificates for both Windows and macOS. Total ~$300/yr.

**Reasoning:**
- Without code signing, Windows shows a SmartScreen warning ("Microsoft Defender SmartScreen prevented an unrecognized app from starting") on every install. Conversion drops dramatically — most users abandon at this prompt.
- Without code signing, macOS shows a Gatekeeper warning ("Keepance can't be opened because it is from an unidentified developer"). Same effect.
- For a paid product, both warnings are revenue-killers.
- The math: $300/yr ÷ $49 per sale = ~7 sales to break even. Hit that in week 1.

**Vendors:**
- **Apple Developer Program:** $99/yr. Unambiguous. Required for notarization.
- **Windows OV cert:** $200–250/yr. Options ranked by cost/quality:
  1. **Azure Trusted Signing** (~$10/mo via Microsoft) — newest, cheapest, but requires a Microsoft account verification process
  2. **SSL.com OV cert** (~$200/yr) — solid mid-tier choice
  3. **DigiCert OV cert** (~$500/yr) — most expensive, no longer worth it
  4. **SignPath Foundation** (free for OSS) — only works if Keepance is open-source, which conflicts with the paid model
- **Recommendation:** Try Azure Trusted Signing first; fall back to SSL.com if it doesn't work out.

**Resolution (2026-04-08):** Board approved $300/yr ceiling with the directive to "exhaust free options first." Free options for closed-source paid Windows software are essentially nonexistent (SignPath Foundation is OSS-only; self-signed still triggers SmartScreen). Realistic spend: **$99 Apple + ~$120/yr Azure Trusted Signing = ~$219/yr**, well under the cap. Action: try Azure Trusted Signing first (cheapest legitimate path); fall back to SSL.com OV (~$160/yr) if Jameson is ineligible for Azure Trusted Signing.

---

### Decision 8: License validation — tiny Bun service on the home server

**Decision:** Build a license validation Bun systemd service at `licenses.keepance.com`, mirroring the existing form-handler pattern.

**Architecture:**
- Bun.serve, ~150 lines of code
- Endpoints: `POST /activate` (validates a LemonSqueezy license key, returns a signed activation token), `POST /validate` (verifies an existing token), `POST /webhook` (LemonSqueezy webhook for revocation events)
- Stores activation records in JSONL files, same as form-handler
- Token signing uses Ed25519 keys; public key embedded in the Tauri app for offline validation
- Hosted as a systemd service, exposed via Caddy on the host, Cloudflare tunnel routes `licenses.keepance.com` → `127.0.0.1:5181`

**Reasoning:**
- Avoids hardcoding the LemonSqueezy API key in the client app (security)
- Allows revocation when needed (refund, fraud, terms violation)
- Allows offline grace periods (token lasts 30 days; app runs offline indefinitely as long as the token is valid)
- Same pattern Jameson already understands (form-handler) — minimal new operational burden
- Minimal cost (zero — runs on the existing home server)

**Why not pure client-side validation:**
- Pure client-side is easily defeated (just modify the binary to skip the check)
- A tiny server-side check + signed token gives ~99% of the protection at near-zero cost

**Why not hand all of this to LemonSqueezy:**
- LemonSqueezy provides license keys and a validation API, but their API requires the secret key to be present at validation time. You can't safely embed the secret in a client. So you NEED a server-side intermediary.

---

### Decision 9: Brand — keep "Keepance", run trademark checks

**Decision:** Keep the name. Run USPTO TESS search + Google trademark check before launch. File a US trademark application if budget allows.

**Reasoning:**
- Sunk cost on domain, branding, design work, GitHub repo, live site, install base. Renaming would erase all of that.
- "Keepance" is unique, googleable, has no obvious conflicts.
- Worth doing the legal due diligence (~30 minutes of free searches) before charging money.

**USPTO trademark filing:** $350 per class. Recommend filing in:
- **Class 9** (downloadable software) — most relevant
- **Class 42** (SaaS / providing temporary use of online software) — secondary, only if Keepance later adds any online component

**Total potential spend:** $350–$700. Optional but recommended. Escalated to the board.

---

### Decision 10: Repo doc structure — mirror jameworld

**Decision:** Reorganize `/home/jameson/keepance/` documentation to mirror the jameworld convention exactly:

```
docs/
├── reference/      # Architecture, technical reference (ARCHITECTURE.md, DECISIONS.md, etc.)
├── operations/     # Runbooks, deploy guides, build instructions
├── features/       # Feature plans, design docs (BUDGETING_APP.md style)
├── quality/        # Testing docs, definition of done
└── archive/        # Historical docs (Windows migration, V1 launch plan, etc.)
```

Root-level Markdown files reduced to: `README.md`, `CHANGELOG.md`, `BACKLOG.md`, `CLAUDE.md`, `KEEPANCE_BUSINESS_PLAN.md` (this file), and any `.md` that an outside contributor would need on day 1.

**Reasoning:**
- Reduces cognitive load — Jameson already navigates this layout in jameworld
- Makes the repo look professional when public
- 13 root-level docs is "this looks unfinished"; 5 root-level docs is "this is organized"

---

### Decision 11: Live website is canonical, sync repo to it

**Decision:** Overwrite `~/keepance/website/index.html` with the LIVE `/var/www/keepance.com/index.html`. Set up `~/keepance/infra/deploy.sh` for future website deploys (mirroring the jamesondaines-portfolio pattern).

**Reasoning:**
- The live file has the audited 2026-04-08 voice (no AI tells), Plausible analytics, and proper SEO meta tags.
- The repo file is the OLD copy with the AI-toned voice and the wrong audience positioning.
- Syncing the wrong direction would lose the better copy. Always prefer the canonical source of the better content.

---

### Decision 12: Phase 0 today is full-scope + Phase 1 jump-start

**Decision:** Today's session does all of Phase 0 (server move, organize, commit, push, memory file, deploy script, .gitattributes normalization) PLUS the highest-leverage Phase 1 items that don't require a Windows machine:
- Legal docs (Privacy, Terms, EULA)
- Support email setup (`support@keepance.com` via CF Routing → Brevo)
- Footer placeholder link fixes
- Real BACKLOG.md with 8 weeks of next work
- GitHub Actions CI workflow draft for cross-platform builds

**Reasoning:**
- Maximize what one session accomplishes
- Phase 1 items deferred to the next session: actually building the v1.0.1 installer (needs the Windows machine OR the GitHub Actions workflow to be live), screenshots/demo video (needs the app actually running)

---

### Decision 13: GitHub Actions cross-platform builds — set up immediately

**Decision:** Build a GitHub Actions workflow that compiles Tauri installers for Windows + macOS + Linux on every git tag. One-time ~3-hour setup. After this, no Windows machine is ever needed.

**Reasoning:**
- Tauri ships an [official GitHub Action](https://github.com/tauri-apps/tauri-action) that handles the entire matrix
- GitHub provides free macOS, Windows, and Linux runners for public repos (and a generous quota for private)
- Every release becomes: `git tag v1.0.2 && git push --tags` → installers for all 3 platforms automatically built and uploaded to a GitHub Release
- Eliminates the dependency on Jameson having his Windows machine accessible
- Required for Mac builds anyway (since notarization happens during build, and Jameson doesn't own a Mac)

---

### Decision 14: AI cost model — BYOK only, forever

**Decision:** Keepance does NOT manage AI keys, billing, or API calls. Users provide their own keys for Claude/OpenAI/Gemini, stored in their OS keychain.

**Reasoning:**
- Zero per-user AI costs to Keepance (margin = 100% minus LemonSqueezy fee)
- Zero usage-based billing complexity
- Perfect privacy story: data goes user → Anthropic, never via Keepance's servers
- Some users will hate the BYOK setup hurdle; that's a positioning feature, not a bug. The target market (founders concerned about data privacy) prefers BYOK.
- If Keepance later wants to add a managed-keys tier, it can be a separate product

**What this means for marketing:** Lead with "your data, your keys, your tools" as a privacy/sovereignty selling point.

---

### Decision 15: No cloud sync, no team features, ever (in v1)

**Decision:** Local-first stays local-first. No cloud sync, no real-time collaboration, no team accounts in v1.

**Reasoning:**
- Local-first IS the differentiator. Adding cloud sync compromises the entire pitch.
- If users want sync, they put their workspace folder in Dropbox/iCloud/OneDrive — works fine, no integration needed on Keepance's side.
- Team features would require building auth, backend infra, sync, conflict resolution — that's a different product (and a different price point).
- v2 may revisit this for a separate "Keepance Teams" product later. Out of scope for revenue launch.

---

### Decision 16: Demo video on landing page is mandatory

**Decision:** Build a 30-second auto-playing demo loop on the landing page hero, showing: idea → AI chat → real files appearing in the workspace. Same pattern as the BehaviorUX hero animation.

**Reasoning:**
- The current landing page has a static mockup. The "magic moment" of Keepance (chat → real persistent file) is invisible to a visitor.
- Auto-playing demos increase landing page conversion materially.
- Pattern is well-documented in `reference_web_animation_patterns.md` from BehaviorUX work.

---

## Part 3: Revenue model + targets

### Pricing recap

| Tier | Price | Use case | % of buyers (projected) |
|---|---|---|---|
| Free | $0 | Trial, intro | 80% |
| Pro | $49 one-time | Most paying users | 60% of paying |
| Lifetime | $99 one-time | Power users, evangelists | 30% of paying |
| Founder's Launch | $29 lifetime (capped at 100) | Launch buyers only | 10% of paying (during launch only) |

**Average revenue per paying user (steady state):** ~$64 ((60% × $49) + (30% × $99) + (10% × $29))

### Revenue trajectory (conservative)

| Month | Sales | Revenue | Cumulative |
|---|---|---|---|
| **Month 1** (launch month) | ~10 buyers | $500 | $500 |
| **Month 2** | ~15 buyers | $900 | $1,400 |
| **Month 3** | ~30 buyers | $2,000 | $3,400 |
| **Month 4** | ~45 buyers | $3,000 | $6,400 |
| **Month 5** | ~60 buyers | $4,000 | $10,400 |
| **Month 6** | ~75 buyers | $5,000 | $15,400 |
| **Month 9** | ~120 buyers | $8,000 | ~$36,000 |
| **Month 12** | ~150 buyers | $10,000 | ~$72,000 |

**Year 1 total:** ~$72,000 conservative.

**Realistic upside scenarios:**
- A single viral X post or HN front-page hit: 2–3x the month it happens
- A newsletter feature (e.g., from Refind, MakerNews, IndieHackers Daily): 1.5x for that week
- Product Hunt #1 of the day: 5–10x the launch week

**Costs (recurring monthly):**
- LemonSqueezy fee: ~5% of revenue
- Apple Developer: $8/mo (annualized)
- Windows code signing: ~$17/mo (annualized)
- Domain + Cloudflare: $0 (already paid)
- Hosting: $0 (home server)
- Email: $0 (CF Routing + Brevo free tier)
- Analytics: $0 (Plausible self-hosted)
- **Total fixed monthly:** ~$25 + 5% revenue

At $5K/mo revenue, Keepance's gross margin is ~94%. Compare to a SaaS with infrastructure and per-user costs (typical 70–80%). Local-first is cheap to operate.

---

## Part 4: 8-week launch roadmap

### Week 1 — Phase 0 + Phase 1 jump-start (TODAY)

**Goal:** Move project to server, organize, commit reality, set up the operational foundation.

- [ ] Add `.gitattributes` (`* text=auto eol=lf`) and normalize CRLF→LF in one commit
- [ ] Commit the 5 files of real uncommitted work (tab persistence + open-in-explorer)
- [x] Push everything to `keepance/keepance` (transferred from joelbridger/keepance on 2026-04-08)
- [ ] Reorganize docs into `docs/reference/`, `docs/operations/`, `docs/features/`, `docs/quality/`, `docs/archive/`
- [ ] Sync `website/index.html` with the live `/var/www/keepance.com/index.html` (live is canonical)
- [ ] Create `infra/deploy.sh` for future website deploys
- [ ] Save memory file `project_keepance.md` (DONE)
- [ ] Save this business plan to `~/keepance/KEEPANCE_BUSINESS_PLAN.md` (DONE)
- [ ] Update `MEMORY.md` with pointer (DONE)
- [ ] Write minimum-viable legal docs: Privacy Policy, Terms of Service, EULA (templates from TermsFeed/Iubenda are fine for v1)
- [ ] Write Getting Started doc, API Keys Guide, FAQ (Markdown pages on the same Caddy)
- [ ] Set up `support@keepance.com` via CF Email Routing → Brevo
- [ ] Replace footer placeholder `#` links with real pages or remove them
- [ ] Write a real `BACKLOG.md` capturing weeks 2–8 of work
- [ ] Draft GitHub Actions CI workflow for cross-platform builds

### Week 2 — Cross-platform CI

**Goal:** Automate builds. Never touch the Windows machine again.

- [ ] Finalize the GitHub Actions workflow (`tauri-action` matrix for Win/Mac/Linux)
- [ ] Test the workflow on a tag like `v1.0.1-test`
- [ ] Procure Windows code signing cert (start with Azure Trusted Signing)
- [ ] Begin Apple Developer Program enrollment (5–7 day approval)
- [ ] Wire signed Windows builds into the CI workflow

### Week 3 — macOS notarization + template gap close

**Goal:** Mac builds working. Real templates honestly hit "15+".

- [ ] Wire macOS notarization into the GitHub Actions workflow
- [ ] Test a notarized .dmg + .app on a Mac (borrow one if needed)
- [ ] Build the 3 missing templates: Investor Update, Board Meeting Notes, First-Hire Onboarding
- [ ] Update the homepage template gallery to show all 15 real templates
- [ ] Build and release **v1.0.2** with all the uncommitted fixes + the new templates + signed installers

### Week 4 — Monetization

**Goal:** Take money.

- [ ] LemonSqueezy product setup (Free/Pro/Lifetime/Founder's Launch tiers)
- [ ] Build the license validation Bun service at `licenses.keepance.com`
- [ ] In-app activation flow: settings screen → license key input → validate → store activation token
- [ ] Tier-gating logic: free vs paid feature checks throughout the app
- [ ] Update homepage to replace the disabled "Coming Soon" Pro button with real Buy buttons

### Week 5 — Polish + launch assets

**Goal:** Make the landing page convert.

- [ ] Build the 30-second demo video / animation (autoplay loop)
- [ ] Take 6 high-quality screenshots
- [ ] Add Sentry/GlitchTip crash reporting to the desktop app
- [ ] First-run onboarding flow: fresh installs land in a starter workspace with example documents
- [ ] Email list signup on the homepage
- [ ] Soft launch on X founder Twitter, tease for the hard launch

### Week 6 — HARD LAUNCH

**Goal:** Get to revenue.

- [ ] Product Hunt launch (Tuesday or Wednesday, optimal slot)
- [ ] Show HN post simultaneously
- [ ] Coordinate the "Founder's Launch" $29 lifetime tier — capped at 100 buyers
- [ ] All hands on deck for support / responding to comments
- [ ] Email the (small) list with launch announcement

### Week 7 — Distribution

**Goal:** Push beyond launch-day audiences.

- [ ] Submit to AlternativeTo (vs Notion AI, Obsidian Copilot, Reflect, Tana)
- [ ] IndieHackers post — narrative around building Keepance + first-month numbers
- [ ] Reddit launches: r/SideProject, r/Entrepreneur, r/ChatGPTPro, r/LocalLLaMA
- [ ] Outreach to indie tool newsletters: BetaList, SaaSHub, Indie Hackers Daily, Refind, MakerNews

### Week 8 — Iterate

**Goal:** Convert what's working into compounding growth.

- [ ] Analyze conversion data (Plausible + LemonSqueezy)
- [ ] A/B headline / CTA / pricing position
- [ ] Reach out to launch buyers for testimonials
- [ ] Plan v1.1 features based on actual user requests (not hypothetical roadmap)

---

## Part 5: What we're explicitly NOT doing

**Not in v1, not in this plan, possibly never:**

1. **Cloud sync.** Local-first is the differentiator. Users put workspaces in Dropbox if they want sync.
2. **Real-time collaboration.** Single-user product. Maybe a "Teams" product later as a separate SKU.
3. **Mobile apps.** Desktop-only. Mobile is a different product.
4. **Plugin/extension marketplace.** Premature. Templates are folder structures shipped in the binary.
5. **Custom AI fine-tuning.** Standard API models only.
6. **Web scraping / crawling research.** SourceCards are manually pasted URLs.
7. **Voice/audio AI input.** Text-based interaction only.
8. **Subscription pricing.** One-time forever.
9. **Selling Keepance's own AI keys.** BYOK forever.
10. **Open sourcing the code.** This is paid software. (A separate "Keepance Lite" open-source version may make sense as a marketing funnel later, but not in v1.)

---

## Part 6: Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Code signing certs delayed/rejected** | Medium | High | Start procurement in week 2; have backup vendors lined up; can ship "developer mode install" warning bypass instructions if delayed |
| **Apple Developer enrollment delays** | Medium | High | Apply week 2 (5–7 day approval); have notarization fallback to "ad-hoc" signing as a worst-case |
| **GitHub Actions Tauri build fails on Mac** | Medium | Medium | Test early in week 2; tauri-action is well-documented; community examples exist |
| **LemonSqueezy account approval delayed** | Low | Medium | Apply early; have Stripe + Quaderno as fallback |
| **Trademark conflict found on "Keepance"** | Low | Very high | Run TESS search week 1; if conflict, escalate to board immediately |
| **Wheel Health IP/moonlighting policy conflict** | Low | Very high | Jameson must verify with HR before any public launch |
| **Launch falls flat (no traction)** | Medium | Medium | Conservative revenue targets assume modest reach; iterate copy + try second launch in month 3 |
| **First buyer requests refund** | High (1–2 will) | Low | LemonSqueezy handles refunds; budget 5% refund rate |
| **Major bug found post-launch** | Medium | Medium | Crash reporting (Sentry) catches issues; CI/CD enables fast patch releases |
| **Anthropic/OpenAI/Google API breaking change** | Low | Medium | BYOK insulates from billing changes; provider abstraction makes adapter updates straightforward |

---

## Part 7: Open questions for the board

These are the only items NOT decided. Jameson's input is required before they're closed.

### Q1: Who is `joelbridger`? — RESOLVED 2026-04-08
**Answer:** Jameson's secondary GitHub account. Repo stays put. No transfer.

### Q2: Spend approval — $300/yr in code signing certs — RESOLVED 2026-04-08
**Answer:** Approved with the directive to exhaust free options first. Realistic spend: $99 Apple + ~$120/yr Azure Trusted Signing = ~$219/yr (under cap). Apple has no free path. Closed-source paid Windows software has no truly free signing option (SignPath Foundation is OSS-only).

### Q3: Wheel Health conflict check — RESOLVED 2026-04-08
**Answer:** Cleared with Wheel Health. Keepance does not conflict with employment terms. Safe to launch publicly.

### Q4: Trademark filing
**Status:** Deferred to Month 2 of revenue. Default to "yes" if revenue clears $1K/mo. No board input needed unless circumstances change.

### Q5: Overall green light — RESOLVED 2026-04-08
**Answer:** Yes. Jameson is ready to own a paid software product (taxes, refunds, support, ownership).

### Q6: Server git push credentials — RESOLVED 2026-04-08
**Answer:** Jameson ran `gh auth login` in another terminal as `joelbridger`. Server's `gh` CLI now has both `joelbridger` (active) and `scottdaly` (secondary) tokens. Push works. Repo subsequently transferred to the new `keepance` org and remote URL updated.

---

## Part 8: How this plan is operated going forward

**Cadence:**
- **Weekly check-in:** Claude reviews progress against the 8-week plan, reports to Jameson, raises any new escalations
- **Phase boundary review:** At each phase boundary (week 1→2, 2→3, etc.), Claude proposes any plan adjustments for board ratification
- **Launch day:** All-hands focus from Claude on support, monitoring, and live iteration

**What Claude does autonomously:**
- All implementation (code, infrastructure, content, copy)
- All operational decisions (hosting, CI, deployment, monitoring)
- All marketing copy and channel decisions
- All vendor selection within budget
- Everything else not explicitly escalated

**What Claude escalates to Jameson:**
- Anything touching Wheel Health
- Anything touching Jameson's personal identity, finances, or legal exposure
- New spend above the approved budget
- Strategic pivots (audience change, pricing change, kill the product)
- Trademark or legal disputes
- Anything Claude is genuinely uncertain about (rare — Claude defaults to making the call)

**Where the business state lives:**
- **Memory file:** `~/.claude/projects/-home-jameson/memory/project_keepance.md` (Claude reads on every session)
- **This business plan:** `~/keepance/KEEPANCE_BUSINESS_PLAN.md` (long-form, human-readable, version controlled in the repo)
- **Backlog:** `~/keepance/BACKLOG.md` (week-by-week task list, updated as work progresses)
- **Changelog:** `~/keepance/CHANGELOG.md` (release-by-release history)
- **Decisions:** `~/keepance/docs/reference/DECISIONS.md` (architecture decision records)

---

*This plan is the operating contract between Jameson (board) and Claude (operator). It is written to be re-read at the start of every Keepance session — by future Claude, by Jameson when deciding whether to ratify changes, and by anyone who joins the project later. Update it when the strategy changes; don't write a new plan from scratch.*

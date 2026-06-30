# Advisor Prep Hero Documentation Index

**Last updated:** 2026-06-10  
**Purpose:** Find the right docs quickly. Trust levels are based on code inspection (code ≠ docs = lower trust).

---

## Essential (Read These First)

| Document | Path | Purpose | Trust | Status |
|----------|------|---------|-------|--------|
| **Business Plan** | [`KEEPANCE_BUSINESS_PLAN.md`](../../KEEPANCE_BUSINESS_PLAN.md) | Operating contract: ICP, pricing, 8-week launch roadmap, every CEO decision | **HIGH** | Current (2026-06-10) |
| **Project Context** | [`CLAUDE.md`](../../CLAUDE.md) | Instructions for Claude Code: architecture, key files, patterns, security | **HIGH** | Current (2026-06-10) |
| **Current Backlog** | [`BACKLOG.md`](../../BACKLOG.md) | Week-by-week task list: what's done, in flight, blocked, phases | **HIGH** | Current (updated daily) |
| **Project Map** | [`docs/_summaries/PROJECT_MAP.md`](./PROJECT_MAP.md) | Architecture, entrypoints, configs, data storage, common tasks | **HIGH** | Current (this doc) |
| **Changelog** | [`CHANGELOG.md`](../../CHANGELOG.md) | Release history, every feature/fix by version | **HIGH** | Current (updated per commit) |

---

## Architecture & Technical Design

| Document | Path | Purpose | Trust | Notes |
|----------|------|---------|-------|-------|
| **Architecture** | [`docs/reference/ARCHITECTURE.md`](../reference/ARCHITECTURE.md) | System design, layered modules, data flow diagram | **HIGH** | Code-verified, current |
| **Decisions (ADRs)** | [`docs/reference/DECISIONS.md`](../reference/DECISIONS.md) | Architecture Decision Records: tech stack, patterns, security | **HIGH** | All decisions locked in (no reversals) |
| **Firm Sync Decision** | [`spikes/firm-sync/DECISION.md`](../../spikes/firm-sync/DECISION.md) | Firm tier design: 3 chunks (identity, E2EE relay, inference proxy), E2EE CRDT sync | **HIGH** | Implementation in progress (Phase 1) |
| **Security Model** | [`docs/reference/SECURITY.md`](../reference/SECURITY.md) | Threat model, API key security, path validation, audit logging | **HIGH** | Code-verified |
| **Features Reference** | [`docs/reference/FEATURES.md`](../reference/FEATURES.md) | Canonical feature list: capabilities, file types, shortcuts, settings | **HIGH** | Feature-complete for v1.5 (minor updates for v3.0 firm tier) |
| **Product Vision** | [`docs/reference/VISION.md`](../reference/VISION.md) | Product positioning, user journey, value props (founder-focused) | **MED** | Positioning lock in (v3.0), minor updates expected |
| **Product Requirements** | [`docs/reference/PRD.md`](../reference/PRD.md) | User stories, acceptance criteria (v1.0–v1.5 era) | **MED** | Superseded by BUSINESS_PLAN for v3.0; kept for context |
| **Implementation Notes** | [`docs/reference/IMPLEMENTATION.md`](../reference/IMPLEMENTATION.md) | Detailed notes on specific subsystems (editor, chat, workflow) | **MED** | Useful for deep dives; may be slightly stale |

---

## Operations & Deployment

| Document | Path | Purpose | Trust | Notes |
|----------|------|---------|-------|-------|
| **Development Workflow** | [`docs/operations/DEVELOPMENT_WORKFLOW.md`](../operations/DEVELOPMENT_WORKFLOW.md) | Day-to-day dev: branch strategy, PR flow, release process | **MED** | Covers v1.5 release process; Phase 1 may vary slightly |
| **Board Action Items** | [`docs/operations/BOARD_ACTION_ITEMS.md`](../operations/BOARD_ACTION_ITEMS.md) | Engineering + financial handoffs to Jameson (Azure signing, Apple Developer, LemonSqueezy, etc.) | **HIGH** | Separate from JAMESON_ACTION_PACK (marketing) |
| **Deploy Script** | [`infra/deploy.sh`](../../infra/deploy.sh) | Website deployment (rsync → /var/www/keepance.com + Cloudflare purge) | **HIGH** | Works as of 2026-06-10 |
| **Release Workflow** | [`.github/workflows/release.yml`]( ../../.github/workflows/release.yml) | Tauri multi-platform builds + code signing (GitHub Actions) | **HIGH** | Updated 2026-06-09 (Azure signing for Windows) |
| **CI Workflow** | [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | Lint, type-check, test on every push | **HIGH** | Current |

---

## Quality & Testing

| Document | Path | Purpose | Trust | Notes |
|----------|------|---------|-------|-------|
| **Definition of Done** | [`docs/quality/DEFINITION_OF_DONE.md`](../quality/DEFINITION_OF_DONE.md) | What "done" means before merging: tests, docs, changelog, type safety | **HIGH** | Code-enforced via GitHub Actions |
| **Playwright Testing** | [`docs/quality/PLAYWRIGHT_TESTING.md`](../quality/PLAYWRIGHT_TESTING.md) | E2E testing patterns, locale matrix, trace debugging | **HIGH** | Matches actual test suite structure |
| **Manual Testing Checklist** | [`docs/quality/MANUAL_TESTING_CHECKLIST.md`](../quality/MANUAL_TESTING_CHECKLIST.md) | 200+ item Windows desktop manual test checklist (v1.6 pre-release) | **MED** | Comprehensive but may need v3.0 firm tier additions |
| **Backend Tests** | [`backend/README.md`](../../backend/README.md) | Bun test suite (52 tests: crypto, auth, licensing, HTTP lifecycle) | **HIGH** | Current (2026-06-09) |

---

## Marketing & Launch

| Document | Path | Purpose | Trust | Notes |
|----------|------|---------|-------|-------|
| **Marketing README** | [`docs/marketing/README.md`](../marketing/README.md) | **Start here for all marketing work.** Explains folder structure, playbook, channels, action-packs, campaigns | **HIGH** | Current (2026-06-10) |
| **Master Playbook** | [`docs/marketing/playbook/MARKETING_PLAYBOOK.md`](../marketing/playbook/MARKETING_PLAYBOOK.md) | Master index tying all marketing artifacts + critical-path launch timeline | **HIGH** | Phase 1 (in progress) |
| **Jameson Action Pack** | [`docs/marketing/action-packs/JAMESON_ACTION_PACK.md`](../marketing/action-packs/JAMESON_ACTION_PACK.md) | 8 tasks only Jameson can do (PH hunters, beta testers, screenshots, demo video, X posts, etc.) with drafts | **HIGH** | Complementary to BOARD_ACTION_ITEMS, not duplicate |
| **Email Sequences** | [`docs/marketing/playbook/EMAIL_SEQUENCES.md`](../marketing/playbook/EMAIL_SEQUENCES.md) | 10 plain-text emails: signup → purchase → retention → refund → re-engagement | **HIGH** | Ready to send |
| **Channel Playbooks** | [`docs/marketing/channels/`](../marketing/channels/) | Per-platform launch playbooks (PH, HN, IH, Reddit, newsletter, directories) with title variants, reply templates | **HIGH** | ~8 files, per-channel strategy |
| **Competitive Landscape** | [`docs/reference/COMPETITIVE_LANDSCAPE.md`](../reference/COMPETITIVE_LANDSCAPE.md) | Side-by-side vs Notion AI / Obsidian / ChatGPT / Reflect / Tana / Cursor / etc. + HN/PH reply paragraphs | **HIGH** | Last update: 2026-06-05 |
| **Press Kit** | [`website/press-kit/`](../../website/press-kit/) | Founder bio (3 lengths), fact sheet, brand colors, screenshots, demo video links | **HIGH** | Live at keepance.com/press-kit/ |
| **Blog Posts** | [`website/blog/`](../../website/blog/) | Publishable content: v1.5 announce, why local-first, picking templates, Notion AI math, chat persistence, etc. | **HIGH** | Ready to publish (audited for voice) |

---

## Strategic Documents

| Document | Path | Purpose | Trust | Notes |
|----------|------|---------|-------|-------|
| **Launch Readiness** | [`docs/strategy/LAUNCH_READINESS_AND_FIRST_DOLLAR_2026-06-01.md`](../strategy/LAUNCH_READINESS_AND_FIRST_DOLLAR_2026-06-01.md) | End-to-end launch checklist (v1.6 + Phase 1 entry criteria) | **HIGH** | Current (2026-06-01) |
| **Pricing Strategy** | [`docs/strategy/PRICING_RECOMMENDATION_2026-05-29.md`](../strategy/PRICING_RECOMMENDATION_2026-05-29.md) | Pricing rationale ($49/$129/$399), charter offer, upgrade paths | **HIGH** | Locked in BUSINESS_PLAN |
| **V3.0 Overhaul** | [`docs/strategy/2026-06-03-keepance-v2-overhaul.md`](../strategy/2026-06-03-keepance-v2-overhaul.md) | Rebrand from Projelli, firm tier addition, new ICP | **MED** | Planning document; BUSINESS_PLAN is source of truth |
| **V3.0 Pricing** | [`docs/strategy/2026-06-09-keepance-3.0-pricing.md`](../strategy/2026-06-09-keepance-3.0-pricing.md) | Pricing for firm tier (Professional + packs, Practice tier) | **HIGH** | Current |
| **SOC 2 Decision** | [`docs/strategy/2026-06-08-soc2-decision-brief.md`](../strategy/2026-06-08-soc2-decision-brief.md) | Decision: SOC 2 not required for Phase 1 launch (DPA yes, SOC 2 later) | **HIGH** | Approved by Jameson |
| **Competitive Build** | [`docs/strategy/2026-06-06-competitive-build-handoff.md`](../strategy/2026-06-06-competitive-build-handoff.md) | Handoff doc to engineering for V3.0 competitive features | **MED** | Planning; implementation in progress |
| **Vertical Competitive Landscape** | [`docs/strategy/2026-06-06-vertical-competitive-landscape.md`](../strategy/2026-06-06-vertical-competitive-landscape.md) | Competitive analysis per vertical (law, tax, consulting) | **MED** | Reference for positioning |
| **Four-Vertical Review** | [`docs/strategy/2026-06-04-independent-four-vertical-review.md`](../strategy/2026-06-04-independent-four-vertical-review.md) | Independent research on law/tax/consulting/finance verticals | **MED** | Background research; not a decision doc |

---

## Public Website Docs

| Document | Path | Purpose | Trust | Notes |
|----------|------|---------|-------|-------|
| **Getting Started** | [`website/docs/`](../../website/docs/) | User-facing guides: installation, setup, first workflow | **HIGH** | Live at keepance.com/docs/ |
| **API Key Setup** | [`website/docs/api-key-setup/`](../../website/docs/api-key-setup/) | How to get API keys for Claude, OpenAI, Gemini | **HIGH** | User-friendly walkthrough |
| **Mobile Access** | [`website/docs/mobile-access/`](../../website/docs/mobile-access/) | Point workspace folder at cloud storage (iCloud/Dropbox/GDrive) for mobile | **HIGH** | Live guides + decision matrix |
| **Legal** | [`website/legal/`](../../website/legal/) | Privacy Policy, Terms of Service, EULA, DPA | **HIGH** | Legally reviewed (external counsel) |
| **FAQ** | [`website/`](../../website/) | Embedded in homepage, also `website/docs/faq/` | **HIGH** | Live at keepance.com |

---

## Archive (Historical, Kept for Reference)

| Document | Path | Why Archived |
|----------|------|-------------|
| **Old Backlog** | [`docs/archive/OLD_BACKLOG_2026-02-18.md`](../archive/OLD_BACKLOG_2026-02-18.md) | Original v1 backlog (all 46 tickets done). Replaced by `BACKLOG.md` |
| **V1 Launch Plan** | [`docs/archive/V1_LAUNCH_PLAN.md`](../archive/V1_LAUNCH_PLAN.md) | Plan for original v1.0 launch. Done. |
| **Windows Migration Plan** | [`docs/archive/WINDOWS_MIGRATION_PLAN.md`](../archive/WINDOWS_MIGRATION_PLAN.md) | Plan for browser → Tauri Windows migration. Done. |
| **Windows Migration Complete** | [`docs/archive/WINDOWS_MIGRATION_COMPLETE.md`](../archive/WINDOWS_MIGRATION_COMPLETE.md) | Summary of completed Windows migration. Done. |
| **Windows Desktop Backlog** | [`docs/archive/WINDOWS_DESKTOP_BACKLOG.md`](../archive/WINDOWS_DESKTOP_BACKLOG.md) | Original Windows-specific backlog. Done. |
| **v1.0.1 Issues** | [`docs/archive/v1.0.1-ISSUES.md`](../archive/v1.0.1-ISSUES.md) | Bug list from v1.0.1 testing. Mostly fixed. |
| **Prompt/Confirm Audit** | [`docs/archive/WIN-015-prompt-confirm-audit.md`](../archive/WIN-015-prompt-confirm-audit.md) | Audit of window.prompt/confirm usage during Tauri migration. |

---

## Repo Root Files

| File | Purpose |
|------|---------|
| `README.md` | Public-facing project intro (GitHub) |
| `CLAUDE.md` | Instructions for Claude Code sessions (read first) |
| `KEEPANCE_BUSINESS_PLAN.md` | **Operating contract** — read first for strategic context |
| `BACKLOG.md` | Current week-by-week task list |
| `CHANGELOG.md` | Release history, every feature/fix by version |
| `AGENTS.md` | Sub-agent delegation log (Claude Code internal) |

---

## Documentation Trust Levels Explained

| Level | Meaning | When to Trust |
|-------|---------|--------------|
| **HIGH** | Code-verified or legally reviewed; current | Primary source for decisions. Update to match code if it drifts. |
| **MED** | Matches codebase intent but may have gaps; useful for context | Use for background; always verify with code for implementation details. |
| **LOW** | Outdated or superseded; kept for historical context | Reference only; don't implement based on this. Check current docs first. |

---

## Quick Find by Task

### "I'm fixing a bug"
1. Check `BACKLOG.md` for ticket
2. Read `docs/reference/ARCHITECTURE.md` for the affected module
3. Search `src/modules/` for the code
4. Run relevant tests: `npm run test` or `npx playwright test`
5. Update `CHANGELOG.md` after fix

### "I'm building a feature"
1. Read `KEEPANCE_BUSINESS_PLAN.md` to confirm it's approved
2. Check `BACKLOG.md` for the phase and current status
3. Review `docs/reference/DECISIONS.md` for relevant ADRs
4. Read the module docs in `CLAUDE.md` § "Key Files"
5. Write tests, update CHANGELOG, submit PR with link to BACKLOG ticket

### "I'm deploying to production"
1. Ensure all tests pass: `npm run test` + `npm run typecheck`
2. Tag release: `git tag v3.0.1 && git push --tags`
3. GitHub Actions builds + signs automatically (takes ~15 min)
4. Go to Releases, edit draft, add changelog, publish
5. Website: `cd infra && ./deploy.sh`

### "I'm marketing this"
1. **Read first:** `docs/marketing/README.md` (folder structure)
2. Check `docs/marketing/playbook/MARKETING_PLAYBOOK.md` (master timeline)
3. Find your channel in `docs/marketing/channels/`
4. Use ready-to-paste templates from channel playbooks
5. Don't write new content without checking `docs/marketing/campaigns/` for what's already staged
6. Jameson-only tasks: `docs/marketing/action-packs/JAMESON_ACTION_PACK.md`

### "I need to understand the product"
1. `KEEPANCE_BUSINESS_PLAN.md` — the elevator pitch + ICP + pricing
2. `docs/reference/VISION.md` — product positioning
3. `docs/reference/FEATURES.md` — what it does
4. `website/docs/` — user walkthrough
5. `website/blog/` — deeper posts (why local-first, etc.)

### "I'm onboarding a new team member"
1. Have them read: CLAUDE.md, KEEPANCE_BUSINESS_PLAN.md, PROJECT_MAP.md (this doc)
2. Run `npm run dev` (browser) or `npm run tauri:dev` (desktop)
3. Poke around the app for 30 min (feel the UX)
4. Pick a small bug from BACKLOG, fix it, submit PR
5. Read code review feedback carefully — patterns matter more than syntax

---

## How to Keep This Index Fresh

**Update this doc when:**
- A major new doc is created (add to appropriate section)
- An existing doc becomes archived or superseded (move to Archive section + note the reason)
- Trust level changes (e.g., code diverged from docs)
- A critical doc has a stale date (edit the date, re-verify against code)

**Cadence:** Review quarterly or after major product phase completion.

---

*This index is durable memory. It's your single source of truth for "where do I find X?"*

# V2 Integrity Review — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn every finding from the independent four-vertical expert review into shipped, tested fixes — eliminating all internal contradictions and overclaims that would stop a skeptical attorney, CPA, consultant, or RIA from paying.

**Architecture:** Three tiers sequenced by risk and leverage: Tier 1 is copy/consistency only (no new engineering, highest urgency — the site is live with integrity defects); Tier 2 is well-scoped software builds and content production; Tier 3 is depth, flywheel, and new template coverage. Each tier lives in its own workstream plan. Deploy-gated throughout: nothing goes to keepance.com without Jameson's explicit go.

**Source:** `docs/strategy/2026-06-04-independent-four-vertical-review.md` — treat as the spec.

---

## Decisions needed from Jameson before execution

Surface these in the plan order. Each workstream that depends on a decision is tagged below. Do not block — proceed with the recommended path and note where a different decision changes scope.

### D1. Advisor pack: ship live, or gate out? (BLOCKS T1-C, T2-6)

**Situation:** The four advisor templates are built, wired live in the app (`...ADVISOR_TEMPLATES` in `src/modules/workflow/index.ts`), and actively serving users — while the homepage and `/financial-advisors/` page say "in development / not yet shipped." Each template also carries an `@draft / do not expose without review` header.

**Options:**
- A. Do the advisor review, strip `@draft` headers, flip site copy to "available today." (Recommended — the pack is already live; honesty requires admitting it exists.)
- B. Gate the pack out of the build (remove `...ADVISOR_TEMPLATES` from the index), update site to "coming soon" with the correct not-shipped story.

**Recommendation:** Option A. The only thing that changes scope is the review timeline: Option A requires a named advisor to actually review the four templates; until that review is done, set the site copy to the softened-but-honest framing ("four advisor workflows, built with practicing advisors, more coming") and do not claim they are advisor-reviewed. Option B is more work (adding a build gate, losing the templates, revisiting them) and makes the product strictly worse for users who found them and are using them.

---

### D2. Canonical pricing model for the EULA and sweep (BLOCKS T1-B)

**Situation:** The EULA and Terms say Practice is "a one-time perpetual license at $499." The checkout, homepage, and all vertical pages sell Practice at "$499/yr (billed yearly)." These contradict each other; the legal documents are the binding ones.

**Intended model (from the handoff):**
- Personal: $49 one-time (perpetual)
- Professional: $149/yr (annual subscription)
- Founding: $99/yr (first 100 Professional buyers, reserved on the founding list)
- Practice: $499/yr (annual subscription, up to 5 seats)

**Action needed:** Confirm this is the intended model. If so, the EULA and Terms must be updated: Practice changes from "one-time perpetual" to "annual subscription." This is a legally meaningful change; the EULA update is part of Tier 1.

**Recommendation:** Confirm and sweep. The checkout and marketing pages already reflect $499/yr — the EULA is simply out of sync. Updating it removes the chargeback exposure the review identified.

---

### D3. "Reviewed-by" claim: soften now, or hold? (BLOCKS T1-A)

**Situation:** The legal page says "attorney-reviewed and kept current"; the tax page says "CPA-reviewed and kept current"; the consulting page says "reviewed by practicing consultants." Every template in all three packs carries `// @draft ... Requires [attorney/CPA/consultant] review before shipping. Do not expose to users without review.` — so the review has not actually happened.

**Options:**
- A. Soften copy immediately to what is defensibly true today ("built with input from practicing [attorneys/CPAs/consultants]" or "designed to produce work product you review with your professional judgment") and queue the real advisor review. (Recommended.)
- B. Hold any changes until a licensed professional actually reviews and signs off on the templates; then the claim is true. This delays Tier 1 and leaves the current false statement live.

**Recommendation:** Option A immediately. The false claim is live right now and the source code is public. Softening is not a retreat — it is accurate and the right voice for the product (honest).

---

### D4. Founder bio: confirm wording (no block)

**Situation:** The review notes the bio appears updated. In this session (2026-06-04) the bio was updated across homepage and press kit to: "A decade designing health products at Samsung and AstraZeneca." Tesla removed, UCL updated to "dual Master's degrees in Behaviour Change and Entrepreneurship."

**Action needed:** Confirm this wording is accurate, or provide the correct version.

**Recommendation:** Confirm as-is and mark D4 resolved.

---

## Build sequence

### Tier 1 — Integrity and consistency (copy only, deploy-gated)
**Plan:** `docs/superpowers/plans/2026-06-04-tier1-copy-consistency.md`
**Autonomy:** auto (once decisions D1/D2/D3 are confirmed)
**Blocks:** all outreach, testimonial asks, any press mentions

| ID | Finding | Depends on |
|----|---------|------------|
| T1-A | Soften "attorney/CPA/consultant-reviewed" claims everywhere | D3 |
| T1-B | Reconcile all pricing: EULA, Terms, JSON-LD, $129→$149 sweep (14 files) | D2 |
| T1-C | Advisor pack: resolve "in development" vs built+live | D1 |
| T1-D | Fix template counts (7/7/5 → 10/8/6/4), add hidden template cards, kill "15 built in" | auto |
| T1-E | Fix privacy headline overclaims (privilege intact, sidesteps clause, eliminates risk, ABA 512) | auto |
| T1-F | Cite Heppner properly + link in all 7 files | auto |
| T1-G | Rewrite stale /tour/ page (two templates → eight; strike "compliant/ensures"; fix dead link) | auto |

### Tier 2 — Last-mile trust and software (builds, deploy-gated)
**Plan:** `docs/superpowers/plans/2026-06-04-tier2-trust-builds.md`
**Autonomy:** auto except T2-2 (sample galleries need Jameson to provide or approve sample content)

| ID | Finding | Autonomy |
|----|---------|----------|
| T2-1 | `requiresVerification: true` on all regulated templates (22 missing), with per-template banner copy | auto |
| T2-2 | Per-vertical sample-output galleries (tax, consulting, advisor screenshots + downloads) | Jameson (content) |
| T2-3 | Onboarding fixes: plain-English API key reassurance on download/vertical pages; lead sensitive verticals with local Ollama | auto |
| T2-4 | "Hand-to-the-gatekeeper" one-pager family (legal/malpractice carrier, tax/7216, consulting/client GC, advisor/CCO) | auto |
| T2-5 | Branded/letterhead output: add firm name + logo field to export pipeline | auto |
| T2-6 | Multi-client isolation: surface scoping + cross-client warning on site with screenshot; per-client audit-log export; wire `prioritizeByProfession` to include advisors | auto + D1 |

### Tier 3 — Depth and flywheel (builds + people, not deploy-gated to outreach start)
**Plan:** `docs/superpowers/plans/2026-06-04-tier3-depth.md`
**Autonomy:** mixed — template builds are auto; reviewer recruiting is Jameson; securities-specific copy needs advisor/counsel sign-off

| ID | Finding | Autonomy |
|----|---------|----------|
| T3-1 | Named credentialed reviewer per vertical (build infra: reviewer page, testimonial slot); recruiting is Jameson | Jameson |
| T3-2 | Verification-first legal and tax research memos (citation quarantine table; UNVERIFIED markers) | auto |
| T3-3 | Per-vertical template gaps (legal: research memo, SOL calculator, engagement letter, family law, real estate, discovery; tax: 2848 representation kit, collection notices, S-corp, WISP; consulting: comp landscape, workshop prep; advisor: Reg S-P safeguards, books-and-records, Reg BI) | auto |
| T3-4 | Real PowerPoint export for consulting (theme, tables-as-tables, speaker notes) | auto |
| T3-5 | Seasonality handling for tax (season-aware trial, December onboarding, founding rate reservation) | auto |

---

## Testing approach

Every Tier 1 change is a website HTML edit. The test suite already has:
- `tests/unit/website-content-lint.test.ts` — 154 tests: em-dash detection, forbidden words, template-count consistency. **Run this after every T1 commit.**
- `npm test` — full 2024-test suite. Run before any deploy or release tag.

New tests to add (included in workstream plans):
- T1-B: a test that reads the EULA and Terms and asserts Practice is described as an annual subscription (not perpetual/one-time)
- T1-D: a test that counts templates per pack and asserts the page copy matches
- T2-1: a test that reads every template file and asserts `requiresVerification: true` for a known list of regulated templates

---

## File map (key paths referenced across all workstreams)

| Path | What it is |
|------|-----------|
| `website/index.html` | Homepage: pricing cards, privacy headlines, advisor card, template counts, JSON-LD |
| `website/legal/index.html` | Legal vertical page |
| `website/tax/index.html` | Tax vertical page |
| `website/consulting/index.html` | Consulting vertical page |
| `website/financial-advisors/index.html` | Advisor vertical page |
| `website/tour/index.html` | Tour page (stale) |
| `website/legal/eula/index.html` | EULA (binding legal doc) |
| `website/legal/terms/index.html` | Terms of Service |
| `website/byok-ai/index.html` | BYOK cost blog ($129 → $149) |
| `website/blog/byok-actual-cost-after-60-days.html` | Cost blog ($129 → $149) |
| `website/blog/keepance-1-5-announce.html` | 1.5 announce blog ($129 → $149) |
| `website/blog/chat-shouldnt-disappear.html` | Blog ($129 → $149) |
| `website/blog/how-i-built-keepance-in-8-weeks.html` | Build story ($129 → $149) |
| `website/local-model-setup/index.html` | Ollama guide ($129 → $149) |
| `website/markdown-for-ai/index.html` | Markdown page ($129 → $149) |
| `website/api-key-setup-guide/index.html` | API key guide ($129 → $149) |
| `website/ai-cost-calculator/index.html` | Calculator ($129 → $149) |
| `website/press-kit/index.html` | Press kit ($129 → $149) |
| `website/changelog/index.html` | Changelog ($129 mention) |
| `website/ai-workspace-privacy/index.html` | Privacy/Heppner page |
| `src/modules/workflow/templates/legal/*.ts` | Legal templates (requiresVerification, @draft) |
| `src/modules/workflow/templates/tax/*.ts` | Tax templates |
| `src/modules/workflow/templates/consulting/*.ts` | Consulting templates |
| `src/modules/workflow/templates/advisor/*.ts` | Advisor templates |
| `src/modules/workflow/index.ts` | Template registry (ADVISOR_TEMPLATES spread) |
| `tests/unit/website-content-lint.test.ts` | Content lint tests (extend for new assertions) |

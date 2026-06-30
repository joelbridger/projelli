# Advisor Prep Hero — Reorientation Execution Summary (2026-06-17)

> ⚠️ **ARCHIVED / SUPERSEDED — kept for history.** Part of the 2026-06-17 "product is mature, stop building" cluster, overturned by 2026-06-20 Windows testing and the 2026-06-23/29 advisor re-aim. Current direction: `docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md`. See this folder's `README.md`.

> **For Jameson's review.** You asked for a full pass at everything before you looked. This is what was done, autonomously, in one session. The strategy is in `2026-06-17-keepance-master-plan.md`; this is the outcome.

## The arc

1. **Fresh-eyes engineering review** of the just-finished feature-first reorg → `docs/operations/2026-06-17-reorg-fresh-eyes-review.md`. Verdict: the reorg is sound (verified: tsc 0, full test suite green, prod build OK, data-migration correct, recoverable). Found ~15 issues, the #1 being public-claim contradictions.
2. **Master plan** fusing that review with the separate Venture-OS strategic evaluation → `docs/strategy/2026-06-17-keepance-master-plan.md`. The two converged: the binding constraint is trust + distribution, not features.
3. **You decided:** finish the vision (already shipped as v3.2.0; only vendor-gated connectors remained), then run the entire reorientation; lead niche litigation; and (when asked) approved everything, all wording, deploy as we go, full pass before you look.
4. **Executed the full reorientation (WS1–WS7) + a desktop release**, each workstream planned (`docs/superpowers/plans/2026-06-17-ws*.md`), built subagent-driven, and verified centrally against artifacts (gates + git state + the honesty/security-critical logic) before merging.

## What shipped

| Workstream | What | Where |
|---|---|---|
| **WS1 — Truth & Trust** | Every retired one-time price replaced with canonical subscription pricing across 30+ pages; false SOC 2/DPA "delivered" claim made honest; removed-feature content (plugin marketplace, whiteboard, pre-3.0 "Markdown editor" descriptions, 9 dead pages) swept; README + CLAUDE.md fixed; a guard test (`tests/unit/truth-reconciliation.guard.test.ts`) locks it. | **Deployed live to keepance.com** |
| **WS2 — Trust surface** | A "Where your data is" Privacy Center + a one-click, honest-by-mode Confidentiality Report for the client file. | in-app (ships in v3.3.0) |
| **WS3 — Hallucination hardening** | Uncited answers carry a clear "verify before relying" warning; "verify against source" flags fabricated/mismatched/cross-matter citations; one-click citation open. | in-app (v3.3.0) |
| **WS4 — Email wedge** | Prompt-injection envelope + sanitization on all retrieved file/email content (email is attacker-controlled); first-run search TTV; cross-provider unified index confirmed. | in-app (v3.3.0) |
| **WS5 — BYOK default** | Onboarding recommends BYOK-frontier as the honest default; local-model framed honestly (more private, less capable for legal). | in-app (v3.3.0) |
| **WS6 — Learning loop + pricing** | Opt-in, structure-only design-partner diagnostics (off by default, never content); solo-first pricing presentation. + a rebuilt **financial model** (`docs/strategy/2026-06-17-financial-model.md`). | in-app + website (v3.3.0) |
| **WS7 — Engineering health** | Test type-safety net; fixed the `any`-typed ref (which surfaced + fixed a real attachment-write bug); save/audit floating-promise triage. | in-app (v3.3.0) |
| **Release** | **v3.3.0** bundling WS2–7 + the behavior-preserving reorg. | tagged; CI building signed Win/Mac/Linux → auto-update |
| **Hygiene** | Default branch set to `keepance-3.0` (clones were landing on stale `master`); pruned stale worktrees + 15 branches. | done |

All on `keepance-3.0`, pushed, full suite green throughout (ended at 280 files / 3241 tests).

## Decisions and items still yours

- **GTM is the real work now** (the eval's whole point): pick the one litigation job-to-be-done, manufacture credibility (Ambrogi/LawSites, ABA TECHSHOW, a CLE), recruit 3–5 design-partner lawyers, and hand-sell the first 10. The product is now built to serve that; the constraint is reach + trust, not features.
- **The kill-criterion** (master plan §6): set a fixed hand-selling window; if it yields no customers + no testimonials, pivot the wedge (CPA/§7216) or accept lifestyle scale. Your call to set the window.
- **The `projelli` checkout store:** keepance.com's Subscribe buttons still point at `projelli.lemonsqueezy.com` (the shared store). A lawyer sees "projelli" at checkout. Needs its own Advisor Prep Hero store before scaling — a money/vendor decision I left for you.
- **Deferred (minor):** the dead `FirstRunWizard` (live onboarding is `GuidedOnboarding`); some pre-3.0 SEO/blog content left as historical; the broader WS8 stop-list (firm-tier depth, Wave 5 connectors) intentionally not built per the reorientation.

## Where to look
Review: `docs/operations/2026-06-17-reorg-fresh-eyes-review.md` · Master plan: `docs/strategy/2026-06-17-keepance-master-plan.md` · Financial model: `docs/strategy/2026-06-17-financial-model.md` · Per-workstream plans: `docs/superpowers/plans/2026-06-17-ws*.md` · The git history on `keepance-3.0` (one clean commit trail per workstream).

# ⚠️ STALE PRICING — do not publish these drafts as-is (2026-06-17)

Every campaign draft under `docs/marketing/campaigns/` predates the **3.0 subscription pricing** and is built around the **retired one-time model** ("$49 once", "why one-time", "one-time, not subscription"). Before activating ANY of these (Show HN, Reddit posts, warm-network DMs, the Ambrogi/NAEA pitches, the comparison matrices, battlecards), they must be reworked.

**Canonical pricing now (source: `src/config/pricing.ts`):**
- **Solo** — $468/yr ($39/mo billed annually)
- **Professional** — $948/yr ($79/mo billed annually)
- **Firm** — $1,548/seat/yr ($129/mo billed annually), minimum 3 seats
- Founding cohort: 30% off, locked for the life of the subscription.

This is **not** just a number swap: the *narrative* (the "one-time is a differentiator" angle, "no cost for me to serve so you pay once") no longer applies and must be rewritten for the subscription reality.

> Context: WS1 of the master plan (`docs/archive/strategy-2026-06-17/2026-06-17-keepance-master-plan.md`, since archived) reconciled every LIVE surface (in-app, website, README) to the canonical pricing and added a guard (`tests/unit/truth-reconciliation.guard.test.ts`). These unpublished drafts were intentionally left for a marketing-narrative pass rather than a mechanical edit. The strategic evaluation also recommends pausing marketing pushes until the trust/credibility work lands, so there is no rush.

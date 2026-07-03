# The Jump Battle Plan — Lantern's strategy to replace Jump

*2026-07-03 · Internal only · Written for Jameson (the board). Every board-level call in
here is a RECOMMENDATION — you decide.*

**The mission (your words):** we're in sight of implementing every feature Jump has. This
package is the plan to defeat Jump's business — match them, beat them feature by feature,
and shift our marketing to "we can replace Jump," built on the insight that advisors ask
"what can this replace?" and refuse to add another tool.

## How to read this package

Read the sections in order the first time. Each is a separate file so you can come back
to one without rereading everything.

| # | File | What it answers |
|---|---|---|
| 1 | [`01-jump-assessment.md`](01-jump-assessment.md) | Who is Jump really — strengths, weaknesses, and is your "panic-adding mess" read right? |
| 2 | [`02-kill-sheet.md`](02-kill-sheet.md) | Feature by feature: where we match, where we beat them and why, where we honestly still lose |
| 3 | [`03-structural-moat.md`](03-structural-moat.md) | What we have that Jump *cannot* copy without rebuilding their company — and which of those things advisors actually care about |
| 4 | [`04-replace-dont-add-platform.md`](04-replace-dont-add-platform.md) | The "replace, don't add" messaging platform: what an advisor cancels when they adopt Lantern, the replacement math, and the honest limits |
| 5 | [`05-attack-angles-risk-ledger.md`](05-attack-angles-risk-ledger.md) | The aggressive attack lines — each with its factual basis, its punchy version, and its blowback risk |
| 6 | [`06-gtm-attack-plan.md`](06-gtm-attack-plan.md) | How we actually reach Jump's users and evaluators, and what the first 10 switchers are worth |
| 7 | [`07-beyond-parity-roadmap.md`](07-beyond-parity-roadmap.md) | After parity: the highest-impact things Jump doesn't have and can't quickly copy |
| 8 | [`08-open-questions-for-jameson.md`](08-open-questions-for-jameson.md) | The genuine board decisions this surfaces, each with my recommendation |
| — | [`SOURCES.md`](SOURCES.md) | Every external source cited, with URLs and dates |

## Executive summary

**1. Jump is strong, liked, and well-run — and has a structural blind spot we own.**
They're the category leader (~10% of US advisors, highest satisfaction among
notetakers, $105M raised, LPL/Osaic/Cetera distribution) executing a competent
platform expansion. Your "panic-adding mess" read is wrong on "panic" — but right
about the tension: they're becoming "connect 60 things" while their document layer
stays shallow, their price restructures under pressure from $49 CRM bundles, and
everything they do runs through their cloud. **They can't copy our architecture;
we can't copy their distribution.** That asymmetry shapes the whole plan. (Also: the
"started as a note-taker, pivoted on an investor's tip" story is partly wrong — they
started as a B2B sales tool and pivoted on customer discovery. Never use it publicly.)

**2. At program completion we match or beat their core loop and honestly lose four
things:** mobile capture, capture-anywhere (closed laptop/any phone), integration
breadth, and enterprise machinery (SOC 2, admin consoles, support teams). The five
beats that carry the deck: no bot + no Lantern server anywhere (in local-only mode
nothing leaves the machine at all; in BYOK mode only the advisor's chosen AI provider
sees prompts — never us); answers cited from
the whole file pile (not just what's connected); real Word notes where every bullet
clicks back to the moment it was said; safe approval-gated CRM writes; about half the
price with the AI bill at cost.

**3. The "replace, don't add" insight is externally validated** — Kitces says it
almost verbatim ("any new software tool needs to competitively bid to either replace
some other tool… or it's a drag on profitability"), advisors run 15–25 tools and are
on record hating it. What an advisor cancels with Lantern: their notetaker
(Jump/Zocks/FinMate), their dictation service, and the ChatGPT-on-the-side habit —
roughly $1,400–2,600/yr replaced by ~$1,000–1,100 all-in. What we loudly do NOT
replace: their CRM, planning, portfolio tools — that restraint is what makes the rest
credible.

**4. The aggression goes into receipts, not adjectives.** The three strongest attack
angles are Jump's own documents: their MSA converts customer data into Jump-owned
"Anonymized Data… for any legal purpose"; their benchmarks product is built from
"hundreds of thousands of… advisor-client transcripts" (opt-in — we always say so);
their brand-new MCP feature ships client data out unfiltered with a written "we
cannot control… whether your data may be used to train" disclaimer. Seven angles are
safe to fire at program completion; the reliability attack waits for pilot proof;
the origin-story attack is dropped.

**5. Claims climb a ladder tied to evidence.** Comparison page + contract essay +
replacement math at program completion (names Jump, fully cited, calm voice) →
"Lantern can replace Jump" after 3 real-data pilots → switcher stories → the "Cancel
Jump" campaign at ~10 documented switchers, backed by a capped switch-credit
incentive. An independent adversarial pass (Codex) argued the case *against* this
strategy; its strongest objections — zero-customer credibility, capture reliability,
the mobile gap, one-person support — are answered inside the plan rather than waved
away, and both a "replace" door and a "coexist with Jump" door stay open in every
asset.

**6. After parity, we leave their home field.** The beyond-parity trio (estate/
beneficiary mismatch detection, exam-binder-on-demand, tax-season pack) turns the
story from "Jump, but private and cheaper" into "carries the whole practice on your
own machine" — value Jump can't follow without asking advisors to upload everything.

**Nine decisions are yours** (section 8), the big ones: adopt the evidence-gated
ladder for how aggressive we go publicly (recommended: yes); name Jump on comparison
pages but not the homepage (yes); start interview *recruiting* now while the build
finishes (yes); pick the one public brand name before anything fires (longest-lead
item); fix the current vs-Jump page's factual errors this week (yes).

## Ground rules this package obeys

- **Evidence-first.** Verified fact, inference, and speculation are labeled as such.
  Aggressive positioning built on a wrong read backfires; every attack line cites its basis.
- **Never claim SOC 2** (we are not certified). Never state a Jump fact we can't cite.
  Aggressive ≠ false or defamatory.
- **Ground truth for our side** = the five wave plans + the 2026-07-02 coverage audit —
  what Lantern will actually be at program completion, not aspiration.
- **Internal only.** Nothing here is published, posted, or sent anywhere.

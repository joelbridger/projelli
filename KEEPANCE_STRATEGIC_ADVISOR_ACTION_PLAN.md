# Keepance — Strategic Advisor Action Plan

**The "what to actually do" companion to the full [Strategic Advisor Memo](docs/strategy/2026-06-28-strategic-advisor-memo.md).** Execution-ready, prioritized, owner-able. Date: 2026-06-28.

> **The whole plan in one line:** narrow to the cited Client Map for pre-meeting prep, fix the surface, and run a hard 60-day demand test with real arm's-length advisors — **zero speculative features.** If it fails, park it or go services; do not re-pivot a sixth time.

---

## 0. First-principles gut-check (the blunt "is this a real business?" test)

| Question | Honest answer |
|---|---|
| **Real problem?** | Yes, but mild. "Know the whole household before a meeting without digging through scattered files." It's an annoyance, not a bleeding wound — the hardest kind of pain to sell against. |
| **Who's affected?** | Small independent fee-only RIAs (1–20 people) where client context is scattered and nobody owns it. Lead with the pain; privacy is the *permission* to try, not the reason to buy. |
| **What do they pay now?** | ~3.8–6% of revenue on tech (~$300–600/advisor/mo for CRM + planning + portfolio) + $49–120/mo for a single AI notetaker. Real budget — but already allocated, and "AI that knows my client" is arriving bundled at $49/mo. |
| **Unique promise?** | "One private, cited brief of everything you know about a household, built from your own files, that never leaves your computer." Synthesis + local. No one credibly says both. Unproven as a *buyer's* deciding sentence. |
| **Unfair advantage?** | Design taste + AI-leveraged speed + a live in-household CFP + a hard-to-copy local-first architecture. **None of it is a distribution advantage — and distribution is the whole game.** |
| **Can it scale?** | Base case: cash-flow business (~95% margin; 150–350 customers ≈ $300K/yr; ~1,000 ≈ $1M/yr). Venture only via licensing the engine to a CRM/custodian. **Plan for cash-flow; treat the rest as upside.** |

**Verdict: clears the bar for a 60-day test. Does NOT clear the bar for another year of building.**

---

## 1. Prioritized recommendations (in order)

1. **NARROW to one loop.** Pick a client folder → the Client Map builds itself (cited, gaps flagged) → ask a pre-meeting question, click the source → draft one review note. Make it boring-reliable on real Windows. Freeze everything else.
2. **Fix the source-of-truth drift before any advisor sees it.** This is cleanup, not building: the pricing config still says "attorney/litigator" (and it reaches the in-app checkout), the $99-vs-$948 price inconsistency, the stale in-repo homepage and features doc, and the dev email still wired into the demo machine.
3. **Sell to strangers, not the wife's firm.** The design partner is for workflow truth, vocabulary, sample data, and peer intros — not validation. **The first paying customer must be arm's-length.**
4. **Lead with the pain, price it seriously.** Pitch 70% outcome / 30% privacy. Test ~$1,800/yr solo; kill the $99 line. $99 signals "not for real practices."
5. **Don't be a notetaker.** The notes lane is owned (Jump/Zocks) and collapsing into CRMs at $49/mo. Win on cross-document synthesis. Ride Wealthbox via the connector; don't compete with Wealthbox's AI.
6. **Keep one sales-enabling integration in scope during the freeze** (the Wealthbox/OneDrive "fits your stack" path) — it removes the "won't change my workflow" objection.
7. **Build the trust packet:** form the LLC now; ship the forwardable "where your data goes" one-pager (say "less to vet," not "nothing to vet"); defer SOC 2 until a deal demands it.
8. **Hold a services-first option in reserve.** If software-only stalls, sell the outcome done-for-you (concierge setup + subscription). The concierge work *is* the validation.

---

## 2. ICP ranking — best → worst first wedge

| Rank | ICP | Verdict |
|---|---|---|
| **1** | **Solo / small (1–20p) independent fee-only RIA where context is scattered** | **First wedge** — buyer=user=compliance owner at the small end; local-first lands hardest; warm access exists |
| 2 | Estate / multi-document-heavy advisors | Niche expansion (most synthesis pain) |
| 3 | Solo CPAs / tax pros / EAs | Adjacent later (Holistiplan owns tax-doc reading) |
| 4 | Multi-family offices / large RIAs | Avoid early (demand SOC 2 / DPA / entity) |
| 5 | Wirehouse / broker-dealer advisors | Avoid (firm dictates the stack) |
| — | Solo / small-firm attorneys (the old ICP) | Deprioritized (never validated; legal AI ~10x more capitalized) |

---

## 3. Validation plan (the 60-day demand test)

**The funnel / scoreboard:** 10–15 advisor conversations → 5 live demos → 3 real-data pilots → 3–5 weekly-active users → **1–2 paying or signed LOIs.** Measure your *selling behavior* (calls booked, demos run) as closely as the market's response.

| Hypothesis | Test | Validating | Invalidating |
|---|---|---|---|
| Pain acute enough to pay | 10 Mom-Test calls with arm's-length solos | Describe it unprompted + "when can I have it" | Polite interest, no urgency |
| Client Map wows on *their* messy files | Build a map live from a pilot's real folder | "It found things I forgot" | Thin/wrong on real-world docs |
| Local-first drives the purchase | A/B outcome-led vs privacy-led pitch | Privacy framing closes faster | Nods, no urgency |
| They'll pay ~$1,500+ | Paid-pilot ask ($500–1,500 / 90 days) | A signed pilot from a stranger | Only "if free / $99" |
| Weekly use sticks | Track logins over 4 weeks | 3–5 use it weekly | Decays after week 1 |

**Mom-Test questions:** "Walk me through prepping for your last annual review." "What's the most annoying part of getting ready for a client meeting?" "Last time you couldn't find something about a client, what did you do — and what did you pay to fix it?" (Never: "Would you use an AI tool that…")

**Concierge MVP:** for one pilot, build their first 5 Client Maps by hand — prove value before trusting the automation.

**If the test fails:** do NOT re-pivot to a sixth ICP. Park Keepance (strong asset to return to) or convert to the services/concierge motion.

---

## 4. Next-30-days task list (concrete, ordered)

**Today**
1. Write the one-sentence FutureVault answer ("they put your clients in their cloud; we keep them on your machine — and a solo can start today"). — *Jameson*
2. Start the Utah LLC formation. — *Jameson*
3. Draft the advisor homepage headline + subhead (see memo §9). — *Claude, Jameson approves*
4. Disconnect the dev email account from the demo machine. — *Claude/agent*

**This week**
5. Fix the pricing config: remove attorney copy, resolve $99-vs-$948 to ONE advisor price. — *Claude/agent*
6. Replace the in-repo law homepage with advisor framing; demote legal pages. — *Claude/agent*
7. Book 10 Mom-Test discovery calls with arm's-length solo RIAs (XYPN / NAPFA / FinTwit). — *Jameson*
8. One clean end-to-end demo rehearsal on a fresh Windows build (the AI's job on the Legion). — *Claude/agent*

**Next 2 weeks**
9. Run the 10 discovery calls; log pain / urgency / current spend. — *Jameson*
10. Build one Client Map live from a real (sanitized) advisor folder. — *Jameson + Claude*
11. Make the paid-pilot OR done-for-you concierge ask to the 3 most-pained; land ≥1 **stranger** at $500–1,500. — *Jameson*
12. Stand up one advisor landing page + demo-request capture. — *Claude/agent*

**Next 30 days**
13. 2–3 paid real-data pilots live and used weekly. — *Jameson*
14. Draft the design-partner case study. — *Claude, design partner reviews*
15. Get listed/known on the Kitces AdvisorTech map; apply to XYPN LIVE. — *Jameson*
16. Verify the Wealthbox paste-key on the design partner's real **paid** account (currently unverified). — *Claude/agent*

**The 90-day gate:** 3–5 weekly-active advisors, 1–2 paying or signed LOIs — or park / services. Decide on real usage data, not feelings.

---

## 5. The line in the sand

The single biggest founder risk is the **build trap** — five re-aims is the tell. The next move that is NOT on this plan is "build more / write a new positioning doc." If, in 60 days, real advisors aren't using it weekly with someone paying, the honest answer is to **stop or pivot the motion (services), not the ICP.** Let customers, not another strategy document, decide whether this is the one.
